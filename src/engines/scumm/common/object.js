/*
 * Objects, ported from ScummVM's engines/scumm/object.cpp: finding them,
 * where they are and who owns them, their classes and states, their names,
 * and the inventory. Drawing them is in gfx.js.
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  s.getObjectIndex = function(obj) {
    var t = this, i;
    if(obj < 1)
      return -1;
    for(i = t._objs.length; i > 0; i--) {
      if(t._objs[i] && t._objs[i].obj_nr == obj)
        return i;
    }
    return -1;
  };

  s.getObjectXYPos = function(object) {
    var idx = s.getObjectIndex(object), od, pos;
    if(idx < 0) return null;
    od = s._objs[idx];
    pos = _system.Point(od.walk_x, od.walk_y);
    pos.dir = _system.oldDirToNewDir(od.actordir & 3);

    return pos;
  };


  /* --- object helpers, ported from ScummVM's object.cpp ----------------- */


  s.objIsActor = function(obj) {
    // in v5 an object number below the actor count refers to that actor
    return obj < this._nums['actors'];
  };

  s.getClass = function(obj, cls) {
    var t = this;
    cls &= 0x7F;
    if (cls < 1 || cls > 32) return false;
    return (t._classData[obj] & (1 << (cls - 1))) != 0;
  };

  s.whereIsObject = function(object) {
    var t = this, i;
    if (object >= t._nums['global_objects']) return WIO_NOT_FOUND;
    if (object < 1) return WIO_NOT_FOUND;

    if (t._objectOwnerTable[object] != OF_OWNER_ROOM) {
      for (i = 0; i < t._nums['inventory']; i++)
        if (t._inventory[i] == object) return WIO_INVENTORY;
      return WIO_NOT_FOUND;
    }

    for (i = t._nums['local_objects'] - 1; i > 0; i--) {
      if (t._objs[i] && t._objs[i].obj_nr == object) {
        return t._objs[i].fl_object_index ? WIO_FLOBJECT : WIO_ROOM;
      }
    }
    return WIO_NOT_FOUND;
  };

  /* Which object is at (x, y), from ScummVM's findObject (object.cpp). The
     game's sentence script calls this with VAR_VIRT_MOUSE_X/Y to work out what
     the pointer is over -- it is what fills in the sentence line ("Walk to
     door"), so with it stubbed to 0 the line stayed blank.

     The do/while walks up the parent chain: a child object is only hittable
     while its parent is in the state the child was defined for. */
  s.findObject = function(x, y) {
    // v1/v2 draw an object while its intrinsic state bit (8) is set
    var t = this, i, b, a, od, mask = t._version <= 2 ? 8 : 0xF;

    for (i = 1; i < t._nums['local_objects']; i++) {
      od = t._objs[i];
      if (!od || od.obj_nr < 1) continue;
      if (t.getClass(od.obj_nr, kObjectClassUntouchable)) continue;
      // and are not found while untouchable (state bit 2)
      if (t._version <= 2 && (t.getState(od.obj_nr) & 2)) continue;

      b = i;
      do {
        a = t._objs[b].parentstate;
        b = t._objs[b].parent;
        if (b == 0) {
          if (od.x_pos <= x && od.width + od.x_pos > x &&
              od.y_pos <= y && od.height + od.y_pos > y)
            return od.obj_nr;
          break;
        }
      } while ((t._objectStateTable[t._objs[b].obj_nr] & mask) == a);
    }

    return 0;
  };

  s.getObjectOrActorXY = function(object) {
    var t = this, act;
    if (t.objIsActor(object)) {
      act = t.getActor(object);
      if (act && act.isInCurrentRoom()) return {x: act.pos.x, y: act.pos.y};
      return null;
    }
    switch (t.whereIsObject(object)) {
      case WIO_NOT_FOUND:
        return null;
      case WIO_INVENTORY:
        if (t.objIsActor(t._objectOwnerTable[object])) {
          act = t.getActor(t._objectOwnerTable[object]);
          if (act && act.isInCurrentRoom()) return {x: act.pos.x, y: act.pos.y};
        }
        return null;
    }
    try { return t.getObjectXYPos(object); } catch (e) { return null; }
  };

  // object.cpp getDist / getObjActToObjActDist: 0xFF when either is missing
  s.getDist = function(x, y, x2, y2) {
    return Math.max(Math.abs(y - y2), Math.abs(x - x2));
  };

  s.getObjActToObjActDist = function(a, b) {
    var t = this, acta = null, actb = null, p1, p2, r;
    if (t.objIsActor(a)) acta = t.getActor(a);
    if (t.objIsActor(b)) actb = t.getActor(b);
    if (acta && actb && acta.room == actb.room && acta.room && !acta.isInCurrentRoom())
      return 0;
    p1 = t.getObjectOrActorXY(a);
    if (!p1) return 0xFF;
    p2 = t.getObjectOrActorXY(b);
    if (!p2) return 0xFF;
    // an actor measures to the nearest point it could actually walk to
    if (acta && !actb) {
      r = acta.adjustXYToBeInBox(p2.x, p2.y);
      p2 = {x: r.x, y: r.y};
    }
    return t.getDist(p1.x, p1.y, p2.x, p2.y);
  };

  // actor.cpp getActorFromPos. ScummVM tests per-strip "gfx usage" bits
  // recording which actors drew where; this uses each actor's last drawn
  // extent instead.
  s.getActorFromPos = function(x, y) {
    var t = this, i, a;
    for (i = 1; i < t._nums['actors']; i++) {
      a = t._actors[i];
      if (!a || !a.visible || !a.isInCurrentRoom()) continue;
      if (a.drawLeft === undefined || x < a.drawLeft || x >= a.drawRight) continue;
      if (t.getClass(i, kObjectClassUntouchable)) continue;
      if (y >= a.top && y <= a.bottom) return i;
    }
    return 0;
  };

  s.getObjX = function(obj) {
    var t = this, p;
    if (obj < 1) return 0;
    if (t.objIsActor(obj)) return t.getActor(obj).pos.x;
    if (t.whereIsObject(obj) == WIO_NOT_FOUND) return -1;
    p = t.getObjectOrActorXY(obj);
    return p ? p.x : -1;
  };

  s.getObjY = function(obj) {
    var t = this, p;
    if (obj < 1) return 0;
    if (t.objIsActor(obj)) return t.getActor(obj).pos.y;
    if (t.whereIsObject(obj) == WIO_NOT_FOUND) return -1;
    p = t.getObjectOrActorXY(obj);
    return p ? p.y : -1;
  };


  /* --- inventory, ported from ScummVM's object.cpp ---------------------- */

  s.getInventoryCount = function(owner) {
    var t = this, i, obj, count = 0;
    for (i = 0; i < t._nums['inventory']; i++) {
      obj = t._inventory[i];
      if (obj && t.getOwner(obj) == owner) count++;
    }
    return count;
  };

  s.getFreeInventorySlot = function() {
    var t = this, i;
    for (i = 0; i < t._nums['inventory']; i++)
      if (!t._inventory[i]) return i;
    error("Inventory full, " + t._nums['inventory'] + " max items");
    return -1;
  };

  // object.cpp addObjectToInventory: the object's OBCD -- its name and verb
  // scripts -- is copied out of the room, so it still works after leaving
  s.addObjectToInventory = function(obj, room) {
    var t = this, MKID_BE = ScummVM.system.MKID_BE, src = null, abs = 0, size, slot,
        roomptr, searchptr, cdhd, i, loc;

    if (t.whereIsObject(obj) == WIO_FLOBJECT) {
      loc = t.getOBCDAddress(obj);
      if (loc) { src = loc.res; abs = loc.abs; }
    } else {
      roomptr = t.getResourceAddress("room", room);
      if (roomptr) {
        searchptr = roomptr.newAbsoluteStream(8);
        while (searchptr.findNext(MKID_BE('OBCD'))) {
          cdhd = t.findResourceData(MKID_BE('CDHD'), searchptr.newRelativeStream(-8));
          if (cdhd && cdhd.readUI16() == obj) {
            src = roomptr;
            abs = searchptr.offset - 8;
            break;
          }
          searchptr.seek(-8);
          searchptr.seek(searchptr.newRelativeStream(4).readUI32(true));
        }
      }
    }
    if (!src) {
      error("addObjectToInventory: object " + obj + " not found in room " + room);
      return;
    }

    size = src.newAbsoluteStream(abs + 4).readUI32(true);
    slot = t.getFreeInventorySlot();
    if (slot < 0) return;
    t._inventory[slot] = obj;
    t._res.types["inventory"].address[slot] = src.newStream(abs, size);
  };

  // object.cpp clearOwnerOf
  s.clearOwnerOf = function(obj) {
    var t = this, i, inv = t._res.types["inventory"].address;

    t.stopObjectScript(obj);

    if (t.getOwner(obj) == OF_OWNER_ROOM) {
      for (i = 0; i < t._nums['local_objects']; i++) {
        if (t._objs[i] && t._objs[i].obj_nr == obj && t._objs[i].fl_object_index) {
          t._res.nukeResource("fl_object", t._objs[i].fl_object_index);
          t._objs[i].obj_nr = 0;
          t._objs[i].fl_object_index = 0;
        }
      }
    } else {
      for (i = 0; i < t._nums['inventory']; i++) {
        if (t._inventory[i] == obj) {
          t._res.nukeResource("inventory", i);
          t._inventory[i] = 0;
          // close the gap, so the items keep their order on screen
          for (i = 0; i < t._nums['inventory'] - 1; i++) {
            if (!t._inventory[i] && t._inventory[i + 1]) {
              t._inventory[i] = t._inventory[i + 1];
              t._inventory[i + 1] = 0;
              inv[i] = inv[i + 1];
              inv[i + 1] = null;
            }
          }
          break;
        }
      }
    }
  };

  // object.cpp setOwnerOf
  s.setOwnerOf = function(obj, owner) {
    var t = this;
    if (owner == 0) t.clearOwnerOf(obj);
    t.putOwner(obj, owner);
    t.runInventoryScript(0);
  };

  // object.cpp putClass
  s.putClass = function(obj, cls, set) {
    var t = this;
    cls &= 0x7F;
    if (cls < 1 || cls > 32) return;
    if (set) t._classData[obj] |= (1 << (cls - 1));
    else t._classData[obj] &= ~(1 << (cls - 1));
  };

  s.findInventory = function(owner, idx) {
    var t = this, i, obj, count = 1;
    for (i = 0; i < t._nums['inventory']; i++) {
      obj = t._inventory[i];
      if (obj && t.getOwner(obj) == owner && count++ == idx) return obj;
    }
    return 0;
  };

  s.getOwner = function(obj) {
    var t = this;
    return t._objectOwnerTable[obj];
  };

  s.putOwner = function(obj, owner) {
    var t = this;
    t._objectOwnerTable[obj] = owner;
  };

  s.getState = function(obj) {
    var t = this;
    return t._objectStateTable[obj];
  };

  s.putState = function(obj, state) {
    var t = this;
    t._objectStateTable[obj] = state;
  };

  // object.cpp getObjOrActorName
  s.getObjOrActorName = function(obj) {
    var t = this, i, loc, ptr, total, cur, tag, size, MKID_BE = ScummVM.system.MKID_BE;

    if(obj < t._nums['actors'])
      return t.getResourceMessage("actor_name", obj);

    for(i = 0; i < t._nums['new_names']; i++) {
      if(t._newNames[i] == obj)
        return t.getResourceMessage("object_name", i);
    }

    loc = t.getOBCDAddress(obj);
    if(!loc) return null;
    ptr = loc.res.newAbsoluteStream(loc.abs + 4);
    total = ptr.readUI32(true);
    cur = t._resourceHeaderSize;
    while(cur < total) {
      ptr.seek(loc.abs + cur, true);
      tag = ptr.readUI32(true);
      size = ptr.readUI32(true);
      if(size <= t._resourceHeaderSize) return null;
      if(tag == MKID_BE('OBNA')) return t.readMessage(ptr);
      cur += size;
    }
    return null;
  };

  // object.cpp setObjectName
  s.setObjectName = function(obj) {
    var t = this, i;

    if(obj < t._nums['actors']) {
      error("Can't set actor " + obj + " name with new-name-of");
      return;
    }
    for(i = 0; i < t._nums['new_names']; i++) {
      if(t._newNames[i] == obj) {
        t._res.nukeResource("object_name", i);
        t._newNames[i] = 0;
        break;
      }
    }
    for(i = 0; i < t._nums['new_names']; i++) {
      if(!t._newNames[i]) {
        t.loadPtrToResource("object_name", i, null);
        t._newNames[i] = obj;
        t.runInventoryScript(0);
        return;
      }
    }
    error("New name of " + obj + " overflows name table");
  };

}());
