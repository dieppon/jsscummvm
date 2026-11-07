/*
 * SCUMM v3 -- Indiana Jones and the Last Crusade (VGA) -- ported from
 * ScummVM's resource_v3.cpp, script_v3.cpp and charset.cpp
 * (CharsetRendererV3). It is v4 (v4/) with rooms in files of their own
 * (01.LFL, 02.LFL...), no XOR, its fonts in 98.LFL and 99.LFL, and three
 * opcodes of its own.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM, C = s._opcodeCommands, RES_INVALID_OFFSET = 0xFFFFFFFF;

  function pad(n, width) {
    n = String(n);
    while (n.length < width) n = "0" + n;
    return n;
  }

  s.defineVersion("3", {
    generateFilename: function(room) { return pad(room, 2) + ".lfl"; },
    openResourceFile: function(filename) {
      var i = this._filenames[filename.toLowerCase()];
      if (i === undefined) return false;
      this._file = this._files[i];
      return true;
    },
    openRoom: function(room) {
      var t = this;
      if (t._lastLoadedRoom == room) return;
      t._lastLoadedRoom = room;
      if (room == -1) return;
      if (!t.openResourceFile(t.generateFilename(room))) error("openRoom: no file for room " + room);
      t._fileOffset = 0;
    },
    closeRoom: function() { this._lastLoadedRoom = -1; },

    // resource.cpp loadResource, GF_SMALL_HEADER: the size is the
    // resource's first long
    loadResource: function(type, idx) {
      var t = this, res = t._res.types[type], roomNr, fileOffs, file, size;
      if (type == "charset") { t.loadCharset(idx); return 1; }
      if (idx >= res.num) { error(type + " " + idx + " undefined"); return 0; }
      roomNr = t.getResourceRoomNr(type, idx);
      if (roomNr == 0) roomNr = t._roomResource;
      fileOffs = type == "room" ? 0 : res.roomoffs[idx];
      if (fileOffs == RES_INVALID_OFFSET) return 0;
      t.openRoom(roomNr);
      file = t._file;
      file.seek(t._fileOffset + fileOffs, true);
      size = file.readUI32();
      file.seek(-4);
      t._res.createResource(type, idx, size);
      return 1;
    },

    // resource_v3.cpp loadCharset: charset n is in (99 - n).LFL, after its
    // length
    loadCharset: function(no) {
      var t = this, file, size;
      if (!t.openResourceFile(pad(99 - no, 2) + ".lfl")) return;
      file = t._file;
      file.seek(0, true);
      size = file.readUI16();
      t._res.types.charset.address[no] = file.newStream(2, size);
      t._lastLoadedRoom = -1;
    },
    initCharset: function(no) {
      var t = this;
      if (!t._res.types.charset.address[no]) t.loadCharset(no);
      t._curCharset = no;
      t._string[0]._default.charset = no;
      t._string[1]._default.charset = no;
    },

    resetScumm: function() {
      var t = this;
      t._res.allocResTypeData("charset", 0, 9, "charset", 0);
      t._charset = new t.CharsetRendererV3(t);
      t._baseMethods.resetScumm.call(t);
    }
  });

  /* --- CharsetRendererV3 ------------------------------------------------ */

  // A v3 font: the number of glyphs and the height, a width for each, then
  // 8x8 one-bit glyphs. A colour with the top bit set has a shadow.
  s.CharsetRendererV3 = function(engine) {
    this.engine = engine;
    this.curId = -1;
    this.ptr = null;
    this.bitsPerPixel = 1;
    this.fontHeight = 8;
    this.numChars = 0;
  };
  s.CharsetRendererV3.prototype = {
    setCurID: function(id) {
      var t = this, ptr;
      if (id == t.curId && t.ptr) return true;
      ptr = t.engine._res.types.charset.address[id];
      if (!ptr) { t.engine.loadCharset(id); ptr = t.engine._res.types.charset.address[id]; }
      if (!ptr) return false;
      t.ptr = ptr;
      t.curId = id;
      t.numChars = ptr.readByteAt(ptr.offset + 4);
      t.fontHeight = ptr.readByteAt(ptr.offset + 5);
      return true;
    },
    getCharWidth: function(chr) {
      var t = this;
      if (!t.ptr || chr < 0 || chr >= t.numChars) return 0;
      return t.ptr.readByteAt(t.ptr.offset + 6 + chr);
    },
    getStringWidth: function(codes) {
      var w = 0, i;
      for (i = 0; i < codes.length; i++) w += this.getCharWidth(codes[i]);
      return w;
    },
    lines: s.CharsetRenderer.prototype.lines,
    wrap: s.CharsetRenderer.prototype.wrap,
    glyphInfo: function(chr) {
      var w = this.getCharWidth(chr);
      if (!w && chr != 32) return null;
      return {w: w, h: 8, xoff: 0, yoff: 0};
    },
    printChar: function(data, dw, dh, chr, x, y, color) {
      var t = this, engine = t.engine, w = t.getCharWidth(chr), base, rgb, shadow, px, py, bits, sx, sy, idx, pass;
      if (!t.ptr || chr < 0 || chr >= t.numChars) return 0;
      shadow = (color & 0x80) != 0;
      base = t.ptr.offset + 6 + t.numChars + chr * 8;
      for (pass = shadow ? 0 : 1; pass < 2; pass++) {
        rgb = engine._currentPalette[pass == 0 ? 0 : color & 0x7F];
        if (!rgb) continue;
        for (py = 0; py < 8; py++) {
          bits = t.ptr.readByteAt(base + py);
          sy = y + py + (pass == 0 ? 1 : 0);
          if (sy < 0 || sy >= dh) continue;
          for (px = 0; px < w; px++) {
            if (!(bits & (0x80 >> px))) continue;
            sx = x + px + (pass == 0 ? 1 : 0);
            if (sx < 0 || sx >= dw) continue;
            idx = (sy * dw + sx) * 4;
            data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2];
            data[idx + 3] = 255;
          }
        }
      }
      return w;
    },
    drawLine: function(data, dw, dh, codes, x, y, color) {
      for (var i = 0; i < codes.length; i++)
        x += this.printChar(data, dw, dh, codes[i], x, y, color);
    }
  };

  /* --- opcodes (script_v3.cpp) ------------------------------------------ */

  var V3 = {
    setBoxFlags: function() {
      var a = s.getVarOrDirectByte(PARAM_1), b = s.fetchScriptByte();
      s.setBoxFlags(a, b);
    },
    // Indy3 waits for an actor to stop
    waitForActor: function() {
      var start = s._scriptPointer.offset - 1, a = s.getActor(s.getVarOrDirectByte(PARAM_1));
      if (s._game == "indy3" && a && a.moving) {
        s._scriptPointer.offset = start;
        C.breakHere();
      }
    },
    waitForSentence: function() {
      var script = s.scummVar("sentence_script");
      if (s._sentenceNum) {
        if (s._sentence[s._sentenceNum - 1].freezeCount && !s.isScriptInUse(script)) return;
      } else if (!s.isScriptInUse(script)) {
        return;
      }
      s._scriptPointer.seek(-1);
      C.breakHere();
    }
  };

  var table = s.buildOpcodesV4();
  table[0x30] = table[0xb0] = V3.setBoxFlags;
  table[0x3b] = table[0xbb] = V3.waitForActor;
  table[0x4c] = V3.waitForSentence;
  s._opcodeTables[3] = table;
}());
