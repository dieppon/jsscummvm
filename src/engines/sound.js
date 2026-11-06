/*
 * Sound, ported from ScummVM's engines/scumm/sound.cpp and soundcd.cpp.
 *
 * Monkey Island 1 CD keeps three kinds of sound resource:
 *
 *  - CD stubs: a 32-byte SOUN naming a CD audio track, a loop flag and a
 *    start and end time. The music lives on the disc. Ripped tracks are
 *    played, when its archive has any (trackN.{webm,ogg,mp3,flac,fla,wav}),
 *    from the game's archive (feed.js);
 *    without them the music is silent, but the CD timer still runs, since
 *    scripts time scenes against VAR_MUSIC_TIMER.
 *  - SBL: digitised Sound Blaster samples (VOC data), played through Web
 *    Audio.
 *  - ADL: short AdLib cues for iMUSE (imuse.js), played through the AdLib
 *    driver (audio/adlib.js) on an emulated OPL2 chip (audio/opl.js).
 *    ROL (MT-32) is never picked, as for an AdLib card.
 *
 * Browsers only let audio start after the user has interacted with the
 * page; the context is resumed on the first click or key press.
 */
(function(){
  var s = ScummVM.engines.SCUMM;

  // Ripped CD tracks, in order of preference. WebM is for Opus, which is
  // about half the size of a 256 kbps MP3 at the same quality and loops
  // without MP3's padding; it is skipped where the browser cannot play it
  // (Safari before 15), so an MP3 beside it is the fallback. Opus goes in
  // WebM rather than Ogg because Safari reports the wrong position in Ogg
  // Opus, and scenes are timed against the track's position.
  // (.fla is FLAC under a DOS 8.3 name, as ScummVM also takes it)
  var CD_EXTENSIONS = ["webm", "ogg", "mp3", "flac", "fla", "wav"];
  var CD_TYPES = {webm: 'audio/webm; codecs="opus"'};
  // what a track unzipped into a Blob is labelled
  var CD_MIME = {webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", flac: "audio/flac",
                 fla: "audio/flac", wav: "audio/wav"};

  function canPlay(ext) {
    var type = CD_TYPES[ext];
    if (!type) return true;
    try { return !!new Audio().canPlayType(type); } catch (e) { return false; }
  }

  // --- muting ---------------------------------------------------------------

  // The speaker's knob (jsscumm.js) mutes the whole game -- samples, AdLib
  // and CD audio -- without stopping anything, so the game keeps time as
  // it would with the sound up; only a CD track that starts while it is off
  // is not fetched (playCDTrack). A visit starts with it off, so nothing is
  // downloaded for music nobody asked for; switched on, it stays on through
  // reloads for the rest of the session (sessionStorage).
  var MUTE_KEY = "jsscummvm.muted";
  try { ScummVM.muted = window.sessionStorage.getItem(MUTE_KEY) != "0"; } catch (e) { ScummVM.muted = true; }

  ScummVM.setMuted = function(muted) {
    var cd = s._cdAudio;
    ScummVM.muted = !!muted;
    if (ScummVM.audioOut) ScummVM.audioOut.gain.value = muted ? 0 : 1;
    if (cd) cd.muted = !!muted;
    // a track that was left unfetched with the speakers off: fetch it now,
    // and play it from where the game has got to
    else if (!muted && s._cdStatus && s._cdTimerRunning) s.loadCDTrack(s._cdStatus, s._cdMusicTimer / 60);
    try { window.sessionStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* not kept */ }
  };

  s.initSound = function() {
    var t = this;
    // a previous run's music must not carry on under this one
    if (t._sfx) t.shutdownSound();
    t._soundQueue = [];
    t._currentCDSound = 0;
    t._cdMusicTimer = 0;
    t._cdTimerRunning = false;
    t._sfx = {};             // sound id -> playing AudioBufferSourceNode
    t._cdAudio = null;
    t._cdStatus = null;
    t._soundsWarned = {};
    t._cdHold = null;
    t._imuse = null;
    t._musicQueue = [];
  };

  // --- AdLib music: OPL2 -> AdLib driver -> iMUSE --------------------------

  // Created on the first AdLib sound. The chip is rendered from a Web Audio
  // callback, which also runs the driver's 250 Hz timer -- every 1/250 s of
  // rendered audio, as ScummVM's OPL callback does -- so the music keeps
  // time with what is heard. Until the browser lets audio run (it waits for
  // a click), a fallback clock drives the timer silently, so a script
  // waiting for a jingle to end does not wait forever.
  s.initMusic = function() {
    var t = this, ctx = audioContext(), rate, opl, driver, node, tickLen, toTick = 0, lastAudio = 0, last;
    if (t._imuse) return t._imuse;
    if (!ScummVM.OPL || !ScummVM.AdLibDriver || !ScummVM.IMuse) return null;
    rate = ctx ? ctx.sampleRate : 44100;
    opl = new ScummVM.OPL(rate);
    driver = new ScummVM.AdLibDriver(opl);
    t._imuse = new ScummVM.IMuse(t, driver);
    tickLen = rate / ScummVM.AdLibDriver.CALLBACK_FREQUENCY;

    if (ctx && ctx.createScriptProcessor) {
      node = ctx.createScriptProcessor(2048, 0, 1);
      node.onaudioprocess = function(ev) {
        var out = ev.outputBuffer.getChannelData(0), pos = 0, n;
        lastAudio = Date.now();
        while (pos < out.length) {
          if (toTick < 1) {
            driver.onTimer();
            toTick += tickLen;
          }
          n = Math.min(out.length - pos, Math.floor(toTick));
          opl.generate(out, pos, n);
          pos += n;
          toTick -= n;
        }
      };
      node.connect(ScummVM.audioOut);
      t._musicNode = node;
    }

    last = Date.now();
    t._musicClock = window.setInterval(function() {
      var now = Date.now(), ticks;
      // held by the save menu: the music waits, and does not catch up after
      if (t._soundPaused) { last = now; return; }
      if (ctx && ctx.state == "running" && now - lastAudio < 250) { last = now; return; }
      ticks = Math.floor((now - last) * ScummVM.AdLibDriver.CALLBACK_FREQUENCY / 1000);
      last += ticks * 1000 / ScummVM.AdLibDriver.CALLBACK_FREQUENCY;
      while (ticks-- > 0) driver.onTimer();
    }, 20);
    return t._imuse;
  };

  // An ADL resource: hand iMUSE its bytes (the MDhd header and the MIDI)
  s.playADL = function(id, chunk) {
    var t = this, imuse = t.initMusic(), data, i;
    if (!imuse) return;
    data = new Uint8Array(chunk.size);
    for (i = 0; i < chunk.size; i++) data[i] = chunk.stream.readByteAt(chunk.offset + i);
    imuse.startSound(id, data);
  };

  // One AudioContext for the page, resumed on the first user gesture.
  // Everything the context plays goes through one gain node, the mute.
  function audioContext() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ScummVM.audioContext) {
      ScummVM.audioContext = new Ctx();
      ScummVM.audioOut = ScummVM.audioContext.createGain();
      ScummVM.audioOut.gain.value = ScummVM.muted ? 0 : 1;
      ScummVM.audioOut.connect(ScummVM.audioContext.destination);
      var resume = function() {
        // (not while the save menu holds the sound: see pauseSound)
        if (ScummVM.audioContext.state == "suspended" && !ScummVM.soundSuspended)
          ScummVM.audioContext.resume();
      };
      window.addEventListener("mousedown", resume, true);
      window.addEventListener("keydown", resume, true);
      window.addEventListener("touchstart", resume, true);
    }
    return ScummVM.audioContext;
  }

  // sound.cpp startSound
  s.startSound = function(sound) {
    var t = this;
    t.scummVar("last_sound", sound);
    t._soundQueue.push(sound);
  };

  // sound.cpp processSoundQueues: last in, first out, as ScummVM pops it
  s.processSound = function() {
    var t = this, snd;
    while (t._soundQueue.length) {
      snd = t._soundQueue.pop();
      if (snd) t.triggerSound(snd);
    }
    while (t._musicQueue.length) {
      var cmd = t._musicQueue.shift(), imuse = t.initMusic();
      if (imuse) t.scummVar("soundresult", imuse.doCommand(cmd));
    }
  };

  // The chunk of a SOU container ScummVM's readSoundResource would keep for
  // an AdLib card: SBL first, then ADL; ROL is never picked.
  s.getSoundChunk = function(id) {
    var t = this, ptr = t.getResourceAddress("sound", id), MKID_BE = ScummVM.system.MKID_BE,
        tag, total, pos, cTag, cSize, best = null, bestPri = -1, pri, r;

    if (!ptr) return null;
    r = ptr.newRelativeStream(0);
    r.offset = 0;
    tag = r.readUI32(true);
    r.readUI32(true);
    if (tag != MKID_BE("SOUN")) return {tag: tag, stream: r.seek(0, true), offset: 0};

    if (r.readUI32(true) != MKID_BE("SOU "))
      return {tag: tag, stream: r.seek(0, true), offset: 0};   // CD stub

    total = r.readUI32(true);
    pos = 8;
    while (pos < total) {
      r.seek(8 + pos, true);
      cTag = r.readUI32(true);
      cSize = r.readUI32(true) + 8;
      pri = -1;
      if (cTag == MKID_BE("SBL ")) pri = 15;
      else if (cTag == MKID_BE("ADL ")) pri = 10;
      if (pri > bestPri) { bestPri = pri; best = {tag: cTag, stream: r, offset: 8 + pos, size: cSize}; }
      pos += cSize;
    }
    return best;
  };

  // sound.cpp triggerSound
  s.triggerSound = function(id) {
    var t = this, chunk = t.getSoundChunk(id), MKID_BE = ScummVM.system.MKID_BE, type;
    if (!chunk) return;

    if (chunk.tag == MKID_BE("SBL ")) {
      t.playSBL(id, chunk);
    } else if (chunk.tag == MKID_BE("SOUN")) {
      // v5: skip 2, then the type is at 0x0D -- 2 is a CD track
      type = chunk.stream.seek(2 + 0x0D, true).readUI8();
      if (type == 2) {
        if (id == t._currentCDSound && t.pollCD()) return;
        t.playCDTrackFromSoundID(id);
      }
    } else if (chunk.tag == MKID_BE("ADL ")) {
      t.playADL(id, chunk);
    } else if (!t._soundsWarned[id]) {
      t._soundsWarned[id] = true;
      debug(2, "sound " + id + ": " + ScummVM.system.reverse_MKID(chunk.tag) + " needs a music engine");
    }
  };

  // SBL: an AUhd chunk of 3 bytes, then AUdt holding a VOC block --
  // type 1, a 24-bit size, the rate byte and the packing (0 = 8-bit PCM).
  s.playSBL = function(id, chunk) {
    var t = this, ctx = audioContext(), r = chunk.stream, base = chunk.offset + 27,
        blockType, size, sr, pack, rate, buffer, data, i, src;

    r.seek(base, true);
    blockType = r.readUI8();
    size = r.readUI8() | (r.readUI8() << 8) | (r.readUI8() << 16);
    sr = r.readUI8();
    pack = r.readUI8();
    if (blockType != 1 || pack != 0) {
      debug(2, "sound " + id + ": unsupported VOC block " + blockType + "/" + pack);
      return;
    }
    size -= 2;
    // audio/decoders/voc.cpp getSampleRateFromVOCRate
    if (sr == 0xA5 || sr == 0xA6) rate = 11025;
    else if (sr == 0xD2 || sr == 0xD3) rate = 22050;
    else rate = Math.floor(1000000 / (256 - sr));
    if (!ctx || size <= 0) return;

    buffer = ctx.createBuffer(1, size, rate);
    data = buffer.getChannelData(0);
    for (i = 0; i < size; i++) data[i] = (r.readUI8() - 128) / 128;

    t.stopSFX(id);
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ScummVM.audioOut);
    src.onended = function() { if (t._sfx[id] === src) delete t._sfx[id]; };
    t._sfx[id] = src;
    // Count it as running from now even if the context is still waiting for
    // a click, or scripts that wait for it would hang
    src._endsAt = Date.now() + size * 1000 / rate;
    src.start();
  };

  s.stopSFX = function(id) {
    var src = this._sfx[id];
    if (!src) return;
    delete this._sfx[id];
    try { src.stop(); } catch (e) {}
  };

  s.isSFXActive = function(id) {
    var src = this._sfx[id];
    if (!src) return false;
    if (Date.now() > src._endsAt + 50) { delete this._sfx[id]; return false; }
    return true;
  };

  // --- CD audio (soundcd.cpp) ---------------------------------------------

  s.playCDTrackFromSoundID = function(id) {
    var t = this, r = t.getResourceAddress("sound", id), track, loops, start, end;
    if (!r) return;
    r = r.newRelativeStream(0).seek(0x18, true);
    track = r.readUI8();
    loops = r.readUI8();
    start = (r.readUI8() * 60 + r.readUI8()) * 75 + r.readUI8();
    end = (r.readUI8() * 60 + r.readUI8()) * 75 + r.readUI8();
    t._currentCDSound = id;
    t.playCDTrack(track, loops == 0xFF ? -1 : loops, start, end <= start ? 0 : end - start);
  };

  s.playCDTrack = function(track, numLoops, startFrame, duration) {
    var t = this;
    t.scummVar("music_timer", 0);
    t._cdMusicTimer = 0;
    t.stopCD();
    t._cdStatus = {track: track, loops: numLoops, start: startFrame / 75,
                   end: duration ? (startFrame + duration) / 75 : 0};
    // With the speakers off the track is not fetched at all: the game goes
    // on as without CD audio, its music timer running, and switching them
    // on fetches it then (ScummVM.setMuted)
    if (ScummVM.muted) { t._cdTimerRunning = true; return; }
    // Otherwise the timer -- which scripts time scenes by -- starts when the
    // music is heard, not when it is asked for (loadCDTrack)
    t._cdTimerRunning = false;
    t.loadCDTrack(t._cdStatus, 0);
  };

  // Fetch a cue's track and play it from `into` seconds into the cue --
  // looping round to where it would be by then, or not at all if a cue
  // that does not loop would be over
  //
  // The game waits for it, as for a CD drive spinning up (scumm.js's loop
  // holds while _cdHold is set): until the browser says it is playing, so
  // the scene goes on with the music and not ahead of it -- fetching it,
  // when it has to be fetched, and then the moment the audio takes to
  // start. The music timer starts then too. If there is no music after
  // all, it cannot play yet (no click on the page so far), or it takes
  // too long, the game goes on without waiting further.
  s.loadCDTrack = function(status, into) {
    var t = this, giveUp;
    function release() {
      window.clearTimeout(giveUp);
      if (t._cdHold === status) t._cdHold = null;
      if (t._cdStatus === status) t._cdTimerRunning = true;
    }
    t._cdHold = status;
    giveUp = window.setTimeout(release, 8000);
    t.findCDTrack(status.track, function(url) {
      var audio;
      if (!url || t._cdStatus !== status || t._cdAudio) { release(); return; }
      audio = t._cdAudio = new Audio(url);
      audio.muted = ScummVM.muted;
      audio.addEventListener("timeupdate", function() {
        if (status.end && audio.currentTime >= status.end) t.cdTrackEnded(audio, status);
      });
      audio.addEventListener("ended", function() { t.cdTrackEnded(audio, status); });
      // heard: the game and the timer go on from here
      audio.addEventListener("playing", release);
      if (!into) { audio.currentTime = status.start; start(); return; }
      audio.addEventListener("loadedmetadata", function() {
        var len = (status.end || audio.duration) - status.start;
        if (len > 0 && into >= len) {
          if (status.loops >= 0) { if (t._cdAudio === audio) t._cdAudio = null; release(); return; }
          into %= len;
        }
        audio.currentTime = status.start + into;
        start();
      });

      function start() {
        if (t._cdAudio !== audio) { release(); return; }
        var p = audio.play();
        // Blocked until the user clicks or presses a key: the game goes on,
        // and the track starts then, at the point the game has reached (the
        // CD timer counts 1/60 s)
        if (p && p.catch) p.catch(function() {
          release();
          var resume = function() {
            // a click in the save menu is not the time; wait for the next
            if (t._soundPaused) return;
            window.removeEventListener("mousedown", resume, true);
            window.removeEventListener("keydown", resume, true);
            if (t._cdAudio !== audio || !audio.paused) return;
            audio.currentTime = status.start + t._cdMusicTimer / 60;
            audio.play().catch(function() {});
          };
          window.addEventListener("mousedown", resume, true);
          window.addEventListener("keydown", resume, true);
        });
      }
    });
  };

  // A track reached its end: loop it, or stop
  s.cdTrackEnded = function(audio, status) {
    if (this._cdAudio !== audio) return;
    if (status.loops < 0 || --status.loops > 0) {
      audio.currentTime = status.start;
      if (audio.paused) audio.play();
    } else {
      audio.pause();
      this._cdAudio = null;
    }
  };

  // A ripped copy of the track, out of the game's archive (feed.js) in the
  // first format the browser plays: callback(url), or callback(null) if
  // there is none. The archive remembers it, so asking again -- even while
  // it is still being read -- waits for the same one.
  s.findCDTrack = function(track, callback) {
    var src = ScummVM.source, shown = false, timer;
    if (!src || src.game != this._game) { callback(null); return; }
    // a CD spins in the corner of the screen while a track is fetched --
    // if it takes long enough to notice, so not for one already kept
    timer = window.setTimeout(function() { shown = true; cdLoading(1); }, 250);
    src.trackUrl(track, CD_EXTENSIONS.filter(canPlay).map(function(ext) {
      return {ext: ext, type: CD_MIME[ext]};
    })).then(function(url) {
      window.clearTimeout(timer);
      if (shown) cdLoading(-1);
      callback(url);
    });
  };

  // how many tracks are being fetched; the CD shows while any are
  var tracksLoading = 0;
  function cdLoading(delta) {
    var crt = document.getElementById("crt");
    tracksLoading += delta;
    if (crt) crt.classList.toggle("is-loading-cd", tracksLoading > 0);
  }

  s.pollCD = function() {
    var a = this._cdAudio;
    return a && !a.paused && !a.ended ? 1 : 0;
  };

  s.stopCD = function() {
    if (this._cdAudio) {
      this._cdAudio.pause();
      this._cdAudio = null;
    }
  };

  s.stopCDSound = function(sound) {
    var t = this;
    if (sound != 0 && sound == t._currentCDSound) {
      t._currentCDSound = 0;
      t._cdStatus = null;
      t.stopCD();
      t._cdTimerRunning = false;
    }
  };

  // sound.cpp updateMusicTimer: with CD audio the timer is the CD's, which
  // counts frames from when the track was started
  s.updateMusicTimer = function(delta) {
    var t = this, a = t._cdAudio, st = t._cdStatus;
    if (t._cdTimerRunning) t._cdMusicTimer += delta;
    // timeupdate only fires every 15-250 ms; check the segment end each
    // frame too so a track does not run on into the next cue
    if (a && st && st.end && a.currentTime >= st.end) t.cdTrackEnded(a, st);
    t.scummVar("music_timer", t._cdMusicTimer);
  };

  // --- what the opcodes call ---------------------------------------------

  s.isSoundRunning = function(sound) {
    var t = this, i;
    if (sound == t._currentCDSound) return t.pollCD();
    if (t.isSFXActive(sound)) return 1;
    if (t._imuse && t._imuse.getSoundStatus(sound)) return 1;
    for (i = 0; i < t._soundQueue.length; i++)
      if (t._soundQueue[i] == sound) return 1;
    return 0;
  };

  s.stopSound = function(sound) {
    var t = this, i;
    t.stopCDSound(sound);
    t.stopSFX(sound);
    if (t._imuse) t._imuse.stopSound(sound);
    for (i = 0; i < t._soundQueue.length; i++)
      if (t._soundQueue[i] == sound) t._soundQueue[i] = 0;
  };

  s.stopAllSounds = function() {
    var t = this, id;
    if (t._currentCDSound) {
      t._currentCDSound = 0;
      t._cdStatus = null;
      t.stopCD();
      t._cdTimerRunning = false;
    }
    t._soundQueue = [];
    for (id in t._sfx) t.stopSFX(id);
    if (t._imuse) t._imuse.stopAllSounds();
  };

  // The save menu holds the game, and this holds its sound with it, as
  // ScummVM's pauseEngine pauses the mixer: the AudioContext -- samples and
  // AdLib music -- is suspended and the CD track paused, and both carry on
  // from where they were. Only a context that was running is suspended, so
  // one still waiting for the first click is left as it is.
  s.pauseSound = function(pause) {
    var t = this, ctx = ScummVM.audioContext, cd = t._cdAudio, now = Date.now(), id;
    pause = !!pause;
    if (pause == !!t._soundPaused) return;
    t._soundPaused = pause;
    if (pause) {
      t._soundPausedAt = now;
      ScummVM.soundSuspended = !!(ctx && ctx.state == "running");
      if (ScummVM.soundSuspended) ctx.suspend();
      t._cdWasPlaying = !!(cd && !cd.paused);
      if (t._cdWasPlaying) cd.pause();
    } else {
      // samples count as playing until _endsAt: move that on by the pause
      for (id in t._sfx)
        if (t._sfx[id]._endsAt) t._sfx[id]._endsAt += now - t._soundPausedAt;
      if (ScummVM.soundSuspended && ctx) ctx.resume();
      ScummVM.soundSuspended = false;
      if (t._cdWasPlaying && cd) cd.play().catch(function() {});
      t._cdWasPlaying = false;
    }
  };

  // The machine is switched off: silence everything, and take down the
  // AdLib chip's audio callback and clock, which run outside the game loop
  s.shutdownSound = function() {
    var t = this;
    // let go of the context if the save menu was holding it
    t.pauseSound(false);
    t.stopAllSounds();
    t._musicQueue = [];
    if (t._musicNode) {
      t._musicNode.onaudioprocess = null;
      t._musicNode.disconnect();
      t._musicNode = null;
    }
    if (t._musicClock) {
      window.clearInterval(t._musicClock);
      t._musicClock = 0;
    }
    t._imuse = null;
  };

  // sound.cpp soundKludge: -1 flushes the queue now; anything else is an
  // iMUSE command, run with the queued sounds
  s.soundKludge = function(list) {
    if (list[0] == -1) this.processSound();
    else this._musicQueue.push(list.slice());
  };
}());
