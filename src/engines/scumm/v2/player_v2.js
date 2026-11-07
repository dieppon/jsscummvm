/*
 * The music and sound effects of SCUMM v2 (Maniac Mansion, Zak McKracken),
 * ported from ScummVM's engines/scumm/players/player_v2base.cpp and
 * player_v2.cpp, as for an IBM PCjr or Tandy: three square-wave voices and
 * a noise channel.
 *
 * A sound is a small program for each of four channels: notes, rests,
 * loops and subroutines, and settings -- tempo, transpose, the volume
 * envelope ("hull") and a frequency wobble (freqmod). The player steps
 * them 236 times a second; the chip is rendered in between.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM;

  var NOTE_LENGTHS = [0,0,0,2,0,3,4,5,6,8,9,12,16,18,24,32,36,48,64,72,96];
  var HULL_OFFSETS = [0,12,24,36,48,60,72,88,104,120,136,256,152,164,180];
  var HULLS = [3,-1,0,0,0,0,0,0,0,-1,0,0,3,-1,0,32,0,-1,0,0,0,-1,0,0,3,-1,0,0,0,0,0,0,0,0,0,0,3,-1,0,2,0,-1,0,0,0,-1,0,0,3,-1,0,6,0,-1,0,0,0,-1,0,0,3,-1,0,16,0,-1,0,0,0,-1,0,0,60000,-1,-1000,20,0,0,0,0,40000,-1,-5000,5,0,-1,0,0,50000,-1,0,8,30000,-1,0,0,28000,-1,-5000,5,0,-1,0,0,60000,-1,-2000,16,0,0,0,0,28000,-1,-6000,5,0,-1,0,0,55000,-1,0,8,35000,-1,0,0,40000,-1,-2000,10,0,-1,0,0,60000,-1,0,4,-2000,8,0,0,40000,-1,-6000,5,0,-1,0,0,0,-1,150,340,-150,340,0,-1,0,-1,0,0,20000,-1,4000,7,1000,15,0,0,35000,-1,-2000,15,0,-1,0,0,35000,-1,500,20,0,0,0,0,45000,-1,-500,60,0,-1,0,0,44000,-1,-4400,10,0,-1,0,0,0,-1,0,0,53000,-1,-5300,10,0,-1,0,0,0,-1,0,0,63000,-1,-6300,10,0,-1,0,0,0,-1,0,0,44000,-1,-1375,32,0,-1,0,0,0,-1,0,0,53000,-1,-1656,32,0,-1,0,0,0,-1,0,0,63000,-1,-1968,32,0,-1,0,0,0,-1,0,0,44000,-1,-733,60,0,-1,0,0,0,-1,0,0,53000,-1,-883,60,0,-1,0,0,0,-1,0,0,63000,-1,-1050,60,0,-1,0,0,0,-1,0,0,44000,-1,-488,90,0,-1,0,0,0,-1,0,0,53000,-1,-588,90,0,-1,0,0,0,-1,0,0,63000,-1,-700,90,0,-1,0,0,0,-1,0,0];
  var FREQMOD_LENGTHS = [4096,4096,32,8192,4096];
  var FREQMOD_OFFSETS = [0,256,512,770,514];
  var FREQMOD_TABLE = [0,3,6,9,12,15,18,21,24,27,30,33,36,39,42,45,48,51,54,57,59,62,65,67,70,73,75,78,80,82,85,87,89,91,94,96,98,100,102,103,105,107,108,110,112,113,114,116,117,118,119,120,121,122,123,123,124,125,125,126,126,126,126,126,126,126,126,126,126,126,125,125,124,123,123,122,121,120,119,118,117,116,114,113,112,110,108,107,105,103,102,100,98,96,94,91,89,87,85,82,80,78,75,73,70,67,65,62,59,57,54,51,48,45,42,39,36,33,30,27,24,21,18,15,12,9,6,3,0,-3,-6,-9,-12,-15,-18,-21,-24,-27,-30,-33,-36,-39,-42,-45,-48,-51,-54,-57,-59,-62,-65,-67,-70,-73,-75,-78,-80,-82,-85,-87,-89,-91,-94,-96,-98,-100,-102,-103,-105,-107,-108,-110,-112,-113,-114,-116,-117,-118,-119,-120,-121,-122,-123,-123,-124,-125,-125,-126,-126,-126,-126,-126,-126,-126,-126,-126,-126,-126,-125,-125,-124,-123,-123,-122,-121,-120,-119,-118,-117,-116,-114,-113,-112,-110,-108,-107,-105,-103,-102,-100,-98,-96,-94,-91,-89,-87,-85,-82,-80,-78,-75,-73,-70,-67,-65,-62,-59,-57,-54,-51,-48,-45,-42,-39,-36,-33,-30,-27,-24,-21,-18,-15,-12,-9,-6,-3,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,-128,-127,-126,-125,-124,-123,-122,-121,-120,-119,-118,-117,-116,-115,-114,-113,-112,-111,-110,-109,-108,-107,-106,-105,-104,-103,-102,-101,-100,-99,-98,-97,-96,-95,-94,-93,-92,-91,-90,-89,-88,-87,-86,-85,-84,-83,-82,-81,-80,-79,-78,-77,-76,-75,-74,-73,-72,-71,-70,-69,-68,-67,-66,-65,-64,-63,-62,-61,-60,-59,-58,-57,-56,-55,-54,-53,-52,-51,-50,-49,-48,-47,-46,-45,-44,-43,-42,-41,-40,-39,-38,-37,-36,-35,-34,-33,-32,-31,-30,-29,-28,-27,-26,-25,-24,-23,-22,-21,-20,-19,-18,-17,-16,-15,-14,-13,-12,-11,-10,-9,-8,-7,-6,-5,-4,-3,-2,-1,-120,120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,-120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,41,35,-66,-124,-31,108,-42,-82,82,-112,73,-15,-15,-69,-23,-21,-77,-90,-37,60,-121,12,62,-103,36,94,13,28,6,-73,71,-34,-77,18,77,-56,67,-69,-117,-90,31,3,90,125,9,56,37,31,93,-44,-53,-4,-106,-11,69,59,19,13,-119,10,28,-37,-82,50,32,-102,80,-18,64,120,54,-3,18,73,50,-10,-98,125,73,-36,-83,79,20,-14,68,64,102,-48,107,-60,48,-73,50,59,-95,34,-10,34,-111,-99,-31,-117,31,-38,-80,-54,-103,2,-71,114,-99,73,44,-128,126,-59,-103,-43,-23,-128,-78,-22,-55,-52,83,-65,103,-42,-65,20,-42,126,45,-36,-114,102,-125,-17,87,73,97,-1,105,-113,97,-51,-47,30,-99,-100,22,114,114,-26,29,-16,-124,79,74,119,2,-41,-24,57,44,83,-53,-55,18,30,51,116,-98,12,-12,-43,-44,-97,-44,-92,89,126,53,-49,50,34,-12,-52,-49,-45,-112,45,72,-45,-113,117,-26,-39,29,42,-27,-64,-9,43,120,-127,-121,68,14,95,80,0,-44,97,-115,-66,123,5,21,7,59,51,-126,31,24,112,-110,-38,100,84,-50,-79,-123,62,105,21,-8,70,106,4,-106,115,14,-39,22,47,103,104,-44,-9,74,74,-48,87,104,118,-6,22,-69,17,-83,-82,36,-120,121,-2,82,-37,37,67,-27,60,-12,69,-45,-40,40,-50,11,-11,-59,96,89,61,-105,39,-118,89,118,45,-48,-62,-55,-51,104,-44,73,106,121,37,8,97,64,20,-79,59,106,-91,17,40,-63,-116,-42,-87,11,-121,-105,-116,47,-15,21,29,-102,-107,-63,-101,-31,-64,126,-23,-88,-102,-89,-122,-62,-75,84,-65,-102,-25,-39,35,-47,85,-112,56,40,-47,-39,108,-95,102,94,78,-31,48,-100,-2,-39,113,-97,-30,-91,-30,12,-101,-76,71,101,56,42,70,-119,-87,-126,121,122,118,120,-62,99,-79,38,-33,-38,41,109,62,98,-32,-106,18,52,-65,57,-90,63,-119,94,-15,109,14,-29,108,40,-95,30,32,29,-53,-62,3,63,65,7,-124,15,20,5,101,27,40,97,-55,-59,-25,44,-114,70,54,8,-36,-13,-88,-115,-2,-66,-14,-21,113,-1,-96,-48,59,117,6,-116,126,-121,120,115,77,-48,-66,-126,-66,-37,-62,70,65,43,-116,-6,48,127,112,-16,-89,84,-122,50,-107,-86,91,104,19,11,-26,-4,-11,-54,-66,125,-97,-119,-118,65,27,-3,-72,79,104,-10,114,123,20,-103,-51,-45,13,-16,68,58,-76,-90,102,83,51,11,-53,-95,16];
  var SPK_FREQ_TABLE = [36484,34436,32503,30679,28957,27332,25798,24350,22983,21693,20476,19326];
  var PCJR_FREQ_TABLE = [65472,61760,58304,55040,52032,49024,46272,43648,41216,38912,36736,34624];

  // (int16) casts in the original table
  HULLS = HULLS.map(function(v) { return v > 32767 ? v - 65536 : v; });

  var FREQ_HZ = 236, FIXP_SHIFT = 16, PCJR_DECAY = 0xA000, NG_PRESET = 0x0F35,
      FB_WNOISE = 0x12000, FB_PNOISE = 0x08000;

  // channel_data, a uint16 each
  var TIME_LEFT = 0, NEXT_CMD = 1, BASE_FREQ = 2, FREQ_DELTA = 3, FREQ = 4, VOLUME = 5,
      VOLUME_DELTA = 6, TEMPO = 7, INTER_NOTE_PAUSE = 8, TRANSPOSE = 9, NOTE_LENGTH = 10,
      HULL_CURVE = 11, HULL_OFFSET = 12, HULL_COUNTER = 13, FREQMOD_TABLE = 14,
      FREQMOD_OFFSET = 15, FREQMOD_INCR = 16, FREQMOD_MULTIPLIER = 17, FREQMOD_MODULO = 18,
      MUSIC_TIMER = 23, MUSIC_SCRIPT_NR = 24, CHANNEL_SIZE = 25;

  function s16(v) { return (v << 16) >> 16; }

  // v3: a 6-byte header, and the music timer counted by the player
  ScummVM.PlayerV2 = function(sampleRate, v3) {
    var t = this, i, out;
    t.pcjr = true;
    t.isV3 = !!v3;
    t.headerLen = v3 ? 6 : 4;      // GF_OLD_BUNDLE has 4
    t.freqs = PCJR_FREQ_TABLE;
    t.channels = [];
    for (i = 0; i < 5; i++) t.channels.push(new Uint16Array(CHANNEL_SIZE));
    t.currentNr = t.nextNr = 0;
    t.currentData = t.nextData = null;
    t.retaddr = 0;
    t.musicTimer = t.musicTimerCtr = 0;
    t.ticksPerMusicTimer = 65535;

    t.sampleRate = sampleRate;
    t.nextTickAt = 0;
    t.tickLen = Math.floor(sampleRate * 65536 / FREQ_HZ);
    t.level = 0;
    t.rng = NG_PRESET;
    t.decay = PCJR_DECAY;
    t.updateStep = Math.floor(sampleRate * 65536 / (111860 * 2));
    for (i = 0; (sampleRate << i) < 30000; i++) t.decay = Math.floor(t.decay * t.decay / 65536);
    t.timerOutput = 0;
    t.timerCount = [0, 0, 0, 0];
    // setMusicVolume(255): 2 dB a step
    t.volumetable = [];
    out = 255 * 128 / 3;
    for (i = 0; i < 15; i++) {
      t.volumetable[i] = out > 0xFFFF ? 0xFFFF : Math.floor(out);
      out /= 1.258925412;
    }
    t.volumetable[15] = 0;
  };

  ScummVM.PlayerV2.prototype = {
    clearChannel: function(i) { this.channels[i].fill(0); },

    chainSound: function(nr, data) {
      var t = this, offset = t.headerLen + (t.pcjr ? 10 : 2), i, c;
      t.currentNr = nr;
      t.currentData = data;
      for (i = 0; i < 4; i++) {
        t.clearChannel(i);
        c = t.channels[i];
        c[MUSIC_SCRIPT_NR] = nr;
        if (data) {
          c[NEXT_CMD] = data[offset + 2 * i] | (data[offset + 2 * i + 1] << 8);
          if (c[NEXT_CMD]) c[TIME_LEFT] = 1;
        }
      }
      t.musicTimer = 0;
    },
    chainNextSound: function() {
      var t = this;
      if (t.nextNr) {
        t.chainSound(t.nextNr, t.nextData);
        t.nextNr = 0;
        t.nextData = null;
      }
    },

    // Player_V2::startSound: a sound takes over if it matters as much as
    // the one playing; one that may start again later waits its turn
    startSound: function(nr, data) {
      var t = this, h = t.headerLen,
          cprio = t.currentData ? t.currentData[h] : 0, prio = data[h],
          nprio = t.nextData ? t.nextData[h] : 0, restartable = data[h + 1], tnr, tprio, tdata;
      if (!t.currentNr || cprio <= prio) {
        tnr = t.currentNr; tprio = cprio; tdata = t.currentData;
        t.chainSound(nr, data);
        nr = tnr; prio = tprio; data = tdata;
        restartable = data ? data[h + 1] : 0;
      }
      if (!t.currentNr) {
        nr = 0;
        t.nextNr = 0;
        t.nextData = null;
      }
      if (nr != t.currentNr && restartable && (!t.nextNr || nprio <= prio)) {
        t.nextNr = nr;
        t.nextData = data;
      }
    },
    stopSound: function(nr) {
      var t = this, i;
      if (t.nextNr == nr) { t.nextNr = 0; t.nextData = null; }
      if (t.currentNr == nr) {
        for (i = 0; i < 4; i++) t.clearChannel(i);
        t.currentNr = 0;
        t.currentData = null;
        t.chainNextSound();
      }
    },
    stopAllSounds: function() {
      var t = this, i;
      for (i = 0; i < 4; i++) t.clearChannel(i);
      t.nextNr = t.currentNr = 0;
      t.nextData = t.currentData = null;
    },
    getSoundStatus: function(nr) {
      return this.currentNr == nr || this.nextNr == nr ? 1 : 0;
    },
    getMusicTimer: function() { return this.isV3 ? this.musicTimer : this.channels[0][MUSIC_TIMER]; },

    // Player_V2Base::execute_cmd: run a channel's program until its next note
    executeCmd: function(channel) {
      var t = this, current = channel, d = t.currentData, p, opcode, value, offset, dest,
          tempo, note, octave, isLast, freq, i;
      if (channel[NEXT_CMD] == 0) return t.checkStopped();
      p = channel[NEXT_CMD];
      for (;;) {
        opcode = d[p++];
        if (opcode >= 0xF8) {
          switch (opcode) {
            case 0xF8:   // hull curve
              channel[HULL_CURVE] = HULL_OFFSETS[d[p] >> 1];
              p++;
            break;
            case 0xF9:   // freqmod curve
              channel[FREQMOD_TABLE] = FREQMOD_OFFSETS[d[p] >> 2];
              channel[FREQMOD_MODULO] = FREQMOD_LENGTHS[d[p] >> 2];
              p++;
            break;
            case 0xFD:   // clear another channel, then carry on with it
              value = Math.floor((d[p] | (d[p + 1] << 8)) / (CHANNEL_SIZE * 2));
              p += 2;
              if (value >= t.channels.length) value = 4;
              channel = t.channels[value];
              /* falls through */
            case 0xFA:   // clear this channel
              for (i = NEXT_CMD; i <= FREQMOD_MODULO; i++)
                if (i != TEMPO && i != NOTE_LENGTH && i != TIME_LEFT) channel[i] = 0;
            break;
            case 0xFB:   // return
              p = t.retaddr;
            break;
            case 0xFC:   // call
              offset = d[p] | (d[p + 1] << 8);
              p += 2;
              t.retaddr = p;
              p = offset;
            break;
            case 0xFE:   // loop
              opcode = d[p++];
              offset = s16(d[p] | (d[p + 1] << 8));
              p += 2;
              if (!channel[opcode >> 1] || --channel[opcode >> 1]) p += offset;
            break;
            case 0xFF:   // set a parameter
              opcode = d[p++];
              value = d[p] | (d[p + 1] << 8);
              channel[opcode >> 1] = value;
              p += 2;
              if (opcode == 14) t.ticksPerMusicTimer = 125;
              if (opcode == 0) return t.endCmd(current, p);
            break;
          }
          continue;
        }
        // notes, perhaps several at once on other channels
        for (;;) {
          dest = t.channels[(opcode >> 5) & 3];
          if (!(opcode & 0x80)) {
            tempo = channel[TEMPO] || 1;
            channel[TIME_LEFT] = tempo * (NOTE_LENGTHS[opcode & 0x1F] || 0);
            note = d[p++];
            isLast = note & 0x80;
            note &= 0x7F;
            if (note == 0x7F) return t.endCmd(current, p);
          } else {
            channel[TIME_LEFT] = ((opcode & 7) << 8) | d[p++];
            if (opcode & 0x10) return t.endCmd(current, p);
            isLast = 0;
            note = d[p++] & 0x7F;
          }
          dest[TIME_LEFT] = channel[TIME_LEFT];
          dest[NOTE_LENGTH] = channel[TIME_LEFT] - dest[INTER_NOTE_PAUSE];
          note = s16(note + s16(dest[TRANSPOSE]));
          while (note < 0) note += 12;
          octave = Math.floor(note / 12);
          note = note % 12;
          dest[HULL_OFFSET] = 0;
          dest[HULL_COUNTER] = 1;
          if (t.pcjr && dest === t.channels[3]) {
            dest[HULL_CURVE] = 196 + note * 12;
            freq = 384 - 64 * octave;
          } else {
            freq = t.freqs[note] >> octave;
          }
          dest[FREQ] = dest[BASE_FREQ] = freq;
          if (isLast) return t.endCmd(current, p);
          opcode = d[p++];
        }
      }
    },
    endCmd: function(channel, p) {
      if (channel[TIME_LEFT]) {
        channel[NEXT_CMD] = p;
        return;
      }
      channel[NEXT_CMD] = 0;
      this.checkStopped();
    },
    checkStopped: function() {
      var t = this, i;
      for (i = 0; i < 4; i++) if (t.channels[i][TIME_LEFT]) return;
      t.currentNr = 0;
      t.currentData = null;
      t.chainNextSound();
    },

    // Player_V2Base::next_freqs: one step of the envelope and the wobble
    nextFreqs: function(c) {
      var t = this, h, mod;
      c[VOLUME] += c[VOLUME_DELTA];
      c[BASE_FREQ] += c[FREQ_DELTA];
      if (c[FREQMOD_MODULO] > 0) c[FREQMOD_OFFSET] = (c[FREQMOD_OFFSET] + c[FREQMOD_INCR]) % c[FREQMOD_MODULO];
      else c[FREQMOD_OFFSET] = 0;
      mod = FREQMOD_TABLE[c[FREQMOD_TABLE] + (c[FREQMOD_OFFSET] >> 4)] || 0;
      c[FREQ] = Math.trunc(mod * c[FREQMOD_MULTIPLIER] / 256) + c[BASE_FREQ];
      if (c[NOTE_LENGTH] && !--c[NOTE_LENGTH]) {
        c[HULL_OFFSET] = 16;
        c[HULL_COUNTER] = 1;
      }
      if (!--c[TIME_LEFT]) t.executeCmd(c);
      if (c[HULL_COUNTER] && !--c[HULL_COUNTER]) {
        for (;;) {
          h = c[HULL_CURVE] + (c[HULL_OFFSET] >> 1);
          if (HULLS[h + 1] == -1) {
            c[VOLUME] = HULLS[h];
            if (HULLS[h] == 0) c[VOLUME_DELTA] = 0;
            c[HULL_OFFSET] += 4;
          } else {
            c[VOLUME_DELTA] = HULLS[h];
            c[HULL_COUNTER] = HULLS[h + 1];
            c[HULL_OFFSET] += 4;
            break;
          }
          if (h > HULLS.length) break;
        }
      }
    },
    nextTick: function() {
      var t = this, i;
      for (i = 0; i < 4; i++)
        if (t.channels[i][TIME_LEFT]) t.nextFreqs(t.channels[i]);
      if (t.musicTimerCtr++ >= t.ticksPerMusicTimer) {
        t.musicTimerCtr = 0;
        t.musicTimer++;
      }
    },

    // --- the chip -------------------------------------------------------

    squareGenerator: function(ch, freq, vol, noiseFeedback, buf, pos, len) {
      var t = this, period = t.updateStep * freq, i, duration, bit = 1 << ch, n;
      if (period == 0) period = t.updateStep;
      for (i = 0; i < len; i++) {
        duration = 0;
        if (t.timerOutput & bit) duration += t.timerCount[ch];
        t.timerCount[ch] -= 65536;
        while (t.timerCount[ch] <= 0) {
          if (noiseFeedback) {
            if (t.rng & 1) {
              t.rng ^= noiseFeedback;
              t.timerOutput ^= bit;
            }
            t.rng >>= 1;
          } else {
            t.timerOutput ^= bit;
          }
          if (t.timerOutput & bit) duration += period;
          t.timerCount[ch] += period;
        }
        if (t.timerOutput & bit) duration -= t.timerCount[ch];
        n = buf[pos + i] + Math.floor((duration - 32768) * t.volumetable[vol] / 65536);
        buf[pos + i] = n > 32767 ? 32767 : n < -32768 ? -32768 : n;
      }
    },
    // Player_V2::generatePCjrSamples
    generate: function(buf, pos, len) {
      var t = this, i, j, freq, vol, c, has = false, n, fb;
      for (i = 0; i < len; i++) buf[pos + i] = 0;
      for (i = 1; i < 3; i++) {
        freq = t.channels[i][FREQ] >> 6;
        if (t.channels[i][VOLUME] && t.channels[i][TIME_LEFT]) {
          for (j = 0; j < i; j++) {
            if (t.channels[j][VOLUME] && t.channels[j][TIME_LEFT] && freq == (t.channels[j][FREQ] >> 6)) {
              t.timerCount[i] = t.timerCount[j];
              t.timerOutput ^= (1 << i) & (t.timerOutput ^ (t.timerOutput << (i - j)));
            }
          }
        }
      }
      for (i = 0; i < 4; i++) {
        c = t.channels[i];
        freq = c[FREQ] >> 6;
        vol = (65535 - c[VOLUME]) >> 12;
        if (!c[VOLUME] || !c[TIME_LEFT]) {
          t.timerCount[i] -= len * 65536;
          if (t.timerCount[i] < 0) t.timerCount[i] = 0;
        } else if (i < 3) {
          has = true;
          t.squareGenerator(i, freq, vol, 0, buf, pos, len);
        } else {
          fb = (freq & 4) ? FB_WNOISE : FB_PNOISE;
          n = freq & 3;
          freq = n == 3 ? 2 * (t.channels[2][FREQ] >> 6) : 1 << (5 + n);
          has = true;
          t.squareGenerator(i, freq, vol, fb, buf, pos, len);
        }
      }
      if (t.level || has) {
        for (i = 0; i < len; i++) {
          t.level = Math.floor((t.level * t.decay + buf[pos + i] * (65536 - t.decay)) / 65536);
          buf[pos + i] = t.level;
        }
      }
    },
    // Player_V2::readBuffer: fill `out` (floats), stepping the player on time
    render: function(out) {
      var t = this, len = out.length, pos = 0, step, buf = t.buf;
      if (!buf || buf.length < len) buf = t.buf = new Int32Array(len);
      while (pos < len) {
        if (!(Math.floor(t.nextTickAt / 65536))) {
          t.nextTickAt += t.tickLen;
          t.nextTick();
        }
        step = Math.min(len - pos, Math.floor(t.nextTickAt / 65536));
        t.generate(buf, pos, step);
        t.nextTickAt -= step * 65536;
        pos += step;
      }
      for (pos = 0; pos < len; pos++) out[pos] = buf[pos] / 32768;
    }
  };

  /* --- in the engine --------------------------------------------------- */

  var engineMethods = {
    // the player, rendered by Web Audio, and a clock that steps it while
    // the browser holds sound back, so scripts timed by the music go on
    initMusicV2: function() {
      var t = this, ctx, player, node, last, lastAudio = 0, silent;
      if (t._playerV2) return t._playerV2;
      ctx = t.getAudioContext();
      player = t._playerV2 = new ScummVM.PlayerV2(ctx ? ctx.sampleRate : 44100, t._version == 3);
      if (ctx && ctx.createScriptProcessor) {
        node = ctx.createScriptProcessor(2048, 0, 1);
        node.onaudioprocess = function(ev) {
          lastAudio = Date.now();
          if (t._soundPaused) { ev.outputBuffer.getChannelData(0).fill(0); return; }
          player.render(ev.outputBuffer.getChannelData(0));
        };
        node.connect(ScummVM.audioOut);
        t._musicNode = node;
      }
      silent = new Float32Array(256);
      last = Date.now();
      t._musicClock = window.setInterval(function() {
        var now = Date.now(), n;
        if (t._soundPaused || (ctx && ctx.state == "running" && now - lastAudio < 250)) { last = now; return; }
        n = Math.floor((now - last) * FREQ_HZ / 1000);
        last += n * 1000 / FREQ_HZ;
        while (n-- > 0) player.nextTick();
      }, 20);
      return player;
    },

    // sound.cpp triggerSound: every v2 sound is the player's; a v3 sound
    // holds versions for several cards, and the PCjr's is its "WA" block
    // (sound.cpp readSoundResourceSmallHeader)
    triggerSound: function(id) {
      var t = this, r = t.getResourceAddress("sound", id), data, i, start = 0, len, pos, size, tag, total;
      if (!r) return;
      len = r.length;
      if (t._version == 3) {
        var b = function(o) { return r.readByteAt(o); };
        total = (b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)) >>> 0;
        if ((b(4) | (b(5) << 8)) == 0x4F52) return;   // RO: Roland only
        start = -1;
        for (pos = 6; pos + 6 <= total && pos + 6 <= r.length; ) {
          size = (b(pos) | (b(pos + 1) << 8) | (b(pos + 2) << 16) | (b(pos + 3) << 24)) >>> 0;
          tag = b(pos + 4) | (b(pos + 5) << 8);
          if (tag == 0x4157) { start = pos; len = size + 6; break; }   // WA
          if (tag == 0x4F53) { pos += 6; continue; }                    // SO: look inside
          if (size < 6) break;
          pos += size;
        }
        if (start < 0) return;
      }
      data = new Uint8Array(len);
      for (i = 0; i < len; i++) data[i] = start + i < r.length ? r.readByteAt(start + i) : 0;
      t.initMusicV2().startSound(id, data);
    },
    isSoundRunning: function(sound) {
      var t = this, i;
      if (t._playerV2 && t._playerV2.getSoundStatus(sound)) return 1;
      for (i = 0; i < t._soundQueue.length; i++)
        if (t._soundQueue[i] == sound) return 1;
      return 0;
    },
    stopSound: function(sound) {
      var t = this, i;
      if (t._playerV2) t._playerV2.stopSound(sound);
      for (i = 0; i < t._soundQueue.length; i++)
        if (t._soundQueue[i] == sound) t._soundQueue[i] = 0;
    },
    stopAllSounds: function() {
      var t = this;
      t._soundQueue = [];
      if (t._playerV2) t._playerV2.stopAllSounds();
    },
    updateMusicTimer: function() {
      var t = this;
      t.scummVar("music_timer", t._playerV2 ? t._playerV2.getMusicTimer() : 0);
    },
    shutdownSound: function() {
      var t = this;
      t._baseMethods.shutdownSound.call(t);
      t._playerV2 = null;
    }
  };
  // v2, and v3 played as on a PCjr (ScummVM's Player_V2 serves both)
  s.defineVersion("2", engineMethods);
  s.defineVersion("3", engineMethods);
}());
