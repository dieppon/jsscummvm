(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  s.RoomHeader = function(stream) {
    var t = this;
    t.width = 0; t.height = 0; t.numObjects = 0;
    t.stream = stream;
    if(t.stream) {
      t.width = t.stream.readUI16();
      t.height = t.stream.readUI16();
      t.numObjects = t.stream.readUI16();
    }
  };

  s.CodeHeader = function(stream) {
    var t = this;
    t.obj_id = 0; t.x = 0; t.y = 0; t.w = 0; t.h = 0;
    t.flags = 0; t.parent = 0; t.walk_x = 0; t.walk_y = 0;
    t.actordir = 0;
    if(stream) {
      t.obj_id = stream.readUI16(); t.x = stream.readUI8(); t.y = stream.readUI8(); t.w = stream.readUI8(); t.h = stream.readUI8();
      t.flags = stream.readUI8(); t.parent = stream.readUI8(); t.walk_x = stream.readSI16(); t.walk_y = stream.readSI16();
      t.actordir = stream.readUI8();
    }
  };

  s.ImageHeader = function(stream) {
    var t = this;
    t.obj_id = 0; t.image_count = 0; t.flags = 0;
    t.width = 0; t.height = 0; t.hotspot_num = 0;
    t.hotspot = [];
    if(stream) {
      t.obj_id = stream.readUI16(); t.image_count = stream.readUI16();
      stream.readUI16(); // unk
      t.flags = stream.readUI8();
      stream.readUI8(); // unk1
      stream.readUI16(); stream.readUI16(); // unk2
      t.width = stream.readUI16(); t.height = stream.readUI16();
      t.hotspot_num = stream.readUI16();
      for(var i = 0; i < 15; i++) {
        var x = stream.readUI16(), y = stream.readUI16();
        t.hotspot[i] = [x, y];
      }
    }
  };

  s.startScene = function(room, actor, objectNr) {
    var t = this, slot;

    log("Start scene "+room+" (old room "+t._currentRoom+")");
    t.stopTalk();
    // fadeOut
    slot = t.getScriptSlot(t._currentScript);
    if(t._currentScript != 0xFF) {
      if(slot.where == "room" || slot.where == "flobject" || slot.where == "local") {
        t._currentScript = 0xFF;
      }
    }

    t.scummVar("new_room", room);

    t.runExitScript();
    t.killScriptsAndResources();
    t.clearDrawQueues();
    // room.cpp: every actor is hidden on a room change; showActors brings
    // back the ones in the new room
    for(var i = 1; i < t._actors.length; i++)
      if(t._actors[i]) t._actors[i].hideActor();
    t.scummVar("room", room);
    t._fullRedraw = true;
    t._currentRoom = room;
    t._roomResource = room;
    t.scummVar("room_resource", t._roomResource);

    if(room != 0)
      t.ensureResourceLoaded("room", room);
    t.clearRoomObjects();

    if(t._currentRoom == 0) {
      // no room: no entry/exit code and no objects to carry over
      t._gfx["ENCD"] = t._gfx["EXCD"] = 0;
      t._numObjectsInRoom = 0;
      return;
    }

    t.setupRoomSubBlocks();
    t.resetRoomSubBlocks();
    t.initBGBuffers(t._roomHeight)
    t.resetRoomObjects();

    // How far the camera may scroll in this room, and a neutral starting view.
    t.scummVar("camera_min_x", Math.floor(t._screenWidth / 2));
    t.scummVar("camera_max_x", t._roomWidth - Math.floor(t._screenWidth / 2));
    t._camera.mode = "normal";
    t._camera.cur.x = t._camera.dest.x = Math.floor(t._screenWidth / 2);
    t._camera.cur.y = t._camera.dest.y = Math.floor(t._screenHeight / 2);
    t._camera.last.x = -1;
    t._camera.movingToActor = false;

    if(t._roomResource == 0)
      return;

    // room.cpp: an actor arriving with loadRoomWithEgo starts at the object
    // it came in by, facing away from it -- before the entry script, so the
    // camera can be put on him rather than panning across from the left
    var a = actor, pos;
    if(a && t.whereIsObject(objectNr) != -1) {
      pos = t.getObjectXYPos(objectNr);
      a.putActor(pos.x, pos.y, t._currentRoom);
      a.setDirection(pos.dir + 180);
      a.stopActorMoving();
    }

    t.showActors();
    t._egoPositioned = false;
    t.runEntryScript();

    // ...and again after it, unless the entry script placed him itself
    if(a && !t._egoPositioned && t.whereIsObject(objectNr) != -1) {
      pos = t.getObjectXYPos(objectNr);
      a.putActor(pos.x, pos.y, t._currentRoom);
      a.moving = 0;
    }
  };

  s.setupRoomSubBlocks = function() {
    var t = this, i, roomptr, rmhd, ptr, rmim, searchptr, id, trans,
        MKID_BE = _system.MKID_BE;

    t._gfx = {ENCD: 0, EXCD:0, EPAL:0, CLUT:0, PALS:0};

    roomptr = t.getResourceAddress("room", t._roomResource);
    if(!roomptr) error("Room "+t._roomResource_+" data not found");

    rmhd = new t.RoomHeader(t.findResourceData(MKID_BE("RMHD"), roomptr));
    t._roomWidth = rmhd.width;
    t._roomHeight = rmhd.height;
    t._numObjectsInRoom = rmhd.numObjects;


    rmim = t.findResource(MKID_BE("RMIM"), roomptr);
    t._gfx["IM00"] = t.findResource(MKID_BE("IM00"), rmim);

    ptr = t.findResource(MKID_BE("EXCD"), roomptr);
    if(ptr) t._gfx["EXCD"] = ptr;

    ptr = t.findResource(MKID_BE("ENCD"), roomptr, true);
    if(ptr) t._gfx["ENCD"] = ptr;

    // local scripts
    searchptr = roomptr.newRelativeStream(8);
    while(searchptr.findNext(MKID_BE("LSCR"))) {
      // searchptr.seek(8);
      id = searchptr.readUI8();
      searchptr.seek(-5);
      var size = searchptr.readUI32(true);
      t._localScriptOffsets[id - t._nums['global_scripts']] = searchptr.offset + 1;
      searchptr.seek(size - 8);
    }

    ptr = t.findResourceData(MKID_BE("CLUT"), roomptr);
    if(ptr) t._gfx["CLUT"] = ptr;

    ptr = t.findResourceData(MKID_BE("TRNS"), roomptr);
    if(ptr) trans = ptr.readUI8();
    else trans = 255;

    // gdi roomChanged
    t._gdi.transparentColor = trans;

  };

  s.resetRoomSubBlocks = function() {
    var t = this,
        roomptr = t.getResourceAddress("room", t._roomResource);

    t.loadBoxes(roomptr);
    t.setCurrentPalette(0);
  };

  s.resetRoomObjects = function() {
    var t = this, i, j, od, ptr, obim_id, room, searchptr, cdhd, MKID_BE = ScummVM.system.MKID_BE;

    room = t.getResourceAddress("room", t._roomResource);
    if(t._numObjectsInRoom == 0) return;
    searchptr = room.newRelativeStream(8);
    for(i = 0; i < t._numObjectsInRoom; i++) {
      od = t._objs[t.findLocalObjectSlot()];
      if(searchptr.findNext(MKID_BE('OBCD'))) {
        od.OBCDoffset = searchptr.offset - 8;
        cdhd = t.findResourceData(MKID_BE('CDHD'), searchptr.newRelativeStream(-8));
        od.obj_nr = cdhd.readUI16();
      } else
        break;
    }

    searchptr = room.newRelativeStream(8);
    for(i = 0; i < t._numObjectsInRoom; i++) {
      if(searchptr.findNext(MKID_BE('OBIM'))) {
        obim_id = t.getObjectIdFromOBIM(searchptr);
        for(j = 1; j < t._nums['local_objects']; j++) {
          if(t._objs[j].obj_nr == obim_id) {
            t._objs[j].OBIMoffset = searchptr.offset - 8;
          }
        }
      } else
        break;
    }

    for(i = 1; i < t._nums['local_objects']; i++) {
    // for(i = 1; i < t._objs.length; i++) {
      if(t._objs[i].obj_nr && !t._objs[i].fl_object_index)
        t.resetRoomObject(t._objs[i], room);
    }
  };

  s.resetRoomObject = function(od, room, searchptr) {
    var t = this, cdhd, imhd, MKID_BE = ScummVM.system.MKID_BE;
    if(!searchptr) {
      searchptr = room.newAbsoluteStream(0);
    }
    cdhd = new t.CodeHeader(t.findResourceData(MKID_BE('CDHD'), searchptr.newAbsoluteStream(od.OBCDoffset)));
    if(od.OBIMoffset)
      imhd = new t.ImageHeader(t.findResourceData(MKID_BE('IMHD'), searchptr.newAbsoluteStream(od.OBIMoffset)));

    od.obj_nr = cdhd.obj_id;
    od.width = cdhd.w * 8; od.height = cdhd.h * 8;
    od.x_pos = cdhd.x * 8; od.y_pos = cdhd.y * 8;
    if(cdhd.flags == 0x80) {
      od.parentstate = 1;
    } else {
      od.parentstate = (cdhd.flags & 0xF);
    }
    od.parent = cdhd.parent;
    od.walk_x = cdhd.walk_x; od.walk_y = cdhd.walk_y;
    od.actordir = cdhd.actordir;
    od.fl_object_index = 0;
    // object.cpp: room objects may OR their masks into the z-planes
    od.flags = t._gdi.dbAllowMaskOr;
  }

  s.getObjectIdFromOBIM = function(obim) {
    var t = this, MKID_BE = ScummVM.system.MKID_BE;
    return t.findResourceData(MKID_BE('IMHD'), obim.newRelativeStream(-8)).readUI16();
  };

  // object.cpp clearRoomObjects: the previous room's objects go, except
  // flobjects (which this port does not create yet)
  s.clearRoomObjects = function() {
    var t = this, i, od;
    for(i = 0; i < t._nums['local_objects']; i++) {
      od = t._objs[i];
      if(!od || od.obj_nr < 1) continue;
      if(!od.fl_object_index) {
        od.obj_nr = 0;
      } else {
        t._res.nukeResource("fl_object", od.fl_object_index);
        od.obj_nr = 0;
        od.fl_object_index = 0;
      }
    }
  };

  s.findLocalObjectSlot = function() {
    var t = this, i, objs = t._objs;
    for(i = 1; i < t._nums['local_objects']; i++) {
      if(!objs[i].obj_nr) {
        objs[i] = new t.ObjectData();
        return i;
      }
    }
    return -1;
  };

}());
