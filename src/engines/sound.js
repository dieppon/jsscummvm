/*
 * Sound, ported from ScummVM's engines/scumm/sound.cpp and soundcd.cpp.
 *
 * Monkey Island 1 CD keeps three kinds of sound resource:
 *
 *  - CD stubs: a 32-byte SOUN naming a CD audio track, a loop flag and a
 *    start and end time. The music lives on the disc. Ripped tracks are
 *    played from games/<game>/trackN.{ogg,mp3,flac,wav} (or TrackN) when
 *    they exist;
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

  var CD_EXTENSIONS = ["ogg", "mp3", "flac", "wav"];

  s.initSound = function() {
    var t = this;
    // a previous run's music must not carry on under this one
    if (t._sfx) t.shutdownSound();
    t._soundQueue = [];
    t._currentCDSound = 0;
    t._cdMusicTimer = 0;
    t._cdTimerRunning = false;
    t._sfx = {};             // sound id -> playing AudioBufferSourceNode
    t._cdTracks = {};        // track -> url, or null when there is no file
    t._cdAudio = null;
    t._cdStatus = null;
    t._soundsWarned = {};
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
      node.connect(ctx.destination);
      t._musicNode = node;
    }

    last = Date.now();
    t._musicClock = window.setInterval(function() {
      var now = Date.now(), ticks;
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

  // One AudioContext for the page, resumed on the first user gesture
  function audioContext() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ScummVM.audioContext) {
      ScummVM.audioContext = new Ctx();
      var resume = function() {
        if (ScummVM.audioContext.state == "suspended") ScummVM.audioContext.resume();
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
    src.connect(ctx.destination);
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
    t._cdTimerRunning = true;
    t.stopCD();
    t._cdStatus = {track: track, loops: numLoops, start: startFrame / 75,
                   end: duration ? (startFrame + duration) / 75 : 0};
    t.findCDTrack(track, function(url) {
      var status = t._cdStatus, audio;
      if (!url || status == null || status.track != track) return;
      audio = t._cdAudio = new Audio(url);
      audio.currentTime = status.start;
      audio.addEventListener("timeupdate", function() {
        if (status.end && audio.currentTime >= status.end) t.cdTrackEnded(audio, status);
      });
      audio.addEventListener("ended", function() { t.cdTrackEnded(audio, status); });
      var p = audio.play();
      // Blocked until the user clicks or presses a key: start it then, at
      // the point the game has reached (the CD timer counts 1/60 s)
      if (p && p.catch) p.catch(function() {
        var resume = function() {
          window.removeEventListener("mousedown", resume, true);
          window.removeEventListener("keydown", resume, true);
          if (t._cdAudio !== audio || !audio.paused) return;
          audio.currentTime = status.start + t._cdMusicTimer / 60;
          audio.play().catch(function() {});
        };
        window.addEventListener("mousedown", resume, true);
        window.addEventListener("keydown", resume, true);
      });
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

  // Look for a ripped copy of the track once, remembering the answer
  s.findCDTrack = function(track, callback) {
    var t = this, dir = "games/" + t._game + "/", i = 0, names = [], n, e;
    if (track in t._cdTracks) { callback(t._cdTracks[track]); return; }
    t._cdTracks[track] = null;
    // rippers write both "track1" and "Track1"; a case-sensitive server
    // only finds the one that is there
    for (e = 0; e < CD_EXTENSIONS.length; e++)
      for (n = 0; n < 2; n++)
        names.push((n ? "Track" : "track") + track + "." + CD_EXTENSIONS[e]);
    (function next() {
      if (i >= names.length) { callback(null); return; }
      var url = dir + names[i++];
      fetch(url, {method: "HEAD"}).then(function(r) {
        if (r.ok) { t._cdTracks[track] = url; callback(url); }
        else next();
      }, next);
    }());
  };

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

  // The machine is switched off: silence everything, and take down the
  // AdLib chip's audio callback and clock, which run outside the game loop
  s.shutdownSound = function() {
    var t = this;
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
