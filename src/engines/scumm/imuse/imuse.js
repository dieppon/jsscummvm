/*
 * iMUSE, the SCUMM music system, ported in part from ScummVM's
 * engines/scumm/imuse/ (imuse.cpp, imuse_player.cpp, imuse_part.cpp,
 * sysex_scumm.cpp) and audio/midiparser*.cpp.
 *
 * Monkey Island 1 CD's iMUSE sounds are short AdLib cues: an MDhd header
 * (priority, volume, speed...) and a type 2 Standard MIDI File whose
 * track sets up its parts with iMUSE SysEx messages -- allocate a part,
 * give it an AdLib instrument -- and then plays notes. A Player runs one
 * such sound; its Parts are its MIDI channels, each bound to one of the
 * AdLib driver's channels. The driver's 250 Hz timer drives everything.
 *
 * Monkey Island 2's music is all iMUSE, and its scripts steer it: they
 * ask how far a tune has got (the beat), set hooks the tune then jumps or
 * changes on, loop sections, fade volume and speed, and queue commands
 * to run when a tune reaches a marker. All of that is here, from
 * IMuseInternal::doCommand_internal and the Player. Still left out:
 * percussion, the MT-32/GM paths, and dynamic channel reallocation by
 * priority.
 */
(function(){
  var IMUSE_SYSEX_ID = 0x7D;
  var MKTAG_ADL = 0x41444C20;
  var TICKS_PER_BEAT = 480;
  var TRIGGER_ID = 0, COMMAND_ID = 1, QUEUE_SIZE = 64;
  // Player parameter faders (ParameterFader)
  var PF_VOLUME = 1, PF_TRANSPOSE = 3, PF_SPEED = 4;

  function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function s8(v) { return (v << 24) >> 24; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // imuse.cpp transpose_clamp: wrap by octaves into range
  function transposeClamp(a, b, c) {
    if (b > a) a += Math.floor((b - a + 11) / 12) * 12;
    if (c < a) a -= Math.floor((a - c + 11) / 12) * 12;
    return a;
  }

  // --- Part (imuse_part.cpp) ---------------------------------------------

  function Part(se) {
    this.se = se;
    this.player = null;
    this.mc = null;
  }
  Part.prototype = {
    setup: function(player) {
      var t = this;
      t.player = player;
      t.on = true;
      t.priEff = player.priority;
      t.pri = 0;
      t.vol = 127;
      t.volEff = player.volEff;
      t.pan = clamp(player.pan, -64, 63);
      t.panEff = t.pan;
      t.transposeEff = player.transpose;
      t.transpose = 0;
      t.detune = 0;
      t.detuneEff = player.detune;
      t.pitchbendFactor = 2;
      t.pitchbend = 0;
      t.instrument = null;
      t.unassignedInstrument = true;
      t.modwheel = 0;
      t.pedal = false;
      t.mc = null;
    },
    uninit: function() {
      if (!this.player) return;
      this.off(false);
      if (this.mc) this.mc.release();
      this.mc = null;
      this.player.removePart(this);
      this.player = null;
    },
    off: function(releaseChannel) {
      if (this.mc) {
        this.mc.sustain(false);
        this.mc.allNotesOff();
        if (!releaseChannel) return;
        this.mc.release();
        this.mc = null;
      }
    },
    // Has a channel, or gets one if it has an instrument to play with
    clearToTransmit: function() {
      if (this.mc) return true;
      if (this.instrument) {
        this.mc = this.se.driver.allocateChannel();
        if (this.mc) this.sendAll();
      }
      return false;
    },
    sendAll: function() {
      var mc = this.mc;
      if (!mc) return;
      mc.pitchBendFactor(this.pitchbendFactor);
      mc.transpose(this.transposeEff);
      mc.detune(this.detuneEff);
      mc.pitchBend(this.pitchbend);
      mc.volume(this.volEff);
      mc.sustain(this.pedal);
      mc.modulationWheel(this.modwheel);
      mc.panPosition(this.panEff + 0x40);
      if (this.instrument) mc.sysEx_customInstrument(MKTAG_ADL, this.instrument);
      mc.priority(this.priEff);
    },
    set_onoff: function(on) {
      if (this.on != on) {
        this.on = on;
        if (!on) this.off(false);
      }
    },
    set_pri: function(pri) {
      this.pri = pri;
      this.priEff = clamp(pri + this.player.priority, 0, 255);
      if (this.mc) this.mc.priority(this.priEff);
    },
    volume: function(value) {
      this.vol = value;
      this.sendVolume();
    },
    sendVolume: function() {
      this.volEff = ((this.vol + 1) * this.player.volEff) >> 7;
      if (this.mc) this.mc.volume(this.volEff);
    },
    set_pan: function(pan) {
      this.pan = pan;
      this.panEff = clamp(pan + this.player.pan, -64, 63);
      if (this.mc) this.mc.panPosition(this.panEff + 0x40);
    },
    set_transpose: function(transpose, lo, hi) {
      this.transpose = transpose;
      this.transposeEff = transpose == -128 ? 0 : transposeClamp(transpose + this.player.transpose, lo, hi);
      if (this.mc) this.mc.transpose(this.transposeEff);
    },
    set_detune: function(detune) {
      this.detune = detune;
      this.detuneEff = clamp(detune + this.player.detune, -128, 127);
      if (this.mc) this.mc.detune(this.detuneEff);
    },
    pitchBend: function(value) {
      this.pitchbend = value;
      if (this.mc) this.mc.pitchBend(value);
    },
    pitchBendFactor: function(value) {
      if (value > 12) return;
      this.pitchBend(0);
      this.pitchbendFactor = value;
      if (this.mc) this.mc.pitchBendFactor(value);
    },
    modulationWheel: function(value) {
      this.modwheel = value;
      if (this.mc) this.mc.modulationWheel(value);
    },
    sustain: function(value) {
      this.pedal = value;
      if (this.mc) this.mc.sustain(value);
    },
    set_instrument: function(bytes) {
      this.instrument = bytes;
      if (this.clearToTransmit()) this.mc.sysEx_customInstrument(MKTAG_ADL, bytes);
    },
    programChange: function(value) {
      this.load_global_instrument(value);
    },
    load_global_instrument: function(slot) {
      this.instrument = this.se.copyGlobalInstrument(slot);
      if (this.clearToTransmit()) this.mc.sysEx_customInstrument(MKTAG_ADL, this.instrument);
    },
    allNotesOff: function() {
      if (this.mc) this.mc.allNotesOff();
    },
    noteOn: function(note, velocity) {
      if (!this.on) return;
      if (this.unassignedInstrument) {
        this.unassignedInstrument = false;
        if (!this.instrument) return;
      }
      if (this.mc && this.instrument) this.mc.noteOn(note, velocity);
    },
    noteOff: function(note) {
      if (!this.on) return;
      if (this.mc) this.mc.noteOff(note);
    }
  };

  // --- Player (imuse_player.cpp, with MidiParser_SMF folded in) ------------

  function Player(se) {
    this.se = se;
    this.active = false;
    this.id = 0;
    this.parts = [];
  }
  Player.prototype = {
    start: function(id, data) {
      var t = this, mdhd = t.se.findTag(data, 0x4D446864), mthd = t.se.findTag(data, 0x4D546864),
          size, p;
      if (mthd < 0) return false;
      t.id = id;
      t.active = true;
      t.data = data;
      t.parts = [];
      t.scanning = false;
      t.noteOffset = 0;
      t.transitionTimer = 0;
      t.faders = [];
      for (p = 0; p < 4; p++) t.faders.push({param: 0});
      t.hookClear();
      // start_seq_sound(reset_vars)
      t.loopToBeat = 1;
      t.loopFromBeat = 1;
      t.trackIndex = 0;
      t.loopCounter = 0;
      t.loopToTick = 0;
      t.loopFromTick = 0;

      // loadStartParameters
      t.priority = 0x80;
      t.volume = 0x7F;
      t.volEff = 127;
      t.pan = 0;
      t.transpose = 0;
      t.detune = 0;
      t.speed = 128;
      if (mdhd >= 0) {
        size = be32(data, mdhd + 4);
        p = mdhd + 8;
        if (size && (data[p + 2] | data[p + 3] | data[p + 7])) {
          t.priority = data[p + 2];
          t.volume = data[p + 3];
          t.pan = s8(data[p + 4]);
          t.transpose = s8(data[p + 5]);
          t.detune = s8(data[p + 6]);
          t.speed = data[p + 7];
        }
      }

      // MidiParser_SMF::loadMusic, then setTrack(0)
      t.ppqn = (data[mthd + 12] << 8) | data[mthd + 13];
      p = t.se.findTag(data, 0x4D54726B, mthd);   // 'MTrk'
      if (p < 0) { t.active = false; return false; }
      t.trackStart = t.pos = p + 8;
      t.trackEnd = p + 8 + be32(data, p + 4);
      t.runningStatus = 0;
      t.setTempo(500000);
      t.setSpeed(t.speed);
      t.playTime = 0;
      t.playTick = 0;
      t.lastEventTime = 0;
      t.lastEventTick = 0;
      t.nextEvent = t.parseNextEvent();
      return true;
    },
    clear: function() {
      if (!this.active) return;
      while (this.parts.length) this.parts[0].uninit();
      this.active = false;
      this.id = 0;
      this.noteOffset = 0;
      this.speed = 128;
    },

    // --- what the scripts can ask and set (imuse_player.cpp) -----------

    // MidiParser::getTick, and the beat it falls in (1-based)
    getTick: function() { return this.playTick; },
    getBeatIndex: function() { return Math.floor(this.playTick / TICKS_PER_BEAT) + 1; },

    setSpeed: function(speed) {
      this.speed = speed & 0xFF;
      this.timerRate = (this.se.driver.getBaseTempo() * this.speed) >> 7;
    },
    setVolume: function(vol) {
      var i;
      if (vol > 127 || vol < 0) return -1;
      this.volume = vol;
      this.volEff = (127 * (vol + 1)) >> 7;
      for (i = 0; i < this.parts.length; i++) this.parts[i].volume(this.parts[i].vol);
      return 0;
    },
    setPriority: function(pri) {
      var i;
      this.priority = pri;
      for (i = 0; i < this.parts.length; i++) this.parts[i].set_pri(this.parts[i].pri);
    },
    setPan: function(pan) {
      var i;
      this.pan = pan;
      for (i = 0; i < this.parts.length; i++) this.parts[i].set_pan(this.parts[i].pan);
    },
    setDetune: function(detune) {
      var i;
      this.detune = detune;
      for (i = 0; i < this.parts.length; i++) this.parts[i].set_detune(this.parts[i].detune);
    },
    // MI2 uses -24/24 for AdLib
    setTranspose: function(relative, b) {
      var i;
      if (b > 24 || b < -24 || relative > 1) return -1;
      if (relative) b = transposeClamp(this.transpose + b, -7, 7);
      this.transpose = b;
      for (i = 0; i < this.parts.length; i++) this.parts[i].set_transpose(this.parts[i].transpose, -24, 24);
      return 0;
    },
    partSetTranspose: function(chan, relative, b) {
      var part;
      if (b > 24 || b < -24) return;
      part = this.getPart(chan);
      if (relative) b = transposeClamp(b + part.transpose, -7, 7);
      part.set_transpose(b, -24, 24);
    },

    setLoop: function(count, tobeat, totick, frombeat, fromtick) {
      if (tobeat + 1 >= frombeat) return false;
      if (tobeat == 0) tobeat = 1;
      this.loopToBeat = tobeat;
      this.loopToTick = totick;
      this.loopFromBeat = frombeat;
      this.loopFromTick = fromtick;
      this.loopCounter = count;
      return true;
    },
    clearLoop: function() { this.loopCounter = 0; },

    // HookDatas
    hookClear: function() {
      var z = function() { var a = [], i; for (i = 0; i < 16; i++) a.push(0); return a; };
      this.hook = {jump: [0, 0], transpose: 0, partOnoff: z(), partVolume: z(), partProgram: z(), partTranspose: z()};
    },
    setHook: function(cls, value, chan) {
      var h = this.hook, i, list;
      switch (cls) {
        case 0:
          if (value != h.jump[0]) { h.jump[1] = h.jump[0]; h.jump[0] = value; }
          return 0;
        case 1: h.transpose = value; return 0;
        case 2: list = h.partOnoff; break;
        case 3: list = h.partVolume; break;
        case 4: list = h.partProgram; break;
        case 5: list = h.partTranspose; break;
        default: return -1;
      }
      if (chan < 16) list[chan] = value;
      else if (chan == 16) for (i = 0; i < 16; i++) list[i] = value;
      return 0;
    },
    queryHook: function(param, chan) {
      var h = this.hook;
      switch (param) {
        case 18: return h.jump[0];
        case 19: return h.transpose;
        case 20: return h.partOnoff[chan];
        case 21: return h.partVolume[chan];
        case 22: return h.partProgram[chan];
        case 23: return h.partTranspose[chan];
      }
      return -1;
    },
    // Is this the hook the tune is waiting for? A hook under 0x80 is used
    // up once it matches.
    hookMatches: function(list, i, cmd) {
      if (cmd && list[i] != cmd) return false;
      if (cmd != 0 && cmd < 0x80) list[i] = 0;
      return true;
    },
    maybeJump: function(cmd, track, beat, tick) {
      var h = this.hook;
      if (cmd && h.jump[0] != cmd) return;
      if (cmd != 0 && cmd < 0x80) { h.jump[0] = h.jump[1]; h.jump[1] = 0; }
      this.jump(track, beat, tick);
    },
    maybeSetTranspose: function(b) {
      var h = this.hook;
      if (b[0] && h.transpose != b[0]) return;
      if (b[0] != 0 && b[0] < 0x80) h.transpose = 0;
      this.setTranspose(b[1], s8(b[2]));
    },
    maybePartOnoff: function(chan, b) {
      if (this.hookMatches(this.hook.partOnoff, chan, b[0])) this.getPart(chan).set_onoff(b[1] != 0);
    },
    maybeSetVolume: function(chan, b) {
      if (this.hookMatches(this.hook.partVolume, chan, b[0])) this.getPart(chan).volume(b[1]);
    },
    maybeSetProgram: function(chan, b) {
      if (this.hookMatches(this.hook.partProgram, chan, b[0])) this.getPart(chan).programChange(b[1]);
    },
    maybeSetTransposePart: function(chan, b) {
      if (this.hookMatches(this.hook.partTranspose, chan, b[0])) this.partSetTranspose(chan, b[1], s8(b[2]));
    },

    getParam: function(param, chan) {
      var t = this;
      switch (param) {
        case 0: return t.priority & 0xFF;
        case 1: return t.volume & 0xFF;
        case 2: return t.pan & 0xFF;
        case 3: return t.transpose & 0xFF;
        case 4: return t.detune & 0xFF;
        case 5: return t.speed;
        case 6: return t.trackIndex;
        case 7: return t.getBeatIndex();
        case 8: return t.getTick() % TICKS_PER_BEAT;
        case 9: return t.loopCounter;
        case 10: return t.loopToBeat;
        case 11: return t.loopToTick;
        case 12: return t.loopFromBeat;
        case 13: return t.loopFromTick;
        case 14: case 15: case 16: case 17: return t.queryPartParam(param, chan);
        case 18: case 19: case 20: case 21: case 22: case 23: return t.queryHook(param, chan);
      }
      return -1;
    },
    queryPartParam: function(param, chan) {
      var i, part;
      for (i = 0; i < this.parts.length; i++) {
        part = this.parts[i];
        if (part.chan != chan) continue;
        switch (param) {
          case 14: return part.on ? 1 : 0;
          case 15: return part.vol;
          case 17: return part.transpose;
        }
        return -1;
      }
      return 129;
    },

    // Volume, detune and speed can be faded over a time, in 60ths of a
    // second
    addParameterFader: function(param, target, time) {
      var t = this, start, i, f, best = null, diff;
      switch (param) {
        case PF_VOLUME:
          if (!time) { t.setVolume(target); return 0; }
          start = t.volume;
        break;
        case PF_TRANSPOSE:
          if (!time) { t.setDetune(target); return 0; }
          start = t.detune;
        break;
        case PF_SPEED:
          start = t.speed;
        break;
        case 127:
          for (i = 0; i < t.faders.length; i++) t.faders[i].param = 0;
          return 0;
        default:
          return 0;
      }
      for (i = 0; i < t.faders.length; i++) {
        f = t.faders[i];
        if (f.param == param) { best = f; break; }
        if (!f.param) best = f;
      }
      if (!best) return -1;
      diff = target - start;
      best.param = param;
      best.state = start;
      best.ttime = best.cntdwn = time;
      best.dir = diff >= 0 ? 1 : -1;
      best.incr = (diff / time) | 0;
      best.ifrac = Math.abs(diff) % time;
      best.irem = 0;
      return 0;
    },
    transitionParameters: function() {
      var t = this, i, f, mod;
      t.transitionTimer += t.se.driver.getBaseTempo();
      while (t.transitionTimer >= 16667) {
        t.transitionTimer -= 16667;
        for (i = 0; i < t.faders.length; i++) {
          f = t.faders[i];
          if (!f.param) continue;
          mod = f.incr;
          f.irem += f.ifrac;
          if (f.irem >= f.ttime) { f.irem -= f.ttime; mod += f.dir; }
          if (!mod) {
            if (!f.cntdwn || !--f.cntdwn) f.param = 0;
            continue;
          }
          f.state += mod;
          switch (f.param) {
            case PF_VOLUME:
              if (f.state >= 0 && f.state <= 127) {
                t.setVolume(f.state);
                if (f.state == 0) { t.clear(); return; }
              }
            break;
            case PF_TRANSPOSE:
              if (f.state >= -9216 && f.state <= 9216) t.setDetune(f.state);
            break;
            case PF_SPEED:
              if (f.state >= 0 && f.state <= 127) t.setSpeed(f.state);
            break;
            default:
              f.param = 0;
          }
          if (!f.cntdwn || !--f.cntdwn) f.param = 0;
        }
      }
    },
    // fading to silence, which stops the tune: as good as stopped already
    isFadingOut: function() {
      var i, f;
      for (i = 0; i < this.faders.length; i++) {
        f = this.faders[i];
        if (f.param == PF_VOLUME &&
            this.volume + f.cntdwn * f.incr + Math.floor((f.irem + f.cntdwn * f.ifrac) / f.ttime) * f.dir == 0)
          return true;
      }
      return false;
    },

    // Move to a point with everything set up as it would be there -- the
    // tune's controllers and SysEx run on the way, its notes are only noted
    // -- then sound the notes that would be held
    scan: function(totrack, tobeat, totick) {
      var t = this, i, j;
      if (!t.active) return -1;
      if (tobeat == 0) tobeat++;
      for (i = 0; i < t.parts.length; i++) t.parts[i].off(false);
      t.activeNotes = [];
      for (i = 0; i < 128; i++) t.activeNotes.push(0);
      t.scanning = true;
      if (!t.jumpToTick((tobeat - 1) * TICKS_PER_BEAT + totick, true)) {
        t.scanning = false;
        return -1;
      }
      t.scanning = false;
      for (i = 0; i < 16; i++)
        for (j = 0; j < 128; j++)
          if (t.activeNotes[j] & (1 << i)) t.getPart(i).noteOn(j, 80);
      if (t.trackIndex != totrack) { t.trackIndex = totrack; t.loopCounter = 0; }
      return 0;
    },
    setTempo: function(tempo) {
      this.psecPerTick = Math.floor((tempo + (this.ppqn >> 2)) / this.ppqn);
    },
    getPart: function(chan) {
      var i, part;
      for (i = 0; i < this.parts.length; i++)
        if (this.parts[i].chan == chan) return this.parts[i];
      part = new Part(this.se);
      part.chan = chan;
      part.setup(this);
      this.parts.push(part);
      return part;
    },
    removePart: function(part) {
      var i = this.parts.indexOf(part);
      if (i >= 0) this.parts.splice(i, 1);
    },

    readVLQ: function() {
      var v = 0, b, d = this.data;
      do {
        b = d[this.pos++];
        v = (v << 7) | (b & 0x7F);
      } while (b & 0x80);
      return v;
    },
    // MidiParser_SMF::parseNextEvent
    parseNextEvent: function() {
      var t = this, d = t.data, ev = {}, b;
      if (t.pos >= t.trackEnd) return {delta: 0, event: 0xFF, type: 0x2F};
      ev.delta = t.readVLQ();
      b = d[t.pos];
      if (b < 0x80) {
        ev.event = t.runningStatus;
      } else {
        ev.event = b;
        t.pos++;
      }
      if (ev.event < 0xF0) t.runningStatus = ev.event;
      switch (ev.event >> 4) {
        case 0xC: case 0xD:
          ev.p1 = d[t.pos++];
          ev.p2 = 0;
        break;
        case 0x8: case 0x9: case 0xA: case 0xB: case 0xE:
          ev.p1 = d[t.pos++];
          ev.p2 = d[t.pos++];
          // a note on at velocity 0 is a note off
          if ((ev.event >> 4) == 0x9 && ev.p2 == 0) ev.event = 0x80 | (ev.event & 0xF);
        break;
        case 0xF:
          if (ev.event == 0xFF) {
            ev.type = d[t.pos++];
            ev.length = t.readVLQ();
            ev.dataPos = t.pos;
            t.pos += ev.length;
          } else if (ev.event == 0xF0 || ev.event == 0xF7) {
            ev.length = t.readVLQ();
            ev.dataPos = t.pos;
            t.pos += ev.length;
          }
        break;
      }
      return ev;
    },

    // MidiParser::onTimer: play every event due before the end of this tick
    onTimer: function() {
      var t = this, endTime, ev, eventTick, eventTime, beat, tick;
      if (!t.active) return;
      // Player::onTimer: parameter fades, then a loop due to jump back
      t.transitionParameters();
      if (!t.active) return;
      beat = Math.floor(t.playTick / TICKS_PER_BEAT) + 1;
      tick = t.playTick % TICKS_PER_BEAT;
      if (t.loopCounter && (beat > t.loopFromBeat || (beat == t.loopFromBeat && tick >= t.loopFromTick))) {
        t.loopCounter--;
        t.jump(t.trackIndex, t.loopToBeat, t.loopToTick);
      }
      endTime = t.playTime + t.timerRate;
      for (;;) {
        ev = t.nextEvent;
        eventTick = t.lastEventTick + ev.delta;
        eventTime = t.lastEventTime + (eventTick - t.lastEventTick) * t.psecPerTick;
        if (eventTime > endTime) break;
        t.lastEventTime = eventTime;
        t.lastEventTick = eventTick;
        t.playTick = eventTick;
        t.jumped = false;
        if (!t.processEvent(ev)) return;
        // a jump repositions everything and ends this tick's parsing
        if (t.jumped) return;
        t.nextEvent = t.parseNextEvent();
      }
      t.playTime = endTime;
      t.playTick = Math.floor((endTime - t.lastEventTime) / t.psecPerTick) + t.lastEventTick;
    },

    // Player::jump: only one track here; beats are 1-based
    jump: function(track, beat, tick) {
      var t = this, i;
      if (!t.jumpToTick((beat - 1) * 480 + tick)) return false;
      // turn_off_pedals
      for (i = 0; i < t.parts.length; i++)
        if (t.parts[i].pedal) t.parts[i].sustain(false);
      return true;
    },

    // MidiParser::jumpToTick: rescan the track from the start to `tick`,
    // keeping only tempo changes on the way. If the track ends first the
    // position is left as it was. Notes already sounding carry on.
    jumpToTick: function(tick, fireEvents) {
      var t = this, saved = {pos: t.pos, runningStatus: t.runningStatus, nextEvent: t.nextEvent,
            lastEventTick: t.lastEventTick, lastEventTime: t.lastEventTime, playTime: t.playTime,
            playTick: t.playTick, psecPerTick: t.psecPerTick}, ev, eventTick, k;
      t.pos = t.trackStart;
      t.runningStatus = 0;
      t.lastEventTick = 0;
      t.lastEventTime = 0;
      t.playTime = 0;
      t.playTick = 0;
      t.nextEvent = t.parseNextEvent();
      if (tick > 0) {
        for (;;) {
          ev = t.nextEvent;
          eventTick = t.lastEventTick + ev.delta;
          if (eventTick >= tick) {
            t.playTime += (tick - t.lastEventTick) * t.psecPerTick;
            t.playTick = tick;
            break;
          }
          if (ev.event == 0xFF && ev.type == 0x2F) {
            for (k in saved) t[k] = saved[k];
            return false;
          }
          t.lastEventTime += (eventTick - t.lastEventTick) * t.psecPerTick;
          t.playTime = t.lastEventTime;
          t.lastEventTick = eventTick;
          t.playTick = eventTick;
          if (fireEvents) t.processEvent(ev);
          else if (ev.event == 0xFF && ev.type == 0x51 && ev.length == 3)
            t.setTempo((t.data[ev.dataPos] << 16) | (t.data[ev.dataPos + 1] << 8) | t.data[ev.dataPos + 2]);
          if (!t.active) return false;
          t.nextEvent = t.parseNextEvent();
        }
      }
      t.jumped = true;
      return true;
    },

    processEvent: function(ev) {
      var t = this, d = t.data, len;
      if (ev.event == 0xFF) {
        if (ev.type == 0x2F) {        // end of track
          t.clear();
          return false;
        }
        if (ev.type == 0x51 && ev.length == 3)
          t.setTempo((d[ev.dataPos] << 16) | (d[ev.dataPos + 1] << 8) | d[ev.dataPos + 2]);
        return true;
      }
      if (ev.event == 0xF0) {
        len = ev.length;
        if (d[ev.dataPos + len - 1] == 0xF7) len--;
        t.sysEx(ev.dataPos, len);
        return t.active;
      }
      t.send(ev.event, ev.p1, ev.p2);
      return t.active;
    },

    // Player::send
    send: function(status, p1, p2) {
      var t = this, chan = status & 0x0F, part;
      switch (status >> 4) {
        case 0x8:
          if (t.scanning) t.activeNotes[p1] &= ~(1 << chan);
          else t.getPart(chan).noteOff(p1);
        break;
        case 0x9:
          p1 += t.noteOffset;
          if (t.scanning) t.activeNotes[p1] |= 1 << chan;
          else t.getPart(chan).noteOn(p1, p2);
        break;
        case 0xB:
          part = t.getPart(chan);
          switch (p1) {
            case 1: part.modulationWheel(p2); break;
            case 7: part.volume(p2); break;
            case 10: part.set_pan(p2 - 0x40); break;
            case 16: part.pitchBendFactor(p2); break;
            case 17: part.set_detune(p2 - 0x40); break;
            case 18: part.set_pri(p2 - 0x40); break;
            case 64: part.sustain(p2 != 0); break;
            case 123: part.allNotesOff(); break;
          }
        break;
        case 0xC:
          if (p1 < 32) t.getPart(chan).load_global_instrument(p1);
        break;
        case 0xE:
          t.getPart(chan).pitchBend(((p2 << 7) | p1) - 0x2000);
        break;
      }
    },

    // Player::sysEx, then sysexHandler_Scumm
    sysEx: function(pos, len) {
      var t = this, d = t.data, code, part, buf, a;
      if (d[pos] != IMUSE_SYSEX_ID) return;
      pos++;
      len -= 2;
      code = d[pos++];
      switch (code) {
        case 0:    // allocate a part
          part = t.getPart(d[pos] & 0x0F);
          buf = t.decodeSysexBytes(pos + 1, len - 1);
          part.set_onoff(buf[0] & 0x01);
          part.set_pri(buf[1]);
          part.volume(buf[2]);
          part.set_pan(s8(buf[3]));
          part.set_transpose(s8(buf[4]), -12, 12);
          part.set_detune(s8(buf[5]));
          part.pitchBendFactor(buf[6]);
          part.instrument = t.se.copyGlobalInstrument(buf[7]);
          if (!part.mc) part.mc = t.se.driver.allocateChannel();
          part.sendAll();
        break;
        case 1:    // shut down a part
          part = t.getPart(d[pos]);
          if (part) part.uninit();
        break;
        case 2:    // start of song
          while (t.parts.length) t.parts[0].uninit();
        break;
        case 16:   // AdLib instrument for a part
          a = d[pos++] & 0x0F;
          pos++;   // hardware type
          part = t.getPart(a);
          if (len == 62 || len == 48) part.set_instrument(t.decodeSysexBytes(pos, len - 2).slice(0, 30));
        break;
        case 17:   // AdLib instrument for a global slot
          pos += 2;
          a = d[pos++];
          if (len == 63 || len == 49) t.se.globalInstruments[a] = t.decodeSysexBytes(pos, len - 3).slice(0, 30);
        break;
        case 48:   // hook: jump
          if (t.scanning) break;
          buf = t.decodeSysexBytes(pos + 1, len - 1);
          t.maybeJump(buf[0], (buf[1] << 8) | buf[2], (buf[3] << 8) | buf[4], (buf[5] << 8) | buf[6]);
        break;
        case 49:   // hook: global transpose
          t.maybeSetTranspose(t.decodeSysexBytes(pos + 1, len - 1));
        break;
        case 50:   // hook: part on/off
          a = d[pos] & 0x0F;
          t.maybePartOnoff(a, t.decodeSysexBytes(pos + 1, len - 1));
        break;
        case 51:   // hook: part volume
          a = d[pos] & 0x0F;
          t.maybeSetVolume(a, t.decodeSysexBytes(pos + 1, len - 1));
        break;
        case 52:   // hook: part program
          a = d[pos] & 0x0F;
          t.maybeSetProgram(a, t.decodeSysexBytes(pos + 1, len - 1));
        break;
        case 53:   // hook: part transpose
          a = d[pos] & 0x0F;
          t.maybeSetTransposePart(a, t.decodeSysexBytes(pos + 1, len - 1));
        break;
        case 64:   // markers: each may set off commands queued for it
          pos++;
          len--;
          while (len-- > 0) {
            t.se.handleMarker(t.id, d[pos++]);
            if (!t.active) return;
          }
        break;
        case 80:   // loop
          buf = t.decodeSysexBytes(pos + 1, len - 1);
          t.setLoop((buf[0] << 8) | buf[1], (buf[2] << 8) | buf[3], (buf[4] << 8) | buf[5],
                    (buf[6] << 8) | buf[7], (buf[8] << 8) | buf[9]);
        break;
        case 81:   // end loop
          t.clearLoop();
        break;
        default:
          // parameter adjust (33), set instrument (96): not for AdLib here
        break;
      }
    },

    // Player::decode_sysex_bytes: two nibbles per byte
    decodeSysexBytes: function(pos, len) {
      var d = this.data, out = [];
      while (len >= 0) {
        out.push((((d[pos] || 0) << 4) & 0xFF) | ((d[pos + 1] || 0) & 0x0F));
        pos += 2;
        len -= 2;
      }
      return out;
    }
  };

  // --- IMuseInternal --------------------------------------------------------

  ScummVM.IMuse = function(engine, driver) {
    var t = this, i;
    t.engine = engine;
    t.driver = driver;
    t.players = [];
    t.globalInstruments = [];
    for (i = 0; i < 32; i++) t.globalInstruments[i] = null;
    t.queue = [];
    for (i = 0; i < QUEUE_SIZE; i++) t.queue.push([0, 0, 0, 0, 0, 0, 0, 0]);
    t.clearQueue();
    driver.setTimerCallback(function() { t.onTimer(); });
  };

  ScummVM.IMuse.prototype = {
    // Offset of a 4-byte tag in the resource, or -1; IMuseInternal::
    // findStartOfSound searches the first few dozen bytes the same way
    findTag: function(data, tag, from) {
      var i;
      for (i = from || 0; i + 4 <= data.length; i++)
        if (be32(data, i) == tag) return i;
      return -1;
    },

    // An all-zero AdLib instrument stands in for an unset global slot, as
    // in copyGlobalInstrument
    copyGlobalInstrument: function(slot) {
      var g = this.globalInstruments[slot];
      if (g) return g.slice();
      var z = [];
      for (var i = 0; i < 30; i++) z.push(0);
      return z;
    },

    findPlayer: function(id) {
      for (var i = 0; i < this.players.length; i++)
        if (this.players[i].active && this.players[i].id == id) return this.players[i];
      return null;
    },

    isMI2: function() { return this.engine._game == "monkey2"; },

    // startSound_internal: a sound already playing starts over. MI2 has
    // two pairs of tunes that a quick player can leave playing together
    // (ScummVM's workarounds for bug #1410).
    startSound: function(id, data) {
      var t = this, p;
      if (t.isMI2()) {
        if (id == 107 && t.getSoundStatus(100) == 1) return false;
        if (id == 100 && t.getSoundStatus(107) == 1) t.stopSound(107);
        if ((id == 100 || id == 115 || id == 118) && t.getSoundStatus(113) == 1) t.stopSound(113);
      }
      p = t.findPlayer(id);
      if (p) p.clear();
      else {
        p = new Player(t);
        t.players.push(p);
      }
      return p.start(id, data);
    },

    stopSound: function(id) {
      var p = this.findPlayer(id);
      if (!p) return -1;
      p.clear();
      return 0;
    },

    stopAllSounds: function() {
      this.clearQueue();
      for (var i = 0; i < this.players.length; i++) this.players[i].clear();
      this.players = [];
      return 0;
    },

    // 1 if playing, 2 if waiting in the command queue to start. MI2 counts
    // a tune fading out as stopped already (ScummVM's workaround for bug
    // #385, music missing after a quick room change).
    getSoundStatus: function(id, ignoreFadeouts) {
      var t = this, i, p;
      if (ignoreFadeouts === undefined) ignoreFadeouts = true;
      if (!t.isMI2()) ignoreFadeouts = false;
      for (i = 0; i < t.players.length; i++) {
        p = t.players[i];
        if (p.active && (!ignoreFadeouts || !p.isFadingOut())) {
          if (id == -1) return p.id;
          if (p.id == id) return 1;
        }
      }
      return id == -1 ? 0 : t.queueSoundStatus(id);
    },

    // --- the command queue ---------------------------------------------
    // A script queues a trigger -- a tune and a marker in it -- then the
    // commands to run when the tune gets there.
    clearQueue: function() {
      var t = this;
      t.queueAdding = false;
      t.queueCleared = true;
      t.queuePos = 0;
      t.queueEnd = 0;
      t.triggerCount = 0;
      return 0;
    },
    enqueueTrigger: function(sound, marker) {
      var t = this, pos = t.queuePos, p = t.queue[pos];
      p[0] = TRIGGER_ID;
      p[1] = sound;
      p[2] = marker;
      pos = (pos + 1) % QUEUE_SIZE;
      if (t.queueEnd == pos) {
        t.queuePos = (pos - 1 + QUEUE_SIZE) % QUEUE_SIZE;
        return -1;
      }
      t.queuePos = pos;
      t.queueAdding = true;
      t.queueSound = sound;
      t.queueMarker = marker;
      return 0;
    },
    enqueueCommand: function(a) {
      var t = this, i = t.queuePos, p, k;
      if (i == t.queueEnd) return -1;
      if (a[1] == -1) {
        t.queueAdding = false;
        t.triggerCount++;
        return 0;
      }
      p = t.queue[i];
      p[0] = COMMAND_ID;
      for (k = 1; k < 8; k++) p[k] = a[k] || 0;
      i = (i + 1) % QUEUE_SIZE;
      if (t.queueEnd != i) { t.queuePos = i; return 0; }
      t.queuePos = (i - 1 + QUEUE_SIZE) % QUEUE_SIZE;
      return -1;
    },
    queryQueue: function(param) {
      var t = this;
      switch (param) {
        case 0: return t.triggerCount;
        case 1: return t.queueEnd == t.queuePos ? -1 : t.queue[t.queueEnd][1];
        case 2: return t.queueEnd == t.queuePos ? 0xFF : t.queue[t.queueEnd][2];
      }
      return -1;
    },
    queueSoundStatus: function(sound) {
      var t = this, i = t.queueEnd, a;
      while (i != t.queuePos) {
        a = t.queue[i];
        if (a[0] == COMMAND_ID && a[1] == 8 && a[2] == sound) return 2;
        i = (i + 1) % QUEUE_SIZE;
      }
      return 0;
    },
    // A tune passed a marker: if it is the trigger at the head of the
    // queue, run the commands queued after it
    handleMarker: function(id, data) {
      var t = this, p;
      if (t.queueEnd == t.queuePos || (t.queueAdding && t.queueSound == id && data == t.queueMarker)) return;
      p = t.queue[t.queueEnd];
      if (p[0] != TRIGGER_ID || id != p[1] || data != p[2]) return;
      t.triggerCount--;
      t.queueCleared = false;
      t.queueEnd = (t.queueEnd + 1) % QUEUE_SIZE;
      while (t.queueEnd != t.queuePos && t.queue[t.queueEnd][0] == COMMAND_ID && !t.queueCleared) {
        p = t.queue[t.queueEnd];
        t.doCommand([p[1], p[2], p[3], p[4], p[5], p[6], p[7], 0]);
        t.queueEnd = (t.queueEnd + 1) % QUEUE_SIZE;
      }
    },

    // doCommand_internal: param 0 runs the sound system, param 1 one tune
    doCommand: function(args) {
      var t = this, a = [], i, cmd, param, player = null, part;
      for (i = 0; i < 8; i++) a[i] = args[i] || 0;
      cmd = a[0] & 0xFF;
      param = (a[0] >> 8) & 0xFF;
      if (param == 0) {
        switch (cmd) {
          case 6: return a[1] > 127 ? -1 : 0;      // master volume: the page's mute
          case 7: return 127;
          case 8: return t.engine.startMusicNow(a[1]) ? 0 : -1;
          case 9: return t.stopSound(a[1]);
          case 10: case 11: return t.stopAllSounds();
          case 13: return t.getSoundStatus(a[1], true);
          case 16: case 17: case 18: return 0;    // volume channels
          case 2: case 3: return 0;
        }
        return -1;
      }
      if (param != 1) return -1;
      if ((1 << cmd) & 0x783FFF) {
        player = t.findPlayer(a[1]);
        if (!player) return -1;
        if ((1 << cmd) & (1 << 11 | 1 << 22)) {
          if (a[2] < 0 || a[2] > 15) return -1;
          part = player.getPart(a[2]);
        }
      }
      switch (cmd) {
        case 0: case 19: return player.getParam(a[2], a[3]);
        case 1: player.setPriority(a[2]); return 0;
        case 2: return player.setVolume(a[2]);
        case 3: player.setPan(a[2]); return 0;
        case 4: return player.setTranspose(a[2], a[3]);
        case 5: player.setDetune(a[2]); return 0;
        case 6:
          // ScummVM's workaround for bug #2242: MI2 pauses the flourishes
          // as Rapp rises from his ashes, and can unpause them first
          if (!t.isMI2() || player.id != 183 || a[2] != 0) player.setSpeed(a[2]);
          return 0;
        case 7: return player.jump(a[2], a[3], a[4]) ? 0 : -1;
        case 8: return player.scan(a[2], a[3], a[4]);
        case 9: return player.setLoop(a[2], a[3], a[4], a[5], a[6]) ? 0 : -1;
        case 10: player.clearLoop(); return 0;
        case 11: part.set_onoff(a[3] != 0); return 0;
        case 12: case 20: return player.setHook(a[2], a[3], a[4]);
        case 13: return player.addParameterFader(PF_VOLUME, a[2], a[3]);
        case 14: return t.enqueueTrigger(a[1], a[2]);
        case 15: return t.enqueueCommand(a);
        case 16: return t.clearQueue();
        case 21: return -1;
        case 22: part.volume(a[3]); return 0;
        case 23: return t.queryQueue(a[1]);
        case 24: return 0;
      }
      return -1;
    },

    onTimer: function() {
      var i, live = [];
      for (i = 0; i < this.players.length; i++) {
        if (this.players[i].active) this.players[i].onTimer();
        if (this.players[i].active) live.push(this.players[i]);
      }
      this.players = live;
    }
  };
}());
