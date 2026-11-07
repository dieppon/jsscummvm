/*
 * SCUMM v6 -- Day of the Tentacle, Sam & Max -- ported from ScummVM's
 * resource.cpp (ScummEngine_v6::readMAXS), vars.cpp (setupScummVars) and
 * the arrays of script_v6.cpp. v6 keeps v5's files and blocks; its scripts
 * are another matter (script_v6.js).
 *
 * An array is kept here as {type, dim1, dim2, data}, data a typed array --
 * ScummVM's ArrayHeader and its bytes -- in _arrays by id, the id held in
 * the variable that names it.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM;
  var kBitArray = 1, kNibbleArray = 2, kByteArray = 3, kStringArray = 4, kIntArray = 5;
  s.kIntArray = kIntArray;
  s.kStringArray = kStringArray;

  s.defineVersion("6", {
    // resource.cpp ScummEngine_v6::readMAXS
    readMAXS: function(file, itemsize) {
      var n = this._nums;
      n.variables = file.readUI16();
      file.readUI16();
      n.bit_variables = file.readUI16();
      n.local_objects = file.readUI16();
      n.array = file.readUI16();
      file.readUI16();
      n.verbs = file.readUI16();
      n.fl_object = file.readUI16();
      n.inventory = file.readUI16();
      n.rooms = file.readUI16();
      n.scripts = file.readUI16();
      n.sounds = file.readUI16();
      n.charsets = file.readUI16();
      n.costumes = file.readUI16();
      n.global_objects = file.readUI16();
      n.new_names = 50;
      n.global_scripts = 200;
      n.shadow_pallete_size = 256;
      n.images = 0;
      n.actors = 16;
      this._objectRoomTable = null;
      this._arrays = {};
    },

    // vars.cpp ScummEngine_v6::setupScummVars: v5's, and these
    setupScummVars: function() {
      var v;
      this._baseMethods.setupScummVars.call(this);
      v = this._vars;
      v.room_width = 41;
      v.room_height = 54;
      v.voice_mode = 60;
      v.pre_saveload_script = 61;
      v.post_saveload_script = 62;
      v.leftbtn_hold = 74;
      v.rightbtn_hold = 75;
      v.v6_emsspace = 76;
      v.random_nr = 118;
      v.timedate_year = 119;
      v.timedate_month = 129;
      v.timedate_day = 128;
      v.timedate_hour = 125;
      v.timedate_minute = 126;
      delete v.nosubtitles;
      if (this._game == "samnmax") {
        v.v6_soundmode = 9;
        v.charset_mask = 123;
      }
    },

    // vars.cpp resetScummVars, v6's parts. Var 74, which v5 sets for
    // Monkey Island, is the left button here; voices and text both on.
    resetScummVars: function() {
      var t = this;
      t._baseMethods.resetScummVars.call(t);
      t._scummVars[74] = 0;
      t.scummVar("v6_emsspace", 10000);
      t.scummVar("room_width", 320);
      t.scummVar("room_height", 200);
      t.scummVar("soundcard", 3);
      t.scummVar("voice_mode", 1);
    },

    // script_v6.cpp readArrayFromIndexFile: the arrays the game starts with
    readArrayFromIndexFile: function(file) {
      var t = this, num, a, b, c;
      while ((num = file.readUI16()) != 0) {
        a = file.readUI16();
        b = file.readUI16();
        c = file.readUI16();
        t.defineArray(num, c == kBitArray ? kBitArray : kIntArray, a, b);
      }
    }
  });

  /* --- arrays (script_v6.cpp) ------------------------------------------- */

  s.defineArray = function(array, type, dim2, dim1) {
    var t = this, id, size, a;
    if (type != kStringArray) type = kIntArray;
    t.nukeArray(array);
    id = t.findFreeArrayId();
    if (array & 0x8000) error("Can't define bit variable as array pointer");
    t.writeVar(array, id);
    size = (dim2 + 1) * (dim1 + 1);
    a = {type: type, dim1: dim1 + 1, dim2: dim2 + 1,
         data: type == kIntArray ? new Int16Array(size) : new Uint8Array(size)};
    t._arrays[id] = a;
    return a;
  };

  s.nukeArray = function(array) {
    var t = this, id = t.readVar(array);
    if (id) delete t._arrays[id];
    t.writeVar(array, 0);
  };

  s.findFreeArrayId = function() {
    var t = this, i;
    for (i = 1; i < t._nums.array; i++) if (!t._arrays[i]) return i;
    error("Out of array pointers, " + t._nums.array + " max");
    return -1;
  };

  s.getArray = function(array) {
    var t = this;
    return (t._arrays && t._arrays[t.readVar(array)]) || null;
  };

  s.readArray = function(array, idx, base) {
    var a = this.getArray(array), offset;
    if (!a) { error("readArray: invalid array " + array + " (" + this.readVar(array) + ")"); return 0; }
    offset = base + idx * a.dim1;
    if (offset < 0 || offset >= a.dim1 * a.dim2) {
      error("readArray: array " + array + " out of bounds: [" + base + "," + idx + "] exceeds [" + a.dim1 + "," + a.dim2 + "]");
      return 0;
    }
    return a.data[offset];
  };

  s.writeArray = function(array, idx, base, value) {
    var a = this.getArray(array), offset;
    if (!a) return;
    offset = base + idx * a.dim1;
    if (offset < 0 || offset >= a.dim1 * a.dim2) {
      error("writeArray: array " + array + " out of bounds: [" + base + "," + idx + "] exceeds [" + a.dim1 + "," + a.dim2 + "]");
      return;
    }
    a.data[offset] = value;
  };

  // a string array's bytes up to its 0, as the charset renderer wants them
  s.getStringFromArray = function(id) {
    var a = this._arrays && this._arrays[id], out = "", i;
    if (!a) return "";
    for (i = 0; i < a.data.length && a.data[i]; i++) out += String.fromCharCode(a.data[i] & 0xFF);
    return out;
  };
}());
