/*
 * Rooms, objects, walk boxes and pictures of the oldest SCUMM games, ported
 * from ScummVM's room.cpp (ScummEngine_v3old::setupRoomSubBlocks and
 * resetRoomSubBlocks), object.cpp (resetRoomObjects, resetRoomObject for
 * GF_OLD_BUNDLE), boxes.cpp (the v2 box format) and gfx.cpp (GdiV2).
 *
 * A room here is one resource with a fixed header -- its size, width,
 * height, where its picture, boxes, objects and entry and exit code are --
 * rather than tagged blocks. v2 pictures are run-length coded a column of
 * pixels at a time, in the 16 EGA colours, with the mask after them; the
 * room's columns are indexed once (the strip table) so any strip can be
 * drawn on its own.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM;

  // palette.cpp tableEGAPalette
  var EGA = [
    [0x00, 0x00, 0x00], [0x00, 0x00, 0xAA], [0x00, 0xAA, 0x00], [0x00, 0xAA, 0xAA],
    [0xAA, 0x00, 0x00], [0xAA, 0x00, 0xAA], [0xAA, 0x55, 0x00], [0xAA, 0xAA, 0xAA],
    [0x55, 0x55, 0x55], [0x55, 0x55, 0xFF], [0x55, 0xFF, 0x55], [0x55, 0xFF, 0xFF],
    [0xFF, 0x55, 0x55], [0xFF, 0x55, 0xFF], [0xFF, 0xFF, 0x55], [0xFF, 0xFF, 0xFF]
  ];

  function u8(r, o) { return r.readByteAt(r.offset + o); }
  function u16(r, o) { return u8(r, o) | (u8(r, o + 1) << 8); }
  function s16(r, o) { var v = u16(r, o); return v > 0x7FFF ? v - 0x10000 : v; }

  /* --- GdiV2 ------------------------------------------------------------ */

  // gfx.cpp GdiV2::generateStripTable: where each 8-pixel strip's pixels
  // and mask start, and the run and colour in force there
  function generateStripTable(r, start, width, height) {
    var table = {run: [], color: [], offsets: [], zoffsets: [], zrun: []},
        src = start, color = 0, data = 0, run = 1, x, y, length, runFlag;
    for (x = 0; x < width; x++) {
      if ((x % 8) == 0) {
        table.run[x >> 3] = run;
        table.color[x >> 3] = color;
        table.offsets[x >> 3] = src - start;
      }
      for (y = 0; y < height; y++) {
        if (--run == 0) {
          data = u8(r, src++);
          run = (data & 0x80) ? data & 0x7F : data >> 4;
          if (run == 0) run = u8(r, src++);
          color = data & 0x0F;
        }
      }
    }
    // the mask follows the pixels
    x = 0;
    y = height;
    width >>= 3;
    for (;;) {
      length = u8(r, src++);
      runFlag = length & 0x80;
      if (runFlag) {
        length &= 0x7F;
        data = u8(r, src++);
      }
      do {
        if (!runFlag) data = u8(r, src++);
        if (y == height) {
          table.zoffsets[x] = src - start - 1;
          table.zrun[x] = length | runFlag;
        }
        if (--y == 0) {
          if (--width == 0) return table;
          x++;
          y = height;
        }
      } while (--length > 0);
    }
  }

  // GdiV2::prepareDrawBitmap: decode strips stripnr..stripnr+numstrip-1 to
  // the back buffer at strip x, and their mask to z-plane 1. A room uses
  // its strip table; an object is decoded from its start, every column, of
  // which those wanted are kept.
  function prepareDrawBitmapV2(gdi, img, vs, x, y, width, height, stripnr, numstrip) {
    var vm = gdi.engine, table = gdi.objectMode ? null : gdi.roomStrips,
        r = img.stream, base = img.offset, pal = vm._roomPalette,
        left = stripnr * 8, right = left + numstrip * 8,
        run, color, src, theX, maxX, theY, data = 0, dither = false, dt = [], di, mask, pos, runFlag, strip;

    if (table) {
      run = table.run[stripnr];
      color = table.color[stripnr];
      src = base + table.offsets[stripnr];
      theX = left;
      maxX = right;
    } else {
      run = 1;
      color = 0;
      src = base;
      theX = 0;
      maxX = width;
    }
    for (di = 0; di < 128; di++) dt[di] = 0;

    for (; theX < maxX; theX++) {
      di = 0;
      pos = y * vs.pitch + x * 8 + (theX - left);
      for (theY = 0; theY < height; theY++) {
        if (--run == 0) {
          data = u8(r, src++);
          if (data & 0x80) {
            run = data & 0x7F;
            dither = true;
          } else {
            run = data >> 4;
            dither = false;
          }
          color = pal[data & 0x0F];
          if (run == 0) run = u8(r, src++);
        }
        if (!dither) dt[di] = color;
        if (left <= theX && theX < right) {
          vs.backBuf.writeByteAt(pos, dt[di++]);
          pos += vs.pitch;
        }
      }
    }

    // the mask: a byte (8 pixels) a row, strip by strip
    theY = 0;
    if (table) {
      src = base + table.zoffsets[stripnr];
      run = table.zrun[stripnr];
      theX = left;
    } else {
      run = u8(r, src++);
      theX = 0;
    }
    while (theX < right) {
      runFlag = run & 0x80;
      if (runFlag) {
        run &= 0x7F;
        data = u8(r, src++);
      }
      do {
        if (!runFlag) data = u8(r, src++);
        if (left <= theX) {
          strip = x + ((theX - left) >> 3);
          mask = gdi.getMaskBuffer(strip, y + theY, 1);
          mask.writeUI8(data);
        }
        theY++;
        if (theY >= height) {
          theY = 0;
          theX += 8;
          if (theX >= right) break;
        }
      } while (--run > 0);
      run = u8(r, src++);
    }
  }

  // Gdi::drawBitmap for v2: decode, then copy each strip to the screen (or
  // black, with the lights off)
  function drawBitmapV2(img, vs, x, y, width, height, stripnr, numstrip, flag) {
    var gdi = this, vm = gdi.engine, sx, limit, k, offset, dst, front;
    gdi.objectMode = (flag & gdi.dbObjectMode) == gdi.dbObjectMode;
    if (!img) return;
    prepareDrawBitmapV2(gdi, img, vs, x, y, width, height, stripnr, numstrip);
    sx = x - Math.floor(vs.xstart / 8);
    if (sx < 0) {
      numstrip -= -sx;
      x += -sx;
      stripnr += -sx;
      sx = 0;
    }
    limit = Math.floor(Math.max(vm._roomWidth, vs.w) / 8) - x;
    if (limit > numstrip) limit = numstrip;
    if (limit > gdi.numStrips - sx) limit = gdi.numStrips - sx;
    for (k = 0; k < limit; ++k, ++x) {
      if (vs.number != 0) continue;
      offset = y * vs.pitch + x * 8;
      dst = vs.backBuf.newRelativeStream(offset);
      front = vs.pixels.newRelativeStream(offset);
      if (vm.isLightOn()) gdi.copy8Col(front, vs.pitch, dst, height, 1);
      else gdi.clear8Col(front, vs.pitch, height);
    }
  }

  /* --- boxes (boxes.cpp) -------------------------------------------------- */

  // v2: eight bytes a box -- the top and bottom y, the four corners' x, the
  // mask and the flags; then a real matrix of the next box on the way from
  // each box to each other one
  function loadBoxesV2(t, room, offs) {
    var n = u8(room, offs), i, p, m, size;
    t._boxes = [];
    t._boxMatrix = [];
    t._scaleSlots = [];
    for (i = 0; i < n; i++) {
      p = offs + 1 + i * 8;
      t._boxes[i] = {
        uly: u8(room, p), ury: u8(room, p), lly: u8(room, p + 1), lry: u8(room, p + 1),
        ulx: u8(room, p + 2), urx: u8(room, p + 3), llx: u8(room, p + 4), lrx: u8(room, p + 5),
        mask: u8(room, p + 6), flags: u8(room, p + 7), scale: 255
      };
    }
    m = offs + 1 + n * 8;
    size = n * (n + 1);
    for (i = 0; i < size; i++) t._boxMatrix[i] = u8(room, m + i);
  }

  // v3: the old 20-byte boxes and v5's run-length matrix
  function loadBoxesV3(t, room, offs, end) {
    var n = u8(room, offs), i, p;
    t._boxes = [];
    t._boxMatrix = [];
    t._scaleSlots = [];
    for (i = 0; i < n; i++) {
      p = offs + 1 + i * 18;
      t._boxes[i] = {
        ulx: s16(room, p), uly: s16(room, p + 2), urx: s16(room, p + 4), ury: s16(room, p + 6),
        lrx: s16(room, p + 8), lry: s16(room, p + 10), llx: s16(room, p + 12), lly: s16(room, p + 14),
        mask: u8(room, p + 16), flags: u8(room, p + 17), scale: 255
      };
    }
    for (p = offs + 1 + n * 18; p < end; p++) t._boxMatrix.push(u8(room, p));
  }

  /* --- the version methods ------------------------------------------------ */

  s.defineVersion("3old", {
    // room.cpp ScummEngine_v3old::setupRoomSubBlocks
    setupRoomSubBlocks: function() {
      var t = this, room = t.getResourceAddress("room", t._roomResource), v2 = t._version <= 2,
          im, excd, encd, numObj, numSounds, numScripts, p, id, i;
      if (!room) error("Room " + t._roomResource + ": data not found");
      t._gfx = {ENCD: 0, EXCD: 0, EPAL: 0, CLUT: 0, PALS: 0};
      t._roomWidth = u16(room, 4);
      t._roomHeight = u16(room, 6);
      numObj = t._numObjectsInRoom = u8(room, 20);
      im = u16(room, 0x0A);
      if (v2) {
        excd = u16(room, 0x18);
        encd = u16(room, 0x1A);
      } else {
        excd = u16(room, 0x19);
        encd = u16(room, 0x1B);
      }
      if (excd) { t._gfx.EXCD = room; t._gfx.EXCD_offs = excd; }
      if (encd) { t._gfx.ENCD = room; t._gfx.ENCD_offs = encd; }
      t._localScriptOffsets = [];
      if (v2) {
        // the room's sounds and scripts are loaded with it
        numSounds = u8(room, 22);
        numScripts = u8(room, 23);
        p = 28 + numObj * 4;
        for (i = 0; i < numSounds; i++) t.loadResource("sound", u8(room, p++));
        for (i = 0; i < numScripts; i++) t.loadResource("script", u8(room, p++));
      } else {
        numSounds = u8(room, 23);
        numScripts = u8(room, 24);
        p = 29 + numObj * 4 + numSounds + numScripts;
        while ((id = u8(room, p))) {
          t._localScriptOffsets[id - t._nums.global_scripts] = u16(room, p + 1);
          p += 3;
        }
      }
      t._gfx.IM00 = {stream: room, offset: im};
      // GdiV2::roomChanged
      if (v2) t._gdi.roomStrips = generateStripTable(room, im, t._roomWidth, t._roomHeight);
      t._gdi.transparentColor = 255;
      if (v2) t._gdi.drawBitmap = drawBitmapV2;
    },

    // room.cpp ScummEngine_v3old::resetRoomSubBlocks: the boxes; the
    // palette is the EGA one, for the whole game
    resetRoomSubBlocks: function() {
      var t = this, room = t.getResourceAddress("room", t._roomResource), offs, i;
      if (t._version <= 2) {
        offs = u8(room, 0x15);
        loadBoxesV2(t, room, offs);
      } else {
        offs = u16(room, 0x15);
        loadBoxesV3(t, room, offs, u16(room, 0x0A));
      }
      for (i = 0; i < 16; i++) t._currentPalette[i] = EGA[i].slice();
    },

    // object.cpp ScummEngine_v3old::resetRoomObjects: the room lists where
    // each object's image and code are
    resetRoomObjects: function() {
      var t = this, room = t.getResourceAddress("room", t._roomResource),
          p = t._version <= 2 ? 28 : 29, n = t._numObjectsInRoom, i, od;
      if (!n) return;
      for (i = 0; i < n; i++) {
        od = t._objs[t.findLocalObjectSlot()];
        od.OBIMoffset = u16(room, p + 2 * i);
        od.OBCDoffset = u16(room, p + 2 * n + 2 * i);
        t.resetRoomObject(od, room);
      }
    },

    // object.cpp ScummEngine_v4::resetRoomObject, GF_OLD_BUNDLE
    resetRoomObject: function(od, room) {
      var t = this, p = od.OBCDoffset - 2;
      od.obj_nr = u16(room, p + 6);
      od.x_pos = u8(room, p + 9) * 8;
      od.y_pos = (u8(room, p + 10) & 0x7F) * 8;
      od.parentstate = (u8(room, p + 10) & 0x80) ? 1 : 0;
      if (t._version <= 2) od.parentstate *= 8;
      od.width = u8(room, p + 11) * 8;
      od.parent = u8(room, p + 12);
      if (t._version <= 2) {
        od.walk_x = u8(room, p + 13) * 8;
        od.walk_y = (u8(room, p + 14) & 0x1F) * 8;
        od.actordir = u8(room, p + 15) & 7;
        od.height = u8(room, p + 15) & 0xF8;
      } else {
        od.walk_x = u16(room, p + 13);
        od.walk_y = u16(room, p + 15);
        od.actordir = u8(room, p + 17) & 7;
        od.height = u8(room, p + 17) & 0xF8;
      }
      od.fl_object_index = 0;
      od.flags = t._gdi.dbAllowMaskOr;
    },

    // a name is at an offset the object's byte 14 (v2) or 16 gives
    getObjOrActorName: function(obj) {
      var t = this, i, loc, p, len, out = "", c;
      if (obj < t._nums.actors) return t.getResourceMessage("actor_name", obj);
      for (i = 0; i < t._nums.new_names; i++)
        if (t._newNames[i] == obj) return t.getResourceMessage("object_name", i);
      loc = t.getOBCDAddress(obj);
      if (!loc) return null;
      p = loc.res.newAbsoluteStream(loc.abs);
      p.seek(loc.abs + u8(p, t._version <= 2 ? 14 : 16), true);
      for (len = 0; len < 256 && (c = p.readUI8()); len++) out += String.fromCharCode(c);
      return out;
    },

    // object.cpp addObjectToInventory: the object's code, its size its
    // first word
    addObjectToInventory: function(obj, room) {
      var t = this, roomptr, n, p, i, obcd, size, slot, loc;
      if (t.whereIsObject(obj) == WIO_FLOBJECT) {
        loc = t.getOBCDAddress(obj);
        if (!loc) return;
        roomptr = loc.res;
        obcd = loc.abs;
      } else {
        roomptr = t.getResourceAddress("room", room);
        if (!roomptr) return;
        n = u8(roomptr, 20);
        p = t._version <= 2 ? 28 : 29;
        obcd = -1;
        for (i = 0; i < n; i++) {
          var o = u16(roomptr, p + 2 * n + 2 * i);
          if (u16(roomptr, o + 4) == obj) { obcd = o; break; }
        }
        if (obcd < 0) { error("addObjectToInventory: object " + obj + " not in room " + room); return; }
      }
      size = u16(roomptr, obcd);
      slot = t.getFreeInventorySlot();
      if (slot < 0) return;
      t._inventory[slot] = obj;
      t._res.types.inventory.address[slot] = roomptr.newStream(obcd, size);
    },

    // object.cpp getObjectXYPos: v1/v2 objects are placed in the coarse
    // units actors use
    getObjectXYPos: function(object) {
      var t = this, idx = t.getObjectIndex(object), od, pos;
      if (idx < 0) return null;
      od = t._objs[idx];
      if (t._version <= 2) pos = ScummVM.system.Point(od.walk_x >> 3, od.walk_y >> 1);
      else pos = ScummVM.system.Point(od.walk_x, od.walk_y);
      pos.dir = ScummVM.system.oldDirToNewDir(od.actordir & 3);
      return pos;
    },

    // gfx.cpp initBGBuffers: v1/v2 have one mask plane
    initBGBuffers: function() {
      var t = this, gdi = t._gdi, itemsize, i;
      gdi.numZBuffer = 2;
      itemsize = (t._roomHeight + 4) * gdi.numStrips;
      t._res.createResource("buffer", 9, itemsize * gdi.numZBuffer, -1);
      for (i = 0; i < gdi.imgBufOffs.length; i++)
        gdi.imgBufOffs[i] = (i < gdi.numZBuffer ? i : gdi.numZBuffer - 1) * itemsize;
    },

    // the image of an object is where the room's list says
    getOBIMFromObjectData: function(od) {
      if (!od.OBIMoffset) return null;
      return {stream: this.getResourceAddress("room", this._roomResource), offset: od.OBIMoffset};
    },
    getObjectImage: function(img) { return img; },

    // boxes.cpp: an old box number of 0xFF is no box
    isInvalidBox: function(box) {
      return box === 0xFF || box === "invalid" || box === null || box === undefined;
    }
  });

  s.defineVersion("2", {
    // boxes.cpp getNextBox, v2: the matrix row of `from` starts at the
    // index its first numOfBoxes bytes give
    getNextBox: function(from, to) {
      var t = this, n = t.getNumBoxes(), m = t._boxMatrix, v;
      if (from == to) return to;
      if (t.isInvalidBox(to)) return -1;
      if (t.isInvalidBox(from)) return to;
      if (from >= n || to >= n) return -1;
      v = m[n + m[from] + to];
      return v > 127 ? v - 256 : v;
    },
    // no actor scaling before v4
    getScale: function() { return 255; }
  });
}());
