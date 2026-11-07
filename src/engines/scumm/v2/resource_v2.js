/*
 * Resources of the oldest SCUMM games, ported from ScummVM's
 * engines/scumm/resource_v2.cpp, resource_v3.cpp and resource_v4.cpp.
 *
 * Maniac Mansion (v2), Zak McKracken and Indiana Jones and the Last Crusade
 * (v3old) keep a file per room -- 01.LFL, 02.LFL... -- with 00.LFL as the
 * index, all XOR-ed with 0xFF. There are no tagged blocks: the index lists,
 * for each costume, script and sound, the room whose file holds it and
 * where, and each resource starts with its size (GF_OLD_BUNDLE), a 4-byte
 * header in all. The fixed sizes they share with v3 and v4 (readMAXS) are
 * in v4/resource_v4.js.
 */
(function () {
  "use strict";

  var s = ScummVM.engines.SCUMM,
      RES_INVALID_OFFSET = 0xFFFFFFFF,
      OF_OWNER_MASK = 0x0F,
      OF_STATE_SHL = 4;

  function pad(n, width) {
    n = String(n);
    while (n.length < width) n = "0" + n;
    return n;
  }

  s.defineVersion("3old", {
    _resourceHeaderSize: 4,

    // ScummEngine_v3old::readResTypeList: a count byte, the room of each
    // (rooms are their own), then where in it, 0xFFFF for none
    readResTypeList: function (file, type) {
      var res = this._res.types[type], num = file.readUI8(), i, offs;
      res.num = num;
      res.roomno = [];
      res.roomoffs = [];
      res.address = [];
      if (type == "room") {
        for (i = 0; i < num; i++) res.roomno[i] = i;
        file.seek(num);
      } else {
        for (i = 0; i < num; i++) res.roomno[i] = file.readUI8();
      }
      for (i = 0; i < num; i++) {
        offs = file.readUI16();
        res.roomoffs[i] = offs == 0xFFFF ? RES_INVALID_OFFSET : offs;
        res.address[i] = null;
      }
      return num;
    },

    generateFilename: function (room) {
      return pad(room, 2) + ".lfl";
    },

    openResourceFile: function (filename) {
      var i = this._filenames[filename.toLowerCase()];
      if (i === undefined) return false;
      this._file = this._files[i];
      return true;
    },

    // resource.cpp openRoom, for files of one room each
    openRoom: function (room) {
      var t = this;
      if (t._lastLoadedRoom == room) return;
      t._lastLoadedRoom = room;
      if (room == -1) return;
      if (!t.openResourceFile(t.generateFilename(room)))
        error("openRoom: no file for room " + room);
      t._fileOffset = 0;
    },

    closeRoom: function () {
      this._lastLoadedRoom = -1;
    },

    // resource.cpp loadResource, GF_OLD_BUNDLE: the resource's size is its
    // first word
    loadResource: function (type, idx) {
      var t = this, res = t._res.types[type], roomNr, fileOffs, file, size;
      if (type == "charset") {
        t.loadCharset(idx);
        return 1;
      }
      if (idx >= res.num) {
        error(type + " " + idx + " undefined");
        return 0;
      }
      roomNr = t.getResourceRoomNr(type, idx);
      if (roomNr == 0) roomNr = t._roomResource;
      fileOffs = type == "room" ? 0 : res.roomoffs[idx];
      if (fileOffs == RES_INVALID_OFFSET) return 0;
      t.openRoom(roomNr);
      file = t._file;
      file.seek(t._fileOffset + fileOffs, true);
      size = file.readUI16();
      file.seek(-2);
      t._res.createResource(type, idx, size);
      return 1;
    }
  });

  s.defineVersion("2", {
    // resource_v2.cpp readEnhancedIndexFile: the counts are read first, to
    // size everything, then the lists themselves
    readIndexFile: function () {
      var t = this, file, magic, n = t._nums;
      t.closeRoom();
      t.openRoom(0);
      file = t._file;
      file.seek(0, true);
      magic = file.readUI16();
      if (magic != 0x0100) error("readIndexFile: not an enhanced v2 index (0x" + magic.toString(16) + ")");

      n.global_objects = file.readUI16();
      file.seek(n.global_objects);
      n.rooms = file.readUI8();
      file.seek(n.rooms * 3);
      n.costumes = file.readUI8();
      file.seek(n.costumes * 3);
      n.scripts = file.readUI8();
      file.seek(n.scripts * 3);
      n.sounds = file.readUI8();

      file.seek(0, true);
      t.readMAXS();
      t.allocateArrays();
      file.readUI16();
      t.readGlobalObjects(file);
      t.readResTypeList(file, "room");
      t.readResTypeList(file, "costume");
      t.readResTypeList(file, "script");
      t.readResTypeList(file, "sound");
      t.closeRoom();
    },

    // just an owner and a state for each: the class is in the object
    readGlobalObjects: function (file) {
      var t = this, num = file.readUI16(), i, v;
      for (i = 0; i < num; i++) {
        v = file.readUI8();
        t._objectOwnerTable[i] = v & OF_OWNER_MASK;
        t._objectStateTable[i] = v >> OF_STATE_SHL;
      }
    },

    // the font is built in (charset_v2.js)
    loadCharset: function (no) {}
  });
}());
