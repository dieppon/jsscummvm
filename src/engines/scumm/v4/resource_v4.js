/*
 * SCUMM v4 -- and v3, which ScummVM builds on it -- ported from ScummVM's
 * resource_v4.cpp and the GF_SMALL_HEADER parts of resource.cpp, room.cpp,
 * object.cpp, boxes.cpp and gfx.cpp.
 *
 * These games (Indiana Jones and the Last Crusade VGA, Loom CD, Monkey
 * Island EGA) keep v5's blocks in a smaller form: a 4-byte little-endian
 * size and a two-letter tag ("HD", "BM", "OC"...) in place of v5's 8-byte
 * header and four-letter tag. findResource takes v5's tags and finds their
 * small names, so much of the v5 code works on them as it is.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM, MKID_BE = function(id) { return ScummVM.system.MKID_BE(id); };
  var RES_INVALID_OFFSET = 0xFFFFFFFF, OF_OWNER_MASK = 0x0F, OF_STATE_SHL = 4;

  function pad(n, width) {
    n = String(n);
    while (n.length < width) n = "0" + n;
    return n;
  }
  function u8(r, o) { return r.readByteAt(r.offset + o); }
  function u16(r, o) { return u8(r, o) | (u8(r, o + 1) << 8); }
  function s16(r, o) { var v = u16(r, o); return v > 0x7FFF ? v - 0x10000 : v; }
  function u32(r, o) { return (u16(r, o) | (u16(r, o + 2) << 16)) >>> 0; }

  // resource.cpp newTag2Old
  var SMALL = {
    RMHD: "HD", IM00: "BM", EXCD: "EX", ENCD: "EN", SCAL: "SA", LSCR: "LS", OBCD: "OC",
    OBIM: "OI", SMAP: "BM", CLUT: "PA", BOXD: "BX", CYCL: "CC", EPAL: "SP"
  };
  var TAGS = {};
  Object.keys(SMALL).forEach(function(k) {
    TAGS[MKID_BE(k)] = SMALL[k].charCodeAt(0) | (SMALL[k].charCodeAt(1) << 8);
  });

  // every small block directly inside `room` (after its own header), as
  // [tag, absolute offset, size]
  function blocks(room) {
    var out = [], total = u32(room, 0), pos = 6, size;
    while (pos + 6 <= total) {
      size = u32(room, pos);
      if (size < 6) break;
      out.push([u16(room, pos + 4), pos, size]);
      pos += size;
    }
    return out;
  }
  function tagOf(name) { return name.charCodeAt(0) | (name.charCodeAt(1) << 8); }

  // gfx.cpp Gdi::drawBitmap for small headers: the strips' offsets are
  // 32-bit after the block's length; z-planes follow the picture
  function drawBitmapSmall(img, vs, x, y, width, height, stripnr, numstrip, flag) {
    var gdi = this, vm = gdi.engine, r = img.stream, base = img.offset, zplanes = [base],
        numzbuf, i, sx, limit, k, offset, dst, front, smapLen, off, src, transp, z, zoffs, mask, h,
        old256 = vm._version == 3;
    if (!r) return;
    gdi.vertStripNextInc = height * vs.pitch - 1;
    gdi.objectMode = (flag & gdi.dbObjectMode) == gdi.dbObjectMode;
    numzbuf = gdi.zBufferDisabled ? 0 : gdi.numZBuffer;
    if (numzbuf > 1) {
      zplanes[1] = base + u32(r, base);
      if (old256 && u32(r, zplanes[1]) == 0) zplanes[1] = null;
      for (i = 2; i < numzbuf; i++)
        zplanes[i] = zplanes[i - 1] == null ? null : zplanes[i - 1] + u16(r, zplanes[i - 1]);
    }
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
    smapLen = u32(r, base);
    for (k = 0; k < limit; ++k, ++stripnr, ++sx, ++x) {
      offset = y * vs.pitch + x * 8;
      dst = (vs.number == 0 ? vs.backBuf : vs.pixels).newRelativeStream(offset);
      off = stripnr * 4 + 4 < smapLen ? u32(r, base + stripnr * 4 + 4) : -1;
      transp = false;
      if (off >= 0) {
        src = r.newAbsoluteStream(base + off);
        transp = gdi.decompressBitmap(dst, vs.pitch, src, height);
      }
      if (vs.number == 0) {
        dst = vs.backBuf.newRelativeStream(offset);
        front = vs.pixels.newRelativeStream(offset);
        if (vm.isLightOn()) gdi.copy8Col(front, vs.pitch, dst, height, 1);
        else gdi.clear8Col(front, vs.pitch, height);
      }
      for (i = 1; i < numzbuf; i++) {
        z = zplanes[i];
        if (z == null) continue;
        zoffs = old256 ? u16(r, z + stripnr * 2 + 4) : u16(r, z + stripnr * 2 + 2);
        mask = gdi.getMaskBuffer(x, y, i);
        if (zoffs) {
          if (transp && (flag & gdi.dbAllowMaskOr)) gdi.decompressMaskImgOr(mask, r.newAbsoluteStream(z + zoffs), height);
          else gdi.decompressMaskImg(mask, r.newAbsoluteStream(z + zoffs), height);
        } else if (!(transp && (flag & gdi.dbAllowMaskOr))) {
          for (h = 0; h < height; h++) {
            mask.writeUI8(0);
            mask.seek(gdi.numStrips - 1);
          }
        }
      }
    }
  }

  s.defineVersion("4", {
    _resourceHeaderSize: 6,

    // ScummEngine_v4::readMAXS: these games' sizes are fixed, not in the index
    readMAXS: function() {
      var n = this._nums;
      n.variables = 800;
      n.bit_variables = 4096;
      n.local_objects = 200;
      n.array = 50;
      n.verbs = 100;
      n.new_names = 50;
      n.charsets = 9;
      n.inventory = 80;
      n.global_scripts = 200;
      n.fl_object = 50;
      n.shadow_pallete_size = 256;
      n.images = 0;
      // scumm.cpp: Maniac Mansion has 25 actors, the rest 13
      n.actors = this._game == "maniac" ? 25 : 13;
      this._objectRoomTable = null;
    },

    // resource_v4.cpp readIndexFile: small blocks -- the counts first, then
    // the lists. The index's tags are stored the other way round from the
    // rooms' ("0R" for its rooms, where a room has "HD").
    readIndexFile: function() {
      var t = this, file, size, tag, n = t._nums, start, k;
      t.closeRoom();
      t.openRoom(0);
      file = t._file;
      file.seek(0, true);
      while (file.offset + 6 <= file.length) {
        start = file.offset;
        size = file.readUI32();
        tag = file.readUI16();
        switch (tag) {
          case tagOf("0R"): n.rooms = file.readUI16(); break;
          case tagOf("0S"): n.scripts = file.readUI16(); break;
          case tagOf("0N"): n.sounds = file.readUI16(); break;
          case tagOf("0C"): n.costumes = file.readUI16(); break;
          case tagOf("0O"): n.global_objects = file.readUI16(); break;
        }
        if (size < 6) break;
        file.seek(start + size, true);
      }
      file.seek(0, true);
      t.readMAXS();
      t.allocateArrays();
      while (file.offset + 6 <= file.length) {
        start = file.offset;
        size = file.readUI32();
        tag = file.readUI16();
        switch (tag) {
          case tagOf("0R"): t.readResTypeList(file, "room"); break;
          case tagOf("0S"): t.readResTypeList(file, "script"); break;
          case tagOf("0N"): t.readResTypeList(file, "sound"); break;
          case tagOf("0C"): t.readResTypeList(file, "costume"); break;
          case tagOf("0O"): t.readGlobalObjects(file); break;
        }
        if (size < 6) break;
        file.seek(start + size, true);
      }
      t.closeRoom();
    },

    // a room and an offset for each, 0xFFFFFFFF for none
    readResTypeList: function(file, type) {
      var res = this._res.types[type], num = file.readUI16(), i;
      res.num = num;
      res.roomno = [];
      res.roomoffs = [];
      res.address = [];
      for (i = 0; i < num; i++) {
        res.roomno[i] = file.readUI8();
        res.roomoffs[i] = file.readUI32();
        res.address[i] = null;
      }
      return num;
    },

    // 24 bits of class, then the owner and the state
    readGlobalObjects: function(file) {
      var t = this, num = file.readUI16(), i, v;
      for (i = 0; i < num; i++) {
        t._classData[i] = file.readUI8() | (file.readUI8() << 8) | (file.readUI8() << 16);
        v = file.readUI8();
        t._objectOwnerTable[i] = v & OF_OWNER_MASK;
        t._objectStateTable[i] = v >> OF_STATE_SHL;
      }
    },

    // resource.cpp findResourceSmall, by v5's tag
    findResource: function(tag, source) {
      var small = TAGS[tag], total, pos, size;
      if (!small || !source) return null;
      total = u32(source, 0);
      for (pos = 6; pos + 6 <= total; pos += size) {
        size = u32(source, pos);
        if (u16(source, pos + 4) == small) return source.newStream(source.offset + pos, size);
        if (size <= 0) return null;
      }
      return null;
    },
    getResourceDataSize: function(stream) {
      return u32(stream.newAbsoluteStream(0), 0) - 6;
    },

    // room.cpp setupRoomSubBlocks, GF_SMALL_HEADER
    setupRoomSubBlocks: function() {
      var t = this, room = t.getResourceAddress("room", t._roomResource), list, i, b, id;
      if (!room) error("Room " + t._roomResource + ": data not found");
      t._gfx = {ENCD: 0, EXCD: 0, EPAL: 0, CLUT: 0, PALS: 0};
      t._localScriptOffsets = [];
      list = blocks(room);
      for (i = 0; i < list.length; i++) {
        b = list[i];
        switch (b[0]) {
          case tagOf("HD"):
            t._roomWidth = u16(room, b[1] + 6);
            t._roomHeight = u16(room, b[1] + 8);
            t._numObjectsInRoom = u16(room, b[1] + 10);
          break;
          case tagOf("BM"):
            if (t._gfx.IM00 === undefined) t._gfx.IM00 = {stream: room, offset: b[1] + 6};
          break;
          case tagOf("EX"): t._gfx.EXCD = room; t._gfx.EXCD_offs = b[1] + 6; break;
          case tagOf("EN"): t._gfx.ENCD = room; t._gfx.ENCD_offs = b[1] + 6; break;
          case tagOf("PA"): t._gfx.CLUT = {stream: room, offset: b[1] + 6}; break;
          case tagOf("BX"): t._gfx.BOXD = {stream: room, offset: b[1] + 6, size: b[2] - 6}; break;
          case tagOf("LS"):
            id = u8(room, b[1] + 6);
            t._localScriptOffsets[id - t._nums.global_scripts] = b[1] + 7;
          break;
        }
      }
      t._gdi.transparentColor = 255;
      t._gdi.drawBitmap = drawBitmapSmall;
    },

    // room.cpp resetRoomSubBlocks, GF_SMALL_HEADER: the boxes, with the
    // box matrix after them, and the palette
    resetRoomSubBlocks: function() {
      var t = this, bx = t._gfx.BOXD, pal = t._gfx.CLUT, r, n, size, p, i, count, v3 = t._version == 3;
      t._boxes = [];
      t._boxMatrix = [];
      t._scaleSlots = [];
      if (bx) {
        r = bx.stream;
        n = u8(r, bx.offset);
        size = n * (v3 ? 18 : 20) + 1;
        for (i = 0; i < n; i++) {
          p = bx.offset + 1 + i * (v3 ? 18 : 20);
          t._boxes[i] = {
            ulx: s16(r, p), uly: s16(r, p + 2), urx: s16(r, p + 4), ury: s16(r, p + 6),
            lrx: s16(r, p + 8), lry: s16(r, p + 10), llx: s16(r, p + 12), lly: s16(r, p + 14),
            mask: u8(r, p + 16), flags: u8(r, p + 17), scale: v3 ? 255 : u16(r, p + 18)
          };
        }
        for (p = bx.offset + size; p < bx.offset + bx.size; p++) t._boxMatrix.push(u8(r, p));
      }
      // palette.cpp setPaletteFromPtr: a count first -- of colours in the
      // VGA v3 games, of bytes in v4
      if (pal) {
        r = pal.stream;
        count = u16(r, pal.offset);
        if (!v3) count = Math.floor(count / 3);
        for (i = 0; i < count && i < 256; i++) {
          p = pal.offset + 2 + i * 3;
          if (i <= 15 || u8(r, p) < 252 || u8(r, p + 1) < 252 || u8(r, p + 2) < 252)
            t._currentPalette[i] = [u8(r, p), u8(r, p + 1), u8(r, p + 2)];
        }
      }
      t.initCycl(null);
    },

    // object.cpp ScummEngine_v4::resetRoomObjects: the room's code blocks
    // in order, then each image matched to its object
    resetRoomObjects: function() {
      var t = this, room = t.getResourceAddress("room", t._roomResource), list = blocks(room),
          i, j, od, id;
      if (!t._numObjectsInRoom) return;
      for (i = 0; i < list.length; i++) {
        if (list[i][0] != tagOf("OC")) continue;
        od = t._objs[t.findLocalObjectSlot()];
        od.OBCDoffset = list[i][1];
        od.obj_nr = u16(room, list[i][1] + 6);
      }
      for (i = 0; i < list.length; i++) {
        if (list[i][0] != tagOf("OI")) continue;
        id = u16(room, list[i][1] + 6);
        for (j = 1; j < t._nums.local_objects; j++)
          if (t._objs[j] && t._objs[j].obj_nr == id) t._objs[j].OBIMoffset = list[i][1];
      }
      for (i = 1; i < t._nums.local_objects; i++)
        if (t._objs[i] && t._objs[i].obj_nr && !t._objs[i].fl_object_index) t.resetRoomObject(t._objs[i], room);
    },

    // object.cpp ScummEngine_v4::resetRoomObject
    resetRoomObject: function(od, room) {
      var t = this, p = od.OBCDoffset;
      od.obj_nr = u16(room, p + 6);
      od.x_pos = u8(room, p + 9) * 8;
      od.y_pos = (u8(room, p + 10) & 0x7F) * 8;
      od.parentstate = (u8(room, p + 10) & 0x80) ? 1 : 0;
      od.width = u8(room, p + 11) * 8;
      od.parent = u8(room, p + 12);
      od.walk_x = s16(room, p + 13);
      od.walk_y = s16(room, p + 15);
      od.actordir = u8(room, p + 17) & 7;
      od.height = u8(room, p + 17) & 0xF8;
      od.fl_object_index = 0;
      od.flags = t._gdi.dbAllowMaskOr;
    },

    // the name is where byte 18 of the code says
    getObjOrActorName: function(obj) {
      var t = this, i, loc, p, out = "", c, len;
      if (obj < t._nums.actors) return t.getResourceMessage("actor_name", obj);
      for (i = 0; i < t._nums.new_names; i++)
        if (t._newNames[i] == obj) return t.getResourceMessage("object_name", i);
      loc = t.getOBCDAddress(obj);
      if (!loc) return null;
      p = loc.res.newAbsoluteStream(loc.abs);
      p.seek(loc.abs + u8(p, 18), true);
      for (len = 0; len < 256 && (c = p.readUI8()); len++) out += String.fromCharCode(c);
      return out;
    },

    // script.cpp getVerbEntrypoint, GF_SMALL_HEADER: entries of a verb and
    // a 16-bit offset from the object, after its 19-byte header
    getVerbEntryPoint: function(obj, entry) {
      var t = this, loc = t.getOBCDAddress(obj), p, code;
      if (!loc) return 0;
      p = loc.res.newAbsoluteStream(loc.abs + 19);
      for (;;) {
        code = p.readUI8();
        if (!code) return 0;
        if (code == entry || code == 0xFF) return p.readUI16();
        p.readUI16();
      }
    },

    // object.cpp addObjectToInventory: the object's code block, its size
    // its first long
    addObjectToInventory: function(obj, room) {
      var t = this, roomptr, list, i, obcd = -1, size, slot, loc;
      if (t.whereIsObject(obj) == WIO_FLOBJECT) {
        loc = t.getOBCDAddress(obj);
        if (!loc) return;
        roomptr = loc.res;
        obcd = loc.abs;
      } else {
        roomptr = t.getResourceAddress("room", room);
        if (!roomptr) return;
        list = blocks(roomptr);
        for (i = 0; i < list.length; i++)
          if (list[i][0] == tagOf("OC") && u16(roomptr, list[i][1] + 6) == obj) { obcd = list[i][1]; break; }
        if (obcd < 0) { error("addObjectToInventory: object " + obj + " not in room " + room); return; }
      }
      size = u32(roomptr, obcd);
      slot = t.getFreeInventorySlot();
      if (slot < 0) return;
      t._inventory[slot] = obj;
      t._res.types.inventory.address[slot] = roomptr.newStream(obcd, size);
    },

    // object.cpp getObjectImage, GF_SMALL_HEADER: the image follows the
    // image block's header and object number
    getOBIMFromObjectData: function(od) {
      if (!od.OBIMoffset) return null;
      return {stream: this.getResourceAddress("room", this._roomResource), offset: od.OBIMoffset + 8};
    },
    getObjectImage: function(img) { return img; },

    /* --- Loom CD's files (resource.cpp, resource_v4.cpp) ---------------- */
    // The index is 000.LFL, the fonts 901-904.LFL, and the rooms are in
    // DISKnn.LEC, each in an "LF" block whose place a table at the file's
    // start gives. (Indy3, v3, has its own: a file per room.)

    generateFilename: function(room) {
      var n = room > 0 ? this._res.types.room.roomno[room] : 0;
      return room == 0 || room >= 900 ? pad(room, 3) + ".lfl" : "disk" + pad(n, 2) + ".lec";
    },
    openResourceFile: function(filename) {
      var i = this._filenames[filename.toLowerCase()];
      if (i === undefined) return false;
      this._file = this._files[i];
      return true;
    },
    openRoom: function(room) {
      var t = this, name, file, num, r, offs;
      if (t._lastLoadedRoom == room) return;
      t._lastLoadedRoom = room;
      if (room == -1) return;
      name = t.generateFilename(room);
      if (!t.openResourceFile(name)) error("openRoom: no " + name + " for room " + room);
      t._fileOffset = 0;
      if (room == 0) return;
      // readRoomsOffsets, GF_SMALL_HEADER: the table is at 12
      file = t._file;
      file.seek(12, true);
      num = file.readUI8();
      while (num--) {
        r = file.readUI8();
        offs = file.readUI32();
        if (r == room) t._fileOffset = offs;
      }
    },
    closeRoom: function() { this._lastLoadedRoom = -1; },

    // resource.cpp loadResource: in v4 a resource's offset is 8 before it
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
      file.seek(t._fileOffset + fileOffs + 8, true);
      size = file.readUI32();
      file.seek(-4);
      t._res.createResource(type, idx, size);
      return 1;
    },

    // resource_v4.cpp loadCharset: charset n is 90n.LFL, after its size; the
    // colours come from the scripts, not the font
    loadCharset: function(no) {
      var t = this, file, size;
      if (!t.openResourceFile(pad(900 + no, 3) + ".lfl")) return;
      file = t._file;
      size = file.seek(0, true).readUI32() + 11;
      t._res.types.charset.address[no] = file.newStream(4, Math.min(size, file.length - 4));
      t._charsetData[no] = [];
      for (var i = 0; i < 16; i++) t._charsetData[no][i] = 0;
      t._lastLoadedRoom = -1;
    },
    resetScumm: function() {
      this._res.allocResTypeData("charset", 0, 9, "charset", 0);
      this._baseMethods.resetScumm.call(this);
    },

    // gfx.cpp initBGBuffers: v3 has one mask plane; v4 counts the planes
    // after the picture
    initBGBuffers: function() {
      var t = this, gdi = t._gdi, itemsize, i, img = t._gfx.IM00, r, p, off;
      if (t._version <= 3) {
        gdi.numZBuffer = 2;
      } else {
        gdi.numZBuffer = 0;
        if (img) {
          r = img.stream;
          p = img.offset;
          off = u32(r, p);
          while (off && gdi.numZBuffer < 4) {
            gdi.numZBuffer++;
            p += off;
            off = u16(r, p);
          }
        }
        if (!gdi.numZBuffer) gdi.numZBuffer = 1;
      }
      itemsize = (t._roomHeight + 4) * gdi.numStrips;
      t._res.createResource("buffer", 9, itemsize * gdi.numZBuffer, -1);
      for (i = 0; i < gdi.imgBufOffs.length; i++)
        gdi.imgBufOffs[i] = (i < gdi.numZBuffer ? i : gdi.numZBuffer - 1) * itemsize;
    }
  });
}());
