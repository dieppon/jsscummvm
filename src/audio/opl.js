/*
 * YM3812 (OPL2) FM synthesis, ported from ScummVM's
 * audio/softsynth/opl/mame.cpp, itself the LGPL version of MAME's fmopl.c
 * (V0.37a, by Tatsuyuki Satoh) taken from AdPlug.
 *
 * Only the YM3812 is here, at ScummVM's high quality settings (ENV_BITS 16,
 * EG_ENT 4096). The timers, IRQ/status flags and the Y8950 extras are left
 * out; ScummVM drives the chip purely by register writes.
 *
 *   var opl = new ScummVM.OPL(44100);
 *   opl.writeReg(0x20, 0x01);
 *   opl.generate(floatBuffer, 0, 1024);   // mono, roughly -1..1
 */
(function(){
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var ScummVM = root.ScummVM = root.ScummVM || {};

  /* --- preliminary defines -------------------------------------------- */

  var OPL_ARRATE = 141280;    // RATE 4 =  2826.24ms @ 3.6MHz
  var OPL_DRRATE = 1956000;   // RATE 4 = 39280.64ms @ 3.6MHz

  var FREQ_BITS = 24;
  var FREQ_RATE = 1 << (FREQ_BITS - 20);
  var TL_BITS = FREQ_BITS + 2;

  var OPL_OUTSB = TL_BITS + 3 - 16;
  var OPL_MAXOUT = 0x7fff << OPL_OUTSB;
  var OPL_MINOUT = -(0x8000 << OPL_OUTSB);

  var SIN_ENT_SHIFT = 11;
  var SIN_ENT = 1 << SIN_ENT_SHIFT;
  var SIN_SHIFT = 24 - SIN_ENT_SHIFT;

  var ENV_BITS = 16;          // FMOPL_ENV_BITS_HQ
  var EG_ENT = 4096;          // FMOPL_EG_ENT_HQ
  var EG_OFF = (2 * EG_ENT) << ENV_BITS;
  var EG_DED = EG_OFF;
  var EG_DST = EG_ENT << ENV_BITS;
  var EG_AED = EG_DST;
  var EG_AST = 0;
  var EG_STEP = 96.0 / EG_ENT;

  var VIB_ENT = 512;
  var VIB_SHIFT = 32 - 9;
  var AMS_ENT = 512;
  var AMS_SHIFT = 32 - 9;

  var VIB_RATE_SHIFT = 8;
  var VIB_RATE = 1 << VIB_RATE_SHIFT;

  var ENV_MOD_RR = 0x00;
  var ENV_MOD_DR = 0x01;
  var ENV_MOD_AR = 0x02;

  var TL_MAX = EG_ENT * 2;

  var OPL_CLOCK = 3579545;

  /* --- tables --------------------------------------------------------- */

  var slot_array = [
     0, 2, 4, 1, 3, 5,-1,-1,
     6, 8,10, 7, 9,11,-1,-1,
    12,14,16,13,15,17,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1
  ];

  var KSL_TABLE_SEED = [
    /* OCT 0 */
    0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
    0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
    /* OCT 1 */
    0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000,
    0.000, 0.750, 1.125, 1.500, 1.875, 2.250, 2.625, 3.000,
    /* OCT 2 */
    0.000, 0.000, 0.000, 0.000, 0.000, 1.125, 1.875, 2.625,
    3.000, 3.750, 4.125, 4.500, 4.875, 5.250, 5.625, 6.000,
    /* OCT 3 */
    0.000, 0.000, 0.000, 1.875, 3.000, 4.125, 4.875, 5.625,
    6.000, 6.750, 7.125, 7.500, 7.875, 8.250, 8.625, 9.000,
    /* OCT 4 */
    0.000, 0.000, 3.000, 4.875, 6.000, 7.125, 7.875, 8.625,
    9.000, 9.750, 10.125, 10.500, 10.875, 11.250, 11.625, 12.000,
    /* OCT 5 */
    0.000, 3.000, 6.000, 7.875, 9.000, 10.125, 10.875, 11.625,
    12.000, 12.750, 13.125, 13.500, 13.875, 14.250, 14.625, 15.000,
    /* OCT 6 */
    0.000, 6.000, 9.000, 10.875, 12.000, 13.125, 13.875, 14.625,
    15.000, 15.750, 16.125, 16.500, 16.875, 17.250, 17.625, 18.000,
    /* OCT 7 */
    0.000, 9.000, 12.000, 13.875, 15.000, 16.125, 16.875, 17.625,
    18.000, 18.750, 19.125, 19.500, 19.875, 20.250, 20.625, 21.000
  ];

  // sustain level: 0, 3, 6, ... 42, 93 dB
  var SL_TABLE_SEED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 31];

  // multiple x2: 1/2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15
  var MUL_TABLE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];

  var KSL_TABLE = new Int32Array(8 * 16);
  var SL_TABLE = new Int32Array(16);
  // TL_TABLE[0 .. TL_MAX) is the plus section, [TL_MAX .. 2*TL_MAX) minus
  var TL_TABLE = new Int32Array(TL_MAX * 2);
  // the C code keeps pointers into TL_TABLE; these are indices into it
  var SIN_TABLE = new Int32Array(SIN_ENT * 4);
  var AMS_TABLE = new Int32Array(AMS_ENT * 2);
  var VIB_TABLE = new Int32Array(VIB_ENT * 2);
  var ENV_CURVE = new Int32Array(2 * EG_ENT + 1);

  // OPLBuildTables + OPLOpenTable
  (function() {
    var i, s, t, j, rate, pom;

    for (i = 0; i < KSL_TABLE_SEED.length; i++)
      KSL_TABLE[i] = (KSL_TABLE_SEED[i] / (EG_STEP / 2)) >>> 0;
    for (i = 0; i < SL_TABLE_SEED.length; i++)
      SL_TABLE[i] = ((SL_TABLE_SEED[i] * ((3 / EG_STEP) * (1 << ENV_BITS))) | 0) + EG_DST;

    // total level: dB -> voltage
    for (t = 0; t < EG_ENT - 1; t++) {
      rate = ((1 << TL_BITS) - 1) / Math.pow(10.0, EG_STEP * t / 20);
      TL_TABLE[t] = rate | 0;
      TL_TABLE[TL_MAX + t] = -TL_TABLE[t];
    }
    for (t = EG_ENT - 1; t < TL_MAX; t++)
      TL_TABLE[t] = TL_TABLE[TL_MAX + t] = 0;

    // sine wave as TL_TABLE offsets; degree 0 = degree 180 = off
    SIN_TABLE[0] = SIN_TABLE[SIN_ENT / 2] = EG_ENT - 1;
    for (s = 1; s <= SIN_ENT / 4; s++) {
      pom = Math.sin(2 * Math.PI * s / SIN_ENT);
      pom = 20 * Math.log10(1 / pom);
      j = (pom / EG_STEP) | 0;
      SIN_TABLE[s] = SIN_TABLE[SIN_ENT / 2 - s] = j;
      SIN_TABLE[SIN_ENT / 2 + s] = SIN_TABLE[SIN_ENT - s] = TL_MAX + j;
    }
    for (s = 0; s < SIN_ENT; s++) {
      SIN_TABLE[SIN_ENT * 1 + s] = s < (SIN_ENT / 2) ? SIN_TABLE[s] : EG_ENT;
      SIN_TABLE[SIN_ENT * 2 + s] = SIN_TABLE[s % (SIN_ENT / 2)];
      SIN_TABLE[SIN_ENT * 3 + s] = ((s / (SIN_ENT / 4)) | 0) & 1 ? EG_ENT : SIN_TABLE[SIN_ENT * 2 + s];
    }

    // envelope counter -> envelope output
    for (i = 0; i < EG_ENT; i++) {
      pom = Math.pow((EG_ENT - 1 - i) / EG_ENT, 8) * EG_ENT;
      ENV_CURVE[i] = pom | 0;                       // attack
      ENV_CURVE[(EG_DST >> ENV_BITS) + i] = i;      // decay, release
    }
    ENV_CURVE[EG_OFF >> ENV_BITS] = EG_ENT - 1;

    for (i = 0; i < AMS_ENT; i++) {
      pom = (1.0 + Math.sin(2 * Math.PI * i / AMS_ENT)) / 2;
      AMS_TABLE[i] = ((1.0 / EG_STEP) * pom) | 0;              // 1dB
      AMS_TABLE[AMS_ENT + i] = ((4.8 / EG_STEP) * pom) | 0;    // 4.8dB
    }
    for (i = 0; i < VIB_ENT; i++) {
      pom = VIB_RATE * 0.06 * Math.sin(2 * Math.PI * i / VIB_ENT);
      VIB_TABLE[i] = (VIB_RATE + (pom * 0.07)) | 0;            // +- 7cent
      VIB_TABLE[VIB_ENT + i] = (VIB_RATE + (pom * 0.14)) | 0;  // +-14cent
    }
  })();

  // Per-chip rate table: AR_TABLE[76], DR_TABLE[76], then RATE_0[16], the
  // dummy rates used when AR or DR is 0. Slots hold offsets into it.
  var AR_BASE = 0, DR_BASE = 76, RATE_0 = 152;

  /*
   * The C code caches the LFO tables and increments in statics, refreshed
   * only when a different chip is updated (cur_chip). With one chip that
   * means writes to 0xBD's AM/VIB depth bits after the first update are not
   * heard. Kept as is.
   */
  var cur_chip = null;
  var ams_table = 0, vib_table = 0, amsIncr = 0, vibIncr = 0;

  /* --- slot and channel state ----------------------------------------- */

  function Slot() {
    this.TL = 0;        // total level
    this.TLL = 0;       // adjusted TL
    this.KSR = 0;       // key scale rate (shift down bit)
    this.AR = RATE_0;   // attack rate: offset of AR_TABLE[AR<<2]
    this.DR = RATE_0;   // decay rate:  offset of DR_TABLE[DR<<2]
    this.SL = 0;        // sustain level
    this.RR = RATE_0;   // release rate: offset of DR_TABLE[RR<<2]
    this.ksl = 0;       // keyscale level (shift down bits)
    this.ksr = 0;       // kcode >> KSR
    this.mul = 0;
    this.Cnt = 0;       // phase counter (uint32 in C; wraps)
    this.Incr = 0;      // phase step
    this.eg_typ = 0;
    this.evm = 0;       // envelope phase
    this.evc = 0;       // envelope counter
    this.eve = 0;       // envelope counter end point
    this.evs = 0;       // envelope counter step
    this.evsa = 0;
    this.evsd = 0;
    this.evsr = 0;
    this.ams = 0;
    this.vib = 0;
    this.wavetable = 0; // offset into SIN_TABLE
  }

  function Channel() {
    this.SLOT = [new Slot(), new Slot()];
    this.CON = 0;
    this.FB = 0;
    this.op1_out0 = 0;
    this.op1_out1 = 0;
    this.block_fnum = 0;
    this.kcode = 0;
    this.fc = 0;
    this.ksl_base = 0;
    this.keyon = 0;
  }

  /* --- subroutines ---------------------------------------------------- */

  function OPL_KEYON(SLOT) {
    SLOT.Cnt = 0;
    SLOT.evm = ENV_MOD_AR;
    SLOT.evs = SLOT.evsa;
    SLOT.evc = EG_AST;
    SLOT.eve = EG_AED;
  }

  function OPL_KEYOFF(SLOT) {
    if (SLOT.evm > ENV_MOD_RR) {
      // ScummVM's Kyra workaround: a note keyed off at the very start of
      // its attack goes straight to off rather than the top of release.
      if (SLOT.evm == ENV_MOD_AR && SLOT.evc == EG_AST)
        SLOT.evc = EG_DED;
      else if (!(SLOT.evc & EG_DST))
        SLOT.evc = EG_DST;
      SLOT.eve = EG_DED;
      SLOT.evs = SLOT.evsr;
      SLOT.evm = ENV_MOD_RR;
    }
  }

  // envelope generator; returns the envelope output
  function OPL_CALC_SLOT(SLOT, ams) {
    if ((SLOT.evc += SLOT.evs) >= SLOT.eve) {
      switch (SLOT.evm) {
      case ENV_MOD_AR: // ATTACK -> DECAY1
        SLOT.evm = ENV_MOD_DR;
        SLOT.evc = EG_DST;
        SLOT.eve = SLOT.SL;
        SLOT.evs = SLOT.evsd;
        break;
      case ENV_MOD_DR: // DECAY -> SL or RR
        SLOT.evc = SLOT.SL;
        SLOT.eve = EG_DED;
        if (SLOT.eg_typ) {
          SLOT.evs = 0;
        } else {
          SLOT.evm = ENV_MOD_RR;
          SLOT.evs = SLOT.evsr;
        }
        break;
      case ENV_MOD_RR: // RR -> OFF
        SLOT.evc = EG_OFF;
        SLOT.eve = EG_OFF + 1;
        SLOT.evs = 0;
        break;
      }
    }
    return SLOT.TLL + ENV_CURVE[SLOT.evc >> ENV_BITS] + (SLOT.ams ? ams : 0);
  }

  // phase step; C does this as uint32 arithmetic
  function stepPG(SLOT, vib) {
    if (SLOT.vib)
      SLOT.Cnt = (SLOT.Cnt + (Math.imul(SLOT.Incr, vib) >>> VIB_RATE_SHIFT)) | 0;
    else
      SLOT.Cnt = (SLOT.Cnt + SLOT.Incr) | 0;
  }

  function OP_OUT(SLOT, env, con) {
    return TL_TABLE[SIN_TABLE[SLOT.wavetable + (((SLOT.Cnt + con) >> SIN_SHIFT) & (SIN_ENT - 1))] + env];
  }

  function CALC_FCSLOT(rates, CH, SLOT) {
    var ksr;
    SLOT.Incr = Math.imul(CH.fc, SLOT.mul);
    ksr = CH.kcode >> SLOT.KSR;
    if (SLOT.ksr != ksr) {
      SLOT.ksr = ksr;
      SLOT.evsa = rates[SLOT.AR + ksr];
      SLOT.evsd = rates[SLOT.DR + ksr];
      SLOT.evsr = rates[SLOT.RR + ksr];
    }
    SLOT.TLL = SLOT.TL + (CH.ksl_base >> SLOT.ksl);
  }

  // one melodic channel; returns what it adds to the output
  function OPL_CALC_CH(CH, ams, vib) {
    var out = 0, feedback2 = 0, env_out, SLOT, feedback1, o;

    SLOT = CH.SLOT[0];
    env_out = OPL_CALC_SLOT(SLOT, ams);
    if (env_out < EG_ENT - 1) {
      stepPG(SLOT, vib);
      if (CH.FB) {
        feedback1 = (CH.op1_out0 + CH.op1_out1) >> CH.FB;
        CH.op1_out1 = CH.op1_out0;
        o = CH.op1_out0 = OP_OUT(SLOT, env_out, feedback1);
      } else {
        o = OP_OUT(SLOT, env_out, 0);
      }
      // connect1: the output when CON (additive), slot 2's phase input when FM
      if (CH.CON) out += o;
      else feedback2 += o;
    } else {
      CH.op1_out1 = CH.op1_out0;
      CH.op1_out0 = 0;
    }

    SLOT = CH.SLOT[1];
    env_out = OPL_CALC_SLOT(SLOT, ams);
    if (env_out < EG_ENT - 1) {
      stepPG(SLOT, vib);
      out += OP_OUT(SLOT, env_out, feedback2);
    }
    return out;
  }

  /* --- the chip ------------------------------------------------------- */

  ScummVM.OPL = function(sampleRate) {
    var i, rate, fn;

    this.clock = OPL_CLOCK;
    this.rate = sampleRate;
    this.address = 0;
    this.mode = 0;      // reg 0x08 is never stored by this emulator
    this.rhythm = 0;
    this.wavesel = 0;
    this.amsCnt = 0;
    this.vibCnt = 0;
    this.ams_table = 0; // offsets into AMS_TABLE / VIB_TABLE
    this.vib_table = 0;

    this.P_CH = [];
    for (i = 0; i < 9; i++)
      this.P_CH.push(new Channel());

    // Common::RandomSource, seeded from the clock as ScummVM does
    this._randSeed = (Date.now() >>> 0) || 1;

    // OPL_initalize
    this.freqbase = this.rate ? (this.clock / this.rate) / 72 : 0;

    // init_timetables
    this.rates = new Int32Array(76 + 76 + 16);
    for (i = 4; i <= 60; i++) {
      rate = this.freqbase;
      if (i < 60)
        rate *= 1.0 + (i & 3) * 0.25;
      rate *= 1 << ((i >> 2) - 1);
      rate *= EG_ENT << ENV_BITS;
      this.rates[AR_BASE + i] = (rate / OPL_ARRATE) | 0;
      this.rates[DR_BASE + i] = (rate / OPL_DRRATE) | 0;
    }
    for (i = 60; i < 76; i++) {
      this.rates[AR_BASE + i] = EG_AED - 1;
      this.rates[DR_BASE + i] = this.rates[DR_BASE + 60];
    }

    this.FN_TABLE = new Int32Array(1024);
    for (fn = 0; fn < 1024; fn++)
      this.FN_TABLE[fn] = (this.freqbase * fn * FREQ_RATE * (1 << 7) / 2) >>> 0;

    this.amsIncr = this.rate ? (AMS_ENT * (1 << AMS_SHIFT) / this.rate * 3.7 * (this.clock / 3600000)) | 0 : 0;
    this.vibIncr = this.rate ? (VIB_ENT * (1 << VIB_SHIFT) / this.rate * 6.4 * (this.clock / 3600000)) | 0 : 0;

    this.reset();
  };

  ScummVM.OPL.prototype = {
    // OPLResetChip
    reset: function() {
      var c, s, i, SLOT;

      this.mode = 0;
      this.writeReg(0x01, 0);
      this.writeReg(0x02, 0);
      this.writeReg(0x03, 0);
      this.writeReg(0x04, 0);
      for (i = 0xff; i >= 0x20; i--)
        this.writeReg(i, 0);
      for (c = 0; c < 9; c++) {
        for (s = 0; s < 2; s++) {
          SLOT = this.P_CH[c].SLOT[s];
          SLOT.wavetable = 0;
          SLOT.evc = EG_OFF;
          SLOT.eve = EG_OFF + 1;
          SLOT.evs = 0;
        }
      }
    },

    // OPLWrite: even port selects the register, odd port writes it
    write: function(a, v) {
      if (!(a & 1))
        this.address = v & 0xff;
      else
        this.writeReg(this.address, v);
    },

    // OPLWriteReg
    writeReg: function(r, v) {
      var CH, slot, block_fnum, SLOT, c;
      r &= 0xff;
      v &= 0xff;

      switch (r & 0xe0) {
      case 0x00: // 00-1f: control
        if ((r & 0x1f) == 0x01) {
          // wave selector enable (the chip is a YM3812, so always available)
          this.wavesel = v & 0x20;
          if (!this.wavesel) {
            for (c = 0; c < 9; c++) {
              this.P_CH[c].SLOT[0].wavetable = 0;
              this.P_CH[c].SLOT[1].wavetable = 0;
            }
          }
        }
        // 0x02-0x04 are the timers and IRQ mask: not emulated
        return;
      case 0x20: // am, vib, ksr, eg type, mul
        slot = slot_array[r & 0x1f];
        if (slot == -1) return;
        CH = this.P_CH[slot >> 1];
        SLOT = CH.SLOT[slot & 1];
        SLOT.mul = MUL_TABLE[v & 0x0f];
        SLOT.KSR = (v & 0x10) ? 0 : 2;
        SLOT.eg_typ = (v & 0x20) >> 5;
        SLOT.vib = v & 0x40;
        SLOT.ams = v & 0x80;
        CALC_FCSLOT(this.rates, CH, SLOT);
        return;
      case 0x40: // ksl, tl
        slot = slot_array[r & 0x1f];
        if (slot == -1) return;
        CH = this.P_CH[slot >> 1];
        SLOT = CH.SLOT[slot & 1];
        c = v >> 6; // 0 / 1.5 / 3 / 6 dB/OCT
        SLOT.ksl = c ? 3 - c : 31;
        SLOT.TL = ((v & 0x3f) * (0.75 / EG_STEP)) | 0;
        if (!(this.mode & 0x80)) // not CSM latch total level
          SLOT.TLL = SLOT.TL + (CH.ksl_base >> SLOT.ksl);
        return;
      case 0x60: // attack rate, decay rate
        slot = slot_array[r & 0x1f];
        if (slot == -1) return;
        SLOT = this.P_CH[slot >> 1].SLOT[slot & 1];
        c = v >> 4;
        SLOT.AR = c ? AR_BASE + (c << 2) : RATE_0;
        SLOT.evsa = this.rates[SLOT.AR + SLOT.ksr];
        if (SLOT.evm == ENV_MOD_AR)
          SLOT.evs = SLOT.evsa;
        c = v & 0x0f;
        SLOT.DR = c ? DR_BASE + (c << 2) : RATE_0;
        SLOT.evsd = this.rates[SLOT.DR + SLOT.ksr];
        if (SLOT.evm == ENV_MOD_DR)
          SLOT.evs = SLOT.evsd;
        return;
      case 0x80: // sustain level, release rate
        slot = slot_array[r & 0x1f];
        if (slot == -1) return;
        SLOT = this.P_CH[slot >> 1].SLOT[slot & 1];
        SLOT.SL = SL_TABLE[v >> 4];
        if (SLOT.evm == ENV_MOD_DR)
          SLOT.eve = SLOT.SL;
        SLOT.RR = DR_BASE + ((v & 0x0f) << 2);
        SLOT.evsr = this.rates[SLOT.RR + SLOT.ksr];
        if (SLOT.evm == ENV_MOD_RR)
          SLOT.evs = SLOT.evsr;
        return;
      case 0xa0:
        if (r == 0xbd) {
          this.writeRhythm(v);
          return;
        }
        // keyon, block, fnum
        if ((r & 0x0f) > 8) return;
        CH = this.P_CH[r & 0x0f];
        if (!(r & 0x10)) { // a0-a8
          block_fnum = (CH.block_fnum & 0x1f00) | v;
        } else { // b0-b8
          c = (v >> 5) & 1;
          block_fnum = ((v & 0x1f) << 8) | (CH.block_fnum & 0xff);
          if (CH.keyon != c) {
            if ((CH.keyon = c)) {
              CH.op1_out0 = CH.op1_out1 = 0;
              OPL_KEYON(CH.SLOT[0]);
              OPL_KEYON(CH.SLOT[1]);
            } else {
              OPL_KEYOFF(CH.SLOT[0]);
              OPL_KEYOFF(CH.SLOT[1]);
            }
          }
        }
        if (CH.block_fnum != block_fnum) {
          CH.block_fnum = block_fnum;
          CH.ksl_base = KSL_TABLE[block_fnum >> 6];
          CH.fc = this.FN_TABLE[block_fnum & 0x3ff] >>> (7 - (block_fnum >> 10));
          CH.kcode = block_fnum >> 9;
          if ((this.mode & 0x40) && (block_fnum & 0x100))
            CH.kcode |= 1;
          CALC_FCSLOT(this.rates, CH, CH.SLOT[0]);
          CALC_FCSLOT(this.rates, CH, CH.SLOT[1]);
        }
        return;
      case 0xc0: // feedback, connection
        if ((r & 0x0f) > 8) return;
        CH = this.P_CH[r & 0x0f];
        c = (v >> 1) & 7;
        CH.FB = c ? (8 + 1) - c : 0;
        CH.CON = v & 1;
        return;
      case 0xe0: // wave type
        slot = slot_array[r & 0x1f];
        if (slot == -1) return;
        if (this.wavesel)
          this.P_CH[slot >> 1].SLOT[slot & 1].wavetable = (v & 0x03) * SIN_ENT;
        return;
      }
    },

    // register 0xBD: AM depth, VIB depth, rhythm mode, BD SD TOM TC HH
    writeRhythm: function(v) {
      var P_CH = this.P_CH;
      var rkey = (this.rhythm ^ v) & 0xff;
      this.ams_table = v & 0x80 ? AMS_ENT : 0;
      this.vib_table = v & 0x40 ? VIB_ENT : 0;
      this.rhythm = v & 0x3f;
      if (!(this.rhythm & 0x20))
        return;
      if (rkey & 0x10) { // BD
        if (v & 0x10) {
          P_CH[6].op1_out0 = P_CH[6].op1_out1 = 0;
          OPL_KEYON(P_CH[6].SLOT[0]);
          OPL_KEYON(P_CH[6].SLOT[1]);
        } else {
          OPL_KEYOFF(P_CH[6].SLOT[0]);
          OPL_KEYOFF(P_CH[6].SLOT[1]);
        }
      }
      if (rkey & 0x08) { // SD
        if (v & 0x08) OPL_KEYON(P_CH[7].SLOT[1]);
        else OPL_KEYOFF(P_CH[7].SLOT[1]);
      }
      if (rkey & 0x04) { // TAM
        if (v & 0x04) OPL_KEYON(P_CH[8].SLOT[0]);
        else OPL_KEYOFF(P_CH[8].SLOT[0]);
      }
      if (rkey & 0x02) { // TOP-CY
        if (v & 0x02) OPL_KEYON(P_CH[8].SLOT[1]);
        else OPL_KEYOFF(P_CH[8].SLOT[1]);
      }
      if (rkey & 0x01) { // HH
        if (v & 0x01) OPL_KEYON(P_CH[7].SLOT[0]);
        else OPL_KEYOFF(P_CH[7].SLOT[0]);
      }
    },

    // Common::RandomSource::getRandomBit (xorshift)
    randomBit: function() {
      var s = this._randSeed;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      this._randSeed = s >>> 0;
      return s & 1;
    },

    // OPL_CALC_RH: channels 6-8 in rhythm mode; returns what they add
    calcRhythm: function(ams, vib) {
      var CH = this.P_CH;
      var CH6 = CH[6], CH7 = CH[7], CH8 = CH[8];
      var SLOT7_1 = CH7.SLOT[0], SLOT7_2 = CH7.SLOT[1];
      var SLOT8_1 = CH8.SLOT[0], SLOT8_2 = CH8.SLOT[1];
      var whitenoise = this.randomBit() * (EG_ENT >> 4);
      var out = 0, feedback1, feedback2, env_out, SLOT, tone8;
      var env_sd, env_tam, env_top, env_hh;

      // BD: same as FM serial mode and output level is large
      SLOT = CH6.SLOT[0];
      env_out = OPL_CALC_SLOT(SLOT, ams);
      if (env_out < EG_ENT - 1) {
        stepPG(SLOT, vib);
        if (CH6.FB) {
          feedback1 = (CH6.op1_out0 + CH6.op1_out1) >> CH6.FB;
          CH6.op1_out1 = CH6.op1_out0;
          feedback2 = CH6.op1_out0 = OP_OUT(SLOT, env_out, feedback1);
        } else {
          feedback2 = OP_OUT(SLOT, env_out, 0);
        }
      } else {
        feedback2 = 0;
        CH6.op1_out1 = CH6.op1_out0;
        CH6.op1_out0 = 0;
      }
      SLOT = CH6.SLOT[1];
      env_out = OPL_CALC_SLOT(SLOT, ams);
      if (env_out < EG_ENT - 1) {
        stepPG(SLOT, vib);
        out += OP_OUT(SLOT, env_out, feedback2) * 2;
      }

      // SD  (17) = mul14[fnum7] + white noise
      // TAM (15) = mul15[fnum8]
      // TOP (18) = fnum6(mul18[fnum8]+whitenoise)
      // HH  (14) = fnum7(mul18[fnum8]+whitenoise) + white noise
      env_sd = OPL_CALC_SLOT(SLOT7_2, ams) + whitenoise;
      env_tam = OPL_CALC_SLOT(SLOT8_1, ams);
      env_top = OPL_CALC_SLOT(SLOT8_2, ams);
      env_hh = OPL_CALC_SLOT(SLOT7_1, ams) + whitenoise;

      if (SLOT7_1.vib)
        SLOT7_1.Cnt = (SLOT7_1.Cnt + (Math.imul(SLOT7_1.Incr, vib) >>> (VIB_RATE_SHIFT - 1))) | 0;
      else
        SLOT7_1.Cnt = (SLOT7_1.Cnt + Math.imul(2, SLOT7_1.Incr)) | 0;
      if (SLOT7_2.vib)
        SLOT7_2.Cnt = (SLOT7_2.Cnt + (Math.imul(CH7.fc, vib) >>> (VIB_RATE_SHIFT - 3))) | 0;
      else
        SLOT7_2.Cnt = (SLOT7_2.Cnt + Math.imul(CH7.fc, 8)) | 0;
      if (SLOT8_1.vib)
        SLOT8_1.Cnt = (SLOT8_1.Cnt + (Math.imul(SLOT8_1.Incr, vib) >>> VIB_RATE_SHIFT)) | 0;
      else
        SLOT8_1.Cnt = (SLOT8_1.Cnt + SLOT8_1.Incr) | 0;
      if (SLOT8_2.vib)
        SLOT8_2.Cnt = (SLOT8_2.Cnt + (Math.imul(Math.imul(CH8.fc, 3), vib) >>> (VIB_RATE_SHIFT - 4))) | 0;
      else
        SLOT8_2.Cnt = (SLOT8_2.Cnt + Math.imul(CH8.fc, 48)) | 0;

      tone8 = OP_OUT(SLOT8_2, whitenoise, 0);

      // the slot pairings below are as in the C code
      if (env_sd < EG_ENT - 1) // SD
        out += OP_OUT(SLOT7_1, env_sd, 0) * 8;
      if (env_tam < EG_ENT - 1) // TAM
        out += OP_OUT(SLOT8_1, env_tam, 0) * 2;
      if (env_top < EG_ENT - 1) // TOP-CY
        out += OP_OUT(SLOT7_2, env_top, tone8) * 2;
      if (env_hh < EG_ENT - 1) // HH
        out += OP_OUT(SLOT7_2, env_hh, tone8) * 2;
      return out;
    },

    // YM3812UpdateOne, writing floats instead of int16
    generate: function(out, offset, len) {
      var i, c, data, ams, vib;
      var amsCnt = this.amsCnt, vibCnt = this.vibCnt;
      var rhythm = this.rhythm & 0x20;
      var P_CH = this.P_CH;
      var R_CH = rhythm ? 6 : 9;

      if (this !== cur_chip) {
        cur_chip = this;
        amsIncr = this.amsIncr;
        vibIncr = this.vibIncr;
        ams_table = this.ams_table;
        vib_table = this.vib_table;
      }

      for (i = 0; i < len; i++) {
        amsCnt = (amsCnt + amsIncr) >>> 0;
        vibCnt = (vibCnt + vibIncr) >>> 0;
        ams = AMS_TABLE[ams_table + (amsCnt >>> AMS_SHIFT)];
        vib = VIB_TABLE[vib_table + (vibCnt >>> VIB_SHIFT)];

        data = 0;
        for (c = 0; c < R_CH; c++)
          data += OPL_CALC_CH(P_CH[c], ams, vib);
        if (rhythm)
          data += this.calcRhythm(ams, vib);

        if (data < OPL_MINOUT) data = OPL_MINOUT;
        else if (data > OPL_MAXOUT) data = OPL_MAXOUT;
        out[offset + i] = (data >> OPL_OUTSB) / 32768;
      }

      this.amsCnt = amsCnt;
      this.vibCnt = vibCnt;
    }
  };
})();
