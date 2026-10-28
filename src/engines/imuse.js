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
 * The sounds use four of iMUSE's SysEx commands: start of song, allocate
 * part, AdLib instrument, and hook jump -- nine of the fifteen loop by
 * jumping back unconditionally. Left out, because none of them uses them:
 * hooks set from scripts, markers and triggers, loop commands, parameter
 * fades, percussion, the MT-32/GM paths, and dynamic channel reallocation
 * by priority.
 */
(function(){
  var IMUSE_SYSEX_ID = 0x7D;
  var MKTAG_ADL = 0x41444C20;

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
      t.timerRate = ((t.se.driver.getBaseTempo() * t.speed) >> 7);
      t.playTime = 0;
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
      var t = this, endTime, ev, eventTick, eventTime;
      if (!t.active) return;
      endTime = t.playTime + t.timerRate;
      for (;;) {
        ev = t.nextEvent;
        eventTick = t.lastEventTick + ev.delta;
        eventTime = t.lastEventTime + (eventTick - t.lastEventTick) * t.psecPerTick;
        if (eventTime > endTime) break;
        t.lastEventTime = eventTime;
        t.lastEventTick = eventTick;
        t.jumped = false;
        if (!t.processEvent(ev)) return;
        // a jump repositions everything and ends this tick's parsing
        if (t.jumped) return;
        t.nextEvent = t.parseNextEvent();
      }
      t.playTime = endTime;
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
    jumpToTick: function(tick) {
      var t = this, saved = {pos: t.pos, runningStatus: t.runningStatus, nextEvent: t.nextEvent,
            lastEventTick: t.lastEventTick, lastEventTime: t.lastEventTime, playTime: t.playTime,
            psecPerTick: t.psecPerTick}, ev, eventTick, k;
      t.pos = t.trackStart;
      t.runningStatus = 0;
      t.lastEventTick = 0;
      t.lastEventTime = 0;
      t.playTime = 0;
      t.nextEvent = t.parseNextEvent();
      if (tick > 0) {
        for (;;) {
          ev = t.nextEvent;
          eventTick = t.lastEventTick + ev.delta;
          if (eventTick >= tick) {
            t.playTime += (tick - t.lastEventTick) * t.psecPerTick;
            break;
          }
          if (ev.event == 0xFF && ev.type == 0x2F) {
            for (k in saved) t[k] = saved[k];
            return false;
          }
          if (ev.event == 0xFF && ev.type == 0x51 && ev.length == 3)
            t.setTempo((t.data[ev.dataPos] << 16) | (t.data[ev.dataPos + 1] << 8) | t.data[ev.dataPos + 2]);
          t.lastEventTime += (eventTick - t.lastEventTick) * t.psecPerTick;
          t.playTime = t.lastEventTime;
          t.lastEventTick = eventTick;
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
          t.getPart(chan).noteOff(p1);
        break;
        case 0x9:
          t.getPart(chan).noteOn(p1, p2);
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
        case 48:   // hook jump: unconditional for command 0; no script sets
                   // hooks here, so any other command never matches
          buf = t.decodeSysexBytes(pos + 1, len - 1);
          if (buf[0] == 0)
            t.jump((buf[1] << 8) | buf[2], (buf[3] << 8) | buf[4], (buf[5] << 8) | buf[6]);
        break;
        default:
          // markers, loops, parameter adjust: not used by these sounds
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

    // startSound_internal: a sound already playing starts over
    startSound: function(id, data) {
      var t = this, p = t.findPlayer(id);
      if (p) p.clear();
      else {
        p = new Player(t);
        t.players.push(p);
      }
      return p.start(id, data);
    },

    stopSound: function(id) {
      var p = this.findPlayer(id);
      if (p) p.clear();
    },

    stopAllSounds: function() {
      for (var i = 0; i < this.players.length; i++) this.players[i].clear();
      this.players = [];
    },

    getSoundStatus: function(id) {
      return this.findPlayer(id) ? 1 : 0;
    },

    // doCommand's basic commands (param 0); the rest manage hooks, fades
    // and per-player parameters, which these sounds do not use
    doCommand: function(args) {
      var cmd = args[0] & 0xFF, param = args[0] >> 8;
      if (param != 0) return 0;
      switch (cmd) {
        case 8: return this.engine.startSound(args[1]), 0;
        case 9: this.stopSound(args[1]); return 0;
        case 10: this.stopAllSounds(); return 0;
        case 13: return this.getSoundStatus(args[1]);
      }
      return 0;
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
