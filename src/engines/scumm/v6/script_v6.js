/*
 * The opcodes of SCUMM v6 (Day of the Tentacle, Sam & Max), ported from
 * ScummVM's engines/scumm/script_v6.cpp: a stack machine in place of v5's
 * parameters in the code. Operands are pushed on one global stack
 * (_vmStack) and each opcode pops what it needs; lists ("[a, b, c]") are
 * pushed item by item with their count on top (getStackList).
 *
 * Left out, as in the brief: the HE, Sam & Max-only, Mac/FM-Towns and
 * enhancement-menu paths, and ScummVM's debugger.
 *
 * Also here, as v6 methods (applyVersion), the shared engine functions v6
 * does its own way: room objects' code headers and hotspots, string
 * arrays in messages, setOwnerOf, saving arrays, and actors' v6 extras.
 */
(function() {
  "use strict";

  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM,
      MKID_BE = _system.MKID_BE;

  var kStringArray = 4, kIntArray = 5, kBitArray = 1, kNibbleArray = 2, kByteArray = 3;
  var MF_TURN = 4, MF_FROZEN = 0x80;
  var kBoxPlayerOnly = 0x20, kBoxInvisible = 0x80;
  var STACK_SIZE = 150;

  // scumm_v6.h SubOpType
  var SO_AT = 65, SO_COLOR = 66, SO_CLIPPED = 67, SO_CENTER = 69, SO_LEFT = 71,
      SO_OVERHEAD = 72, SO_MUMBLE = 74, SO_TEXTSTRING = 75,
      SO_COSTUME = 76, SO_STEP_DIST = 77, SO_SOUND = 78, SO_WALK_ANIMATION = 79,
      SO_TALK_ANIMATION = 80, SO_STAND_ANIMATION = 81, SO_ANIMATION = 82,
      SO_DEFAULT = 83, SO_ELEVATION = 84, SO_ANIMATION_DEFAULT = 85, SO_PALETTE = 86,
      SO_TALK_COLOR = 87, SO_ACTOR_NAME = 88, SO_INIT_ANIMATION = 89,
      SO_ACTOR_WIDTH = 91, SO_SCALE = 92, SO_NEVER_ZCLIP = 93, SO_ALWAYS_ZCLIP = 94,
      SO_IGNORE_BOXES = 95, SO_FOLLOW_BOXES = 96, SO_ANIMATION_SPEED = 97,
      SO_SHADOW = 98, SO_TEXT_OFFSET = 99,
      SO_LOAD_SCRIPT = 100, SO_LOAD_SOUND = 101, SO_LOAD_COSTUME = 102,
      SO_LOAD_ROOM = 103, SO_CLEAR_HEAP = 116, SO_LOAD_CHARSET = 117,
      SO_NUKE_CHARSET = 118, SO_LOAD_OBJECT = 119,
      SO_VERB_IMAGE = 124, SO_VERB_NAME = 125, SO_VERB_COLOR = 126,
      SO_VERB_HICOLOR = 127, SO_VERB_AT = 128, SO_VERB_ON = 129, SO_VERB_OFF = 130,
      SO_VERB_DELETE = 131, SO_VERB_NEW = 132, SO_VERB_DIMCOLOR = 133,
      SO_VERB_DIM = 134, SO_VERB_KEY = 135, SO_VERB_CENTER = 136,
      SO_VERB_NAME_STR = 137, SO_VERB_IMAGE_IN_ROOM = 139, SO_VERB_BAKCOLOR = 140,
      SO_SAVE_VERBS = 141, SO_RESTORE_VERBS = 142, SO_DELETE_VERBS = 143,
      SO_CURSOR_ON = 144, SO_CURSOR_OFF = 145, SO_USERPUT_ON = 146,
      SO_USERPUT_OFF = 147, SO_CURSOR_SOFT_ON = 148, SO_CURSOR_SOFT_OFF = 149,
      SO_USERPUT_SOFT_ON = 150, SO_USERPUT_SOFT_OFF = 151, SO_CURSOR_IMAGE = 153,
      SO_CURSOR_HOTSPOT = 154, SO_CHARSET_SET = 156, SO_CHARSET_COLOR = 157,
      SO_RESTART = 158, SO_PAUSE = 159, SO_QUIT = 160,
      SO_WAIT_FOR_ACTOR = 168, SO_WAIT_FOR_MESSAGE = 169, SO_WAIT_FOR_CAMERA = 170,
      SO_WAIT_FOR_SENTENCE = 171, SO_ROOM_SCROLL = 172, SO_ROOM_SCREEN = 174,
      SO_ROOM_PALETTE = 175, SO_ROOM_SHAKE_ON = 176, SO_ROOM_SHAKE_OFF = 177,
      SO_ROOM_INTENSITY = 179, SO_ROOM_SAVEGAME = 180, SO_ROOM_FADE = 181,
      SO_RGB_ROOM_INTENSITY = 182, SO_ROOM_SHADOW = 183, SO_SAVE_STRING = 184,
      SO_LOAD_STRING = 185, SO_ROOM_TRANSFORM = 186, SO_CYCLE_SPEED = 187,
      SO_VERB_INIT = 196, SO_ACTOR_INIT = 197, SO_ACTOR_VARIABLE = 198,
      SO_INT_ARRAY = 199, SO_BIT_ARRAY = 200, SO_NIBBLE_ARRAY = 201,
      SO_BYTE_ARRAY = 202, SO_STRING_ARRAY = 203, SO_UNDIM_ARRAY = 204,
      SO_ASSIGN_STRING = 205, SO_ASSIGN_INT_LIST = 208, SO_ASSIGN_2DIM_LIST = 212,
      SO_ROOM_NEW_PALETTE = 213, SO_CURSOR_TRANSPARENT = 214,
      SO_ACTOR_IGNORE_TURNS_ON = 215, SO_ACTOR_IGNORE_TURNS_OFF = 216, SO_NEW = 217,
      SO_ALWAYS_ZCLIP_FT_DEMO = 225, SO_WAIT_FOR_ANIMATION = 226,
      SO_ACTOR_DEPTH = 227, SO_ACTOR_WALK_SCRIPT = 228, SO_ACTOR_STOP = 229,
      SO_ACTOR_FACE = 230, SO_ACTOR_TURN = 231, SO_WAIT_FOR_TURN = 232,
      SO_ACTOR_WALK_PAUSE = 233, SO_ACTOR_WALK_RESUME = 234,
      SO_ACTOR_TALK_SCRIPT = 235, SO_BASEOP = 254, SO_END = 255;

  function bool(v) { return v ? 1 : 0; }

  // C's int division
  function idiv(a, b) { return Math.trunc(a / b); }

  // _rnd.getRandomNumber(max): 0..max inclusive
  function rnd(max) { return Math.floor(Math.random() * (max + 1)); }

  // actor.cpp derefActor. Actor 0 exists in ScummVM (isValidActor(0)), so
  // it is returned too; a bad number is logged and gives null.
  function derefActor(id, who) {
    var a = s.getActor(id);
    if (!a && id == 0 && s._actors[0]) a = s._actors[0];
    if (!a) log("Invalid actor " + id + " in " + who);
    return a;
  }

  // the same, for opcodes that only read: a stand-in rather than a crash
  var NO_ACTOR = {number: 0, room: 0, moving: 0, walkbox: 0, ignoreBoxes: false, costume: 0,
                  elevation: 0, width: 0, scalex: 0, layer: 0, frame: 0, pos: {x: 0, y: 0},
                  cost: {animCounter: 0}, isInCurrentRoom: function() { return false; }};
  function derefActorRead(id, who) {
    return derefActor(id, who) || NO_ACTOR;
  }

  function breakHere() {
    s.updateScriptPtr();
    s._currentScript = 0xFF;
  }

  function pauseScript(delay) {
    var slot = s._vm.slot[s._currentScript];
    slot.delay = delay;
    slot.status = "paused";
    breakHere();
  }

  // script_v6.cpp popRoomAndObj: v6 pushes the object, then its room
  function popRoomAndObj() {
    var room = s.pop(), obj = s.pop();
    return {room: room, obj: obj};
  }

  // a list popped with getStackList, padded with zeroes to n entries --
  // ScummVM's args[] are zeroed to their size first
  function stackArgs(maxnum, n) {
    var list = s.getStackList(maxnum), args = list.slice(), i;
    for (i = list.length; i < n; i++) args[i] = 0;
    args.num = list.length;
    return args;
  }

  /* --- the stack (script.cpp push/pop, script_v6.cpp getStackList) -------- */

  s.defineVersion("6", {
    push: function(a) {
      var t = this;
      if (!t._vmStack) t._vmStack = [];
      if (t._scummStackPos < 0 || t._scummStackPos >= STACK_SIZE) {
        error("push: stack overflow at " + t._scummStackPos);
        return;
      }
      t._vmStack[t._scummStackPos++] = a;
    },
    pop: function() {
      var t = this;
      if (!t._vmStack || t._scummStackPos < 1 || t._scummStackPos > STACK_SIZE) {
        error("No items on stack to pop() in script " + t.currentScriptNumber());
        t._scummStackPos = 0;
        return 0;
      }
      return t._vmStack[--t._scummStackPos];
    }
  });

  // The items of a list, in the order they were pushed: the count is on top
  // of the stack, the items under it. Returns just the items (length is
  // the count).
  s.getStackList = function(maxnum) {
    var t = this, num = t.pop(), args = [], i;
    if (num > maxnum) {
      error("Too many items " + num + " in stack list, max " + maxnum);
      num = maxnum;
    }
    if (num < 0) num = 0;
    for (i = num - 1; i >= 0; i--) args[i] = t.pop();
    return args;
  };

  /* --- engine functions the opcodes need (object.cpp, script.cpp...) ------ */

  // object.cpp setObjectState: drawObject/drawObjectAt. A position is in
  // 8-pixel strips; v6 has no "clear the others there" pass, unlike o5
  s.setObjectState = function(obj, state, x, y) {
    var t = this, i = t.getObjectIndex(obj);
    if (i == -1) {
      debug(0, "setObjectState: no such object " + obj);
      return;
    }
    if (x != -1 && x != 0x7FFFFFFF) {
      t._objs[i].x_pos = x * 8;
      t._objs[i].y_pos = y * 8;
    }
    t.addObjectToDrawQueue(i);
    t.putState(obj, state);
  };

  // object.cpp ScummEngine_v6::getDistanceBetween: distance scaled by the
  // actors' sizes, -1 if either is not here
  s.getDistanceBetween = function(isObj1, b, c, isObj2, e, f) {
    var t = this, i = 0xFF, j = 0xFF, p1, p2, a;
    if (isObj1) {
      p1 = t.getObjectOrActorXY(b);
      if (!p1) return -1;
      if (b < t._nums['actors']) { a = derefActor(b, "getDistanceBetween_is_obj_1"); if (a) i = a.scalex; }
    } else p1 = {x: b, y: c};
    if (isObj2) {
      p2 = t.getObjectOrActorXY(e);
      if (!p2) return -1;
      if (e < t._nums['actors']) { a = derefActor(e, "getDistanceBetween_is_obj_2"); if (a) j = a.scalex; }
    } else p2 = {x: e, y: f};
    return idiv(t.getDist(p1.x, p1.y, p2.x, p2.y) * 0xFF, idiv(i + j, 2) || 1);
  };

  // script.cpp
  s.killAllScriptsExceptCurrent = function() {
    var t = this, i;
    for (i = 0; i < t._vm.slot.length; i++) {
      if (i != t._currentScript) {
        t._vm.slot[i].status = "dead";
        t._vm.slot[i].cutSceneOverride = 0;
      }
    }
  };

  s.isRoomScriptRunning = function(script) {
    var t = this, i, ss;
    for (i = 0; i < t._vm.slot.length; i++) {
      ss = t._vm.slot[i];
      if (ss.number == script && ss.where == "room" && ss.status != "dead") return true;
    }
    return false;
  };

  // object.cpp nukeFlObjects
  s.nukeFlObjects = function(min, max) {
    var t = this, i, od;
    for (i = 0; i < t._nums['local_objects']; i++) {
      od = t._objs[i];
      if (od && od.fl_object_index && od.obj_nr >= min && od.obj_nr <= max) {
        t._res.nukeResource("fl_object", od.fl_object_index);
        od.obj_nr = 0;
        od.fl_object_index = 0;
      }
    }
  };

  s.findFlObjectSlot = function() {
    var t = this, i, addr = t._res.types["fl_object"].address;
    for (i = 1; i < t._nums['fl_object']; i++)
      if (!addr[i]) return i;
    error("findFlObjectSlot: Out of FLObject slots");
    return -1;
  };

  // object.cpp loadFlObject: a "floating" object -- its OBCD and OBIM
  // copied out of another room into a FLOB of its own, and added to this
  // room's objects
  s.loadFlObject = function(object, room) {
    var t = this, roomptr, sp, obcdAbs = -1, obimAbs = -1, obcdSize, obimSize, flobSize,
        objslot, slot, od, hdr, buf, flob, i, enc;

    if (t.getObjectIndex(object) != -1) return;

    t.ensureResourceLoaded("room", room);
    roomptr = t.getResourceAddress("room", room);
    if (!roomptr) { error("loadFlObject: failed getting room " + room); return; }

    sp = roomptr.newAbsoluteStream(8);
    while (sp.findNext(MKID_BE('OBCD'))) {
      if (t.findResourceData(MKID_BE('CDHD'), sp.newRelativeStream(-8)).readUI16() == object) {
        obcdAbs = sp.offset - 8;
        break;
      }
    }
    sp = roomptr.newAbsoluteStream(8);
    while (sp.findNext(MKID_BE('OBIM'))) {
      if (t.getObjectIdFromOBIM(sp) == object) {
        obimAbs = sp.offset - 8;
        break;
      }
    }
    if (obcdAbs < 0 || obimAbs < 0) {
      error("loadFlObject: object " + object + " not found in room " + room);
      return;
    }

    objslot = t.findLocalObjectSlot();
    if (objslot == -1) { error("loadFlObject: Local Object Table overflow"); return; }
    od = t._objs[objslot];

    obcdSize = roomptr.newAbsoluteStream(obcdAbs + 4).readUI32(true);
    obimSize = roomptr.newAbsoluteStream(obimAbs + 4).readUI32(true);
    od.OBCDoffset = 8;
    od.OBIMoffset = obcdSize + 8;
    flobSize = obcdSize + obimSize + 8;

    slot = t.findFlObjectSlot();
    if (slot < 0) return;

    // the room's bytes are kept as read from the file, so the header is
    // put in the same way
    enc = roomptr.encByte || 0;
    hdr = "FLOB";
    buf = "";
    for (i = 0; i < 4; i++) buf += String.fromCharCode(hdr.charCodeAt(i) ^ enc);
    for (i = 3; i >= 0; i--) buf += String.fromCharCode(((flobSize >>> (i * 8)) & 0xFF) ^ enc);
    buf += roomptr.buffer.substr(obcdAbs, obcdSize) + roomptr.buffer.substr(obimAbs, obimSize);
    flob = new ScummVM.Stream(buf, roomptr.filename || "flobject");
    flob.length = buf.length;
    flob.encByte = enc;
    t._res.types["fl_object"].address[slot] = flob;

    t.resetRoomObject(od, flob, flob);
    od.fl_object_index = slot;
  };

  // palette.cpp
  s.swapPalColors = function(a, b) {
    var t = this, tmp;
    if (a < 0 || a >= 256 || b < 0 || b >= 256) { error("swapPalColors: invalid values, " + a + ", " + b); return; }
    tmp = t._currentPalette[a];
    t._currentPalette[a] = t._currentPalette[b];
    t._currentPalette[b] = tmp;
    t.setDirtyColors(a, a);
    t.setDirtyColors(b, b);
  };

  s.copyPalColor = function(dst, src) {
    var t = this, c;
    if (dst < 0 || dst >= 256 || src < 0 || src >= 256) { error("copyPalColor: invalid values, " + dst + ", " + src); return; }
    c = t._currentPalette[src] || [0, 0, 0];
    t._currentPalette[dst] = [c[0], c[1], c[2]];
    t.setDirtyColors(dst, dst);
  };

  function colorWeight(r, g, b) { return 3 * r * r + 6 * g * g + 2 * b * b; }

  s.remapPaletteColor = function(r, g, b, threshold) {
    var t = this, i, p, ar, ag, ab, sum, bestsum = 0x7FFFFFFF, bestitem = 0;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    r &= ~3; g &= ~3; b &= ~3;
    for (i = 1; i < 255; i++) {
      p = t._currentPalette[i] || [0, 0, 0];
      ar = p[0] & ~3; ag = p[1] & ~3; ab = p[2] & ~3;
      if (ar == r && ag == g && ab == b) return i;
      sum = colorWeight(ar - r, ag - g, ab - b);
      if (sum < bestsum) { bestsum = sum; bestitem = i; }
    }
    if (threshold != -1 && bestsum > colorWeight(threshold, threshold, threshold)) {
      for (i = 254; i > 48; i--) {
        p = t._currentPalette[i] || [0, 0, 0];
        if (p[0] >= 252 && p[1] >= 252 && p[2] >= 252) {
          t.setPalColor(i, r, g, b);
          return i;
        }
      }
    }
    return bestitem;
  };

  // boxes.cpp ScummEngine_v6::getSpecialBox
  s.getSpecialBox = function(x, y) {
    var t = this, i, flag;
    for (i = t.getNumBoxes() - 1; i >= 0; i--) {
      flag = t.getBoxFlags(i);
      if (!(flag & kBoxInvisible) && (flag & kBoxPlayerOnly)) return -1;
      if (t.checkXYInBoxBounds(i, x, y)) return i;
    }
    return -1;
  };

  // script_v6.cpp shuffleArray
  s.shuffleArray = function(num, minIdx, maxIdx) {
    var t = this, range = maxIdx - minIdx, count = range * 2, r1, r2, v1, v2;
    while (count-- > 0) {
      r1 = rnd(range) + minIdx;
      r2 = rnd(range) + minIdx;
      v1 = t.readArray(num, 0, r1);
      v2 = t.readArray(num, 0, r2);
      t.writeArray(num, 0, r1, v2);
      t.writeArray(num, 0, r2, v1);
    }
  };

  // cursor.cpp. The engine draws its own cross-hair; an object's image as
  // the cursor (ScummEngine_v6::setCursorFromImg) is not drawn yet, only
  // remembered, as are the hotspot and transparent colour.
  s.setCursorFromImg = function(img, room, imgindex) {
    this._cursorImg = {img: img, room: room, imgindex: imgindex};
    debug(3, "setCursorFromImg(" + img + ", " + room + ", " + imgindex + ") not drawn");
  };
  s.setCursorHotspot = function(x, y) {
    this._cursorHotspot = {x: x, y: y};
  };
  s.setCursorTransparency = function(a) {
    this._cursorTransparency = a;
  };

  /* --- v6's own versions of shared engine functions ------------------------ */

  s.defineVersion("6", {
    // object.cpp resetRoomObject, v6's code header: position and size in
    // pixels (v5's are strips), no walk-to point (that is the image's
    // hotspot, getObjectXYPos)
    resetRoomObject: function(od, room, searchptr) {
      var t = this, c;
      if (!searchptr) searchptr = room.newAbsoluteStream(0);
      c = t.findResourceData(MKID_BE('CDHD'), searchptr.newAbsoluteStream(od.OBCDoffset));
      if (!c) { error("Room " + t._roomResource + " missing CDHD blocks(s)"); return; }
      od.flags = t._gdi.dbAllowMaskOr;
      od.obj_nr = c.readUI16();
      od.x_pos = c.readSI16();
      od.y_pos = c.readSI16();
      od.width = c.readUI16();
      od.height = c.readUI16();
      var flags = c.readUI8();
      od.parentstate = flags == 0x80 ? 1 : (flags & 0xF);
      od.parent = c.readUI8();
      c.readUI16();   // unk1
      c.readUI16();   // unk2
      od.actordir = c.readUI8();
      od.walk_x = 0;
      od.walk_y = 0;
      od.fl_object_index = 0;
    },

    // object.cpp getObjectXYPos: v6 walks to the hotspot of the image the
    // object's state shows
    getObjectXYPos: function(object) {
      var t = this, idx = t.getObjectIndex(object), od, state, ptr, imhd, pos;
      if (idx < 0) return null;
      od = t._objs[idx];
      if (!od.OBIMoffset && !od.fl_object_index) {
        debug(0, "getObjectXYPos: Can't find object " + object);
        return null;
      }
      state = t.getState(object) - 1;
      if (!(state > 0)) state = 0;
      ptr = t.getOBIMFromObjectData(od);
      if (!ptr) { debug(0, "getObjectXYPos: Can't find object " + object); return null; }
      imhd = t.findResourceData(MKID_BE('IMHD'), ptr);
      if (!imhd) return null;
      // ImageHeader.old: 18 bytes, then 15 hotspots of int16 x, y
      imhd.seek(18 + state * 4);
      pos = _system.Point(od.x_pos + imhd.readSI16(), od.y_pos + imhd.readSI16());
      pos.dir = _system.oldDirToNewDir(od.actordir & 3);
      return pos;
    },

    // object.cpp setOwnerOf: v6 tells the inventory script which object
    // (bugs #52, #1507)
    setOwnerOf: function(obj, owner) {
      var t = this;
      if (owner == 0) t.clearOwnerOf(obj);
      t.putOwner(obj, owner);
      t.runInventoryScript(obj);
    },

    // string.cpp convertStringMessage: v6 names a string array by a
    // variable holding its id
    convertStringMessage: function(v) {
      var t = this;
      v = t.readVar(v);
      if (v) return t.convertMessageToString(t.getStringFromArray(v));
      return "";
    },

    // palette.cpp ScummEngine_v6::palManipulateInit: towards palette resID
    // of the room (getPalettePtr), not three string resources. Assumes
    // getPalettePtr gives a stream positioned at the palette's first byte.
    palManipulateInit: function(resID, start, end, time) {
      var t = this, ptr = t.getPalettePtr(resID, t._roomResource), i, cur;
      if (!ptr) return;
      ptr = ptr.newRelativeStream(start * 3);
      t._palManipStart = start;
      t._palManipEnd = end;
      t._palManipCounter = 0;
      t._palManipPalette = [];
      t._palManipIntermediatePal = [];
      for (i = start; i < end; i++) {
        t._palManipPalette[i] = [ptr.readUI8(), ptr.readUI8(), ptr.readUI8()];
        cur = t._currentPalette[i] || [0, 0, 0];
        t._palManipIntermediatePal[i] = [cur[0] << 8, cur[1] << 8, cur[2] << 8];
      }
      t._palManipCounter = time;
    },

    // saveload: the arrays too (typed arrays do not survive the JSON)
    saveState: function() {
      var t = this, state = t._baseMethods.saveState.call(t), id, a, arrays = {};
      for (id in (t._arrays || {})) {
        a = t._arrays[id];
        if (a) arrays[id] = {type: a.type, dim1: a.dim1, dim2: a.dim2, data: Array.prototype.slice.call(a.data)};
      }
      state.arrays = arrays;
      return state;
    },
    loadState: function(state) {
      var t = this, id, a;
      if (!t._baseMethods.loadState.call(t, state)) return false;
      t._arrays = {};
      for (id in (state.arrays || {})) {
        a = state.arrays[id];
        t._arrays[id] = {type: a.type, dim1: a.dim1, dim2: a.dim2,
                         data: a.type == kIntArray ? Int16Array.from(a.data) : Uint8Array.from(a.data)};
      }
      t._scummStackPos = 0;
      return true;
    },

    // actor.cpp: what a v6 actor has over v5's
    versionActor: function(t) {
      var init = t.initActor, updateDir = t.updateActorDirection, i;
      t.animVariable = [];
      t.sounds = [];
      t.initActor = function(mode) {
        if (mode == -1) for (i = 0; i < 27; i++) t.animVariable[i] = 0;
        init(mode);
        for (i = 0; i < 8; i++) t.sounds[i] = 0;
        t.sound = 0;
        t.animProgress = 0;
      };
      // actor.cpp updateActorDirection: a v6 actor told to ignore turns
      // keeps facing the way it does
      t.updateActorDirection = function(isWalking) {
        if (t.ignoreTurns) return t.facing;
        return updateDir(isWalking);
      };
      t.setElevation = function(e) {
        if (t.elevation != e) {
          t.elevation = e;
          t.needRedraw = true;
        }
      };
      t.setAnimSpeed = function(speed) {
        t.animSpeed = speed & 0xFF;
        t.animProgress = 0;
      };
      t.getAnimVar = function(v) {
        if (v < 0 || v > 26) { error("getAnimVar: " + v + " out of range"); return 0; }
        return t.animVariable[v] || 0;
      };
      t.setAnimVar = function(v, value) {
        if (v < 0 || v > 26) { error("setAnimVar: " + v + " out of range"); return; }
        t.animVariable[v] = value;
      };
    }
  });

  /* --- decodeParseString (script_v6.cpp): one sub-op per print opcode ----- */

  function decodeParseString(m, n) {
    var b = s.fetchScriptByte(), str = s._string[m], len;
    switch (b) {
      case SO_AT:
        str.y = s.pop();
        str.x = s.pop();
        str.overhead = false;
        break;
      case SO_COLOR:
        str.color = s.pop();
        break;
      case SO_CLIPPED:
        str.right = s.pop();
        break;
      case SO_CENTER:
        str.center = true;
        str.overhead = false;
        break;
      case SO_LEFT:
        str.center = false;
        str.overhead = false;
        break;
      case SO_OVERHEAD:
        str.overhead = true;
        str.no_talk_anim = false;
        break;
      case SO_MUMBLE:
        str.no_talk_anim = true;
        break;
      case SO_TEXTSTRING:
        len = s.resStrLen(s._scriptPointer);
        s.printString(m, s.readMessage(s._scriptPointer, len));
        s._scriptPointer.seek(len + 1);
        break;
      case SO_BASEOP:
        str.loadDefault();
        if (n) s._actorToPrintStrFor = s.pop();
        break;
      case SO_END:
        str.saveDefault();
        break;
      default:
        error("decodeParseString: default case 0x" + b.toString(16));
    }
  }

  /* --- the opcodes --------------------------------------------------------- */

  var o6 = s._opcodeCommandsV6 = {
    pushByte: function() { s.push(s.fetchScriptByte()); },
    pushWord: function() { s.push(s.fetchScriptWordSigned()); },
    pushByteVar: function() { s.push(s.readVar(s.fetchScriptByte())); },
    pushWordVar: function() { s.push(s.readVar(s.fetchScriptWord())); },

    byteArrayRead: function() {
      var base = s.pop();
      s.push(s.readArray(s.fetchScriptByte(), 0, base));
    },
    wordArrayRead: function() {
      var base = s.pop();
      s.push(s.readArray(s.fetchScriptWord(), 0, base));
    },
    byteArrayIndexedRead: function() {
      var base = s.pop(), idx = s.pop();
      s.push(s.readArray(s.fetchScriptByte(), idx, base));
    },
    wordArrayIndexedRead: function() {
      var base = s.pop(), idx = s.pop();
      s.push(s.readArray(s.fetchScriptWord(), idx, base));
    },

    dup: function() { var a = s.pop(); s.push(a); s.push(a); },
    not: function() { s.push(bool(s.pop() == 0)); },
    eq: function() { var a = s.pop(), b = s.pop(); s.push(bool(a == b)); },
    neq: function() { var a = s.pop(), b = s.pop(); s.push(bool(a != b)); },
    gt: function() { var a = s.pop(), b = s.pop(); s.push(bool(b > a)); },
    lt: function() { var a = s.pop(); s.push(bool(s.pop() < a)); },
    le: function() { var a = s.pop(); s.push(bool(s.pop() <= a)); },
    ge: function() { var a = s.pop(), b = s.pop(); s.push(bool(b >= a)); },
    add: function() { var a = s.pop(); s.push((s.pop() + a) | 0); },
    sub: function() { var a = s.pop(); s.push((s.pop() - a) | 0); },
    mul: function() { var a = s.pop(); s.push(Math.imul(s.pop(), a)); },
    div: function() {
      var a = s.pop(), b;
      if (a == 0) { error("division by zero"); s.pop(); s.push(0); return; }
      b = s.pop();
      s.push(idiv(b, a));
    },
    land: function() { var a = s.pop(), b = s.pop(); s.push(bool(b && a)); },
    lor: function() { var a = s.pop(), b = s.pop(); s.push(bool(b || a)); },
    bor: function() { var a = s.pop(); s.push(s.pop() | a); },
    band: function() { var a = s.pop(); s.push(s.pop() & a); },
    pop: function() { s.pop(); },
    abs: function() { s.push(Math.abs(s.pop())); },

    writeByteVar: function() { s.writeVar(s.fetchScriptByte(), s.pop()); },
    writeWordVar: function() { s.writeVar(s.fetchScriptWord(), s.pop()); },
    byteArrayWrite: function() {
      var a = s.pop();
      s.writeArray(s.fetchScriptByte(), 0, s.pop(), a);
    },
    wordArrayWrite: function() {
      var a = s.pop();
      s.writeArray(s.fetchScriptWord(), 0, s.pop(), a);
    },
    byteArrayIndexedWrite: function() {
      var val = s.pop(), base = s.pop(), arr = s.fetchScriptByte();
      s.writeArray(arr, s.pop(), base, val);
    },
    wordArrayIndexedWrite: function() {
      var val = s.pop(), base = s.pop(), arr = s.fetchScriptWord();
      s.writeArray(arr, s.pop(), base, val);
    },
    byteVarInc: function() { var v = s.fetchScriptByte(); s.writeVar(v, s.readVar(v) + 1); },
    wordVarInc: function() { var v = s.fetchScriptWord(); s.writeVar(v, s.readVar(v) + 1); },
    byteVarDec: function() { var v = s.fetchScriptByte(); s.writeVar(v, s.readVar(v) - 1); },
    wordVarDec: function() { var v = s.fetchScriptWord(); s.writeVar(v, s.readVar(v) - 1); },
    byteArrayInc: function() {
      var v = s.fetchScriptByte(), base = s.pop();
      s.writeArray(v, 0, base, s.readArray(v, 0, base) + 1);
    },
    wordArrayInc: function() {
      var v = s.fetchScriptWord(), base = s.pop();
      s.writeArray(v, 0, base, s.readArray(v, 0, base) + 1);
    },
    byteArrayDec: function() {
      var v = s.fetchScriptByte(), base = s.pop();
      s.writeArray(v, 0, base, s.readArray(v, 0, base) - 1);
    },
    wordArrayDec: function() {
      var v = s.fetchScriptWord(), base = s.pop();
      s.writeArray(v, 0, base, s.readArray(v, 0, base) - 1);
    },

    // jumps are relative to the end of their offset
    jump: function() {
      var offset = s.fetchScriptWordSigned();
      s._scriptPointer.seek(offset);
    },
    if: function() {
      if (s.pop()) o6.jump();
      else s.fetchScriptWord();
    },
    ifNot: function() {
      if (!s.pop()) o6.jump();
      else s.fetchScriptWord();
    },

    startScript: function() {
      var args = s.getStackList(25), script = s.pop(), flags = s.pop();
      s.runScript(script, (flags & 1) != 0, (flags & 2) != 0, args);
    },
    jumpToScript: function() {
      var args = s.getStackList(25), script = s.pop(), flags = s.pop();
      s.stopObjectCode();
      s.runScript(script, (flags & 1) != 0, (flags & 2) != 0, args);
    },
    startScriptQuick: function() {
      var args = s.getStackList(25), script = s.pop();
      s.runScript(script, 0, 0, args);
    },
    startScriptQuick2: function() {
      var args = s.getStackList(25), script = s.pop();
      s.runScript(script, 0, 1, args);
    },
    startObject: function() {
      var args = s.getStackList(25), entryp = s.pop(), script = s.pop(), flags = s.pop();
      s.runObjectScript(script, entryp, (flags & 1) != 0, (flags & 2) != 0, args, -1);
    },
    startObjectQuick: function() {
      var args = s.getStackList(25), entryp = s.pop(), script = s.pop();
      s.runObjectScript(script, entryp, 0, 1, args, -1);
    },

    drawObject: function() {
      var state = s.pop(), obj = s.pop();
      // based on disassembly (ScummVM)
      if (state == 0) state = 1;
      s.setObjectState(obj, state, -1, -1);
    },
    drawObjectAt: function() {
      var y = s.pop(), x = s.pop(), obj = s.pop();
      s.setObjectState(obj, 1, x, y);
    },
    // Blast objects (BOMP images drawn over the room) are Sam & Max's and
    // v7's; DOTT does not draw them. The operands are taken off the stack.
    drawBlastObject: function() {
      var args = s.getStackList(16), e = s.pop(), d = s.pop(), c = s.pop(), b = s.pop(), a = s.pop();
      log("drawBlastObject(" + [a, b, c, d, e].join(",") + ") not supported");
    },
    setBlastObjectWindow: function() {
      // a no-op in the original too
      s.pop(); s.pop(); s.pop(); s.pop();
    },
    stampObject: function() {
      var state = s.pop(), y = s.pop(), x = s.pop(), object = s.pop(), objnum;
      if (state == 0) state = 1;
      objnum = s.getObjectIndex(object);
      if (objnum == -1) return;
      if (x != -1) {
        s._objs[objnum].x_pos = x * 8;
        s._objs[objnum].y_pos = y * 8;
      }
      s.putState(object, state);
      s.drawObject(objnum, 0);
    },

    stopObjectCode: function() { s.stopObjectCode(); },
    endCutscene: function() { s.endCutscene(); },
    cutscene: function() { s.beginCutscene(stackArgs(25, 25)); },
    stopMusic: function() { s.stopAllSounds(); },
    freezeUnfreeze: function() {
      var a = s.pop();
      if (a) s.freezeScripts(a);
      else s.unfreezeScripts();
    },

    cursorCommand: function() {
      var subOp = s.fetchScriptByte(), a, ro, args, i, cs;
      switch (subOp) {
        case SO_CURSOR_ON: s._cursorState = 1; break;
        case SO_CURSOR_OFF: s._cursorState = 0; break;
        case SO_USERPUT_ON: s._userPut = 1; break;
        case SO_USERPUT_OFF: s._userPut = 0; break;
        case SO_CURSOR_SOFT_ON:
          s._cursorState++;
          if (s._cursorState > 1) error("Cursor state greater than 1 in script");
          break;
        case SO_CURSOR_SOFT_OFF: s._cursorState--; break;
        case SO_USERPUT_SOFT_ON: s._userPut++; break;
        case SO_USERPUT_SOFT_OFF: s._userPut--; break;
        case SO_CURSOR_IMAGE:
          ro = popRoomAndObj();
          s.setCursorFromImg(ro.obj, ro.room, 1);
          break;
        case SO_CURSOR_HOTSPOT:
          a = s.pop();
          s.setCursorHotspot(s.pop(), a);
          break;
        case SO_CHARSET_SET:
          s.initCharset(s.pop());
          break;
        case SO_CHARSET_COLOR:
          args = stackArgs(16, 16);
          cs = s._string[1]._default.charset;
          if (!s._charsetData[cs]) s._charsetData[cs] = [];
          for (i = 0; i < 16; i++)
            s._charsetColorMap[i] = s._charsetData[cs][i] = args[i] & 0xFF;
          break;
        case SO_CURSOR_TRANSPARENT:
          s.setCursorTransparency(s.pop());
          break;
        default:
          error("o6_cursorCommand: default case " + subOp);
      }
      s.scummVar("cursorstate", s._cursorState);
      s.scummVar("userput", s._userPut);
    },

    breakHere: function() { breakHere(); },

    ifClassOfIs: function() {
      var args = s.getStackList(16), num = args.length, obj = s.pop(), cond = 1, cls, b;
      while (--num >= 0) {
        cls = args[num];
        b = s.getClass(obj, cls);
        if (((cls & 0x80) && !b) || (!(cls & 0x80) && b)) cond = 0;
      }
      s.push(cond);
    },
    setClass: function() {
      var args = s.getStackList(16), num = args.length, obj = s.pop(), cls;
      while (--num >= 0) {
        cls = args[num];
        // class 0: ScummVM clears _classData[num] -- the list index, not
        // the object -- and so does this
        if (cls == 0) s._classData[num] = 0;
        else s.putClass(obj, cls, (cls & 0x80) != 0);
      }
    },
    getState: function() { s.push(s.getState(s.pop()) | 0); },
    setState: function() {
      var state = s.pop(), obj = s.pop();
      s.putState(obj, state);
      s.markObjectRectAsDirty(obj);
      if (s._bgNeedsRedraw) s.clearDrawObjectQueue();
    },
    setOwner: function() {
      var owner = s.pop(), obj = s.pop();
      s.setOwnerOf(obj, owner);
    },
    getOwner: function() { s.push(s.getOwner(s.pop()) | 0); },

    startSound: function() { s.startSound(s.pop()); },
    stopSound: function() { s.stopSound(s.pop()); },
    startMusic: function() { s.startSound(s.pop()); },
    stopObjectScript: function() { s.stopObjectScript(s.pop()); },

    panCameraTo: function() { s.panCameraTo(s.pop(), 0); },
    actorFollowCamera: function() { s.actorFollowCamera(s.pop()); },
    setCameraAt: function() { s.setCameraAtEx(s.pop()); },
    loadRoom: function() {
      var room = s.pop();
      s.startScene(room, 0, 0);
      s._fullRedraw = true;
    },
    stopScript: function() {
      var script = s.pop();
      if (script == 0) s.stopObjectCode();
      else s.stopScript(script);
    },

    walkActorToObj: function() {
      var dist = s.pop(), obj = s.pop(), a = derefActor(s.pop(), "o6_walkActorToObj"), a2, wio, p, x, y;
      if (!a) return;
      if (obj >= s._nums['actors']) {
        wio = s.whereIsObject(obj);
        if (wio != WIO_FLOBJECT && wio != WIO_ROOM) return;
        p = s.getObjectXYPos(obj);
        if (p) a.startWalkActor(p.x, p.y, p.dir);
      } else {
        if (!s.isValidActor(obj)) return;
        a2 = derefActor(obj, "o6_walkActorToObj(2)");
        if (!a2 || !a.isInCurrentRoom() || !a2.isInCurrentRoom()) return;
        if (dist == 0) {
          dist = idiv(a2.scalex * a2.width, 0xFF);
          dist += idiv(dist, 2);
        }
        x = a2.getPos().x;
        y = a2.getPos().y;
        if (x < a.getPos().x) x += dist;
        else x -= dist;
        a.startWalkActor(x, y, -1);
      }
    },
    walkActorTo: function() {
      var y = s.pop(), x = s.pop(), a = derefActor(s.pop(), "o6_walkActorTo");
      if (a) a.startWalkActor(x, y, -1);
    },
    putActorAtXY: function() {
      var room = s.pop(), y = s.pop(), x = s.pop(), a = derefActor(s.pop(), "o6_putActorAtXY");
      if (!a) return;
      if (room == 0xFF || room == 0x7FFFFFFF) {
        room = a.room;
      } else {
        if (a.visible && s._currentRoom != room && s.getTalkingActor() == a.number) s.stopTalk();
        if (room != 0) a.room = room;
      }
      a.putActor(x, y, room);
    },
    putActorAtObject: function() {
      var ro = popRoomAndObj(), a = derefActor(s.pop(), "o6_putActorAtObject"), p = null, room = ro.room;
      if (!a) return;
      if (s.whereIsObject(ro.obj) != WIO_NOT_FOUND) p = s.getObjectXYPos(ro.obj);
      if (!p) p = {x: 160, y: 120};
      if (room == 0xFF) room = a.room;
      a.putActor(p.x, p.y, room);
    },
    faceActor: function() {
      var obj = s.pop(), a = derefActor(s.pop(), "o6_faceActor");
      if (a) a.faceToObject(obj);
    },
    animateActor: function() {
      var anim = s.pop(), act = s.pop(), a = s.getActor(act);
      // garbage actor numbers happen (bug #813): ignore them
      if (a) a.animateActor(anim);
    },
    doSentence: function() {
      var objectB = s.pop(), objectA, verb;
      s.pop();   // dummy (always 0 or 130 in Sam & Max)
      objectA = s.pop();
      verb = s.pop();
      s.doSentence(verb, objectA, objectB);
    },
    pickupObject: function() {
      var ro = popRoomAndObj(), obj = ro.obj, room = ro.room, i;
      if (room == 0) room = s._roomResource;
      for (i = 0; i < s._nums['inventory']; i++) {
        if (s._inventory[i] == (obj & 0xFFFF)) {
          s.putOwner(obj, s.scummVar("ego"));
          s.runInventoryScript(obj);
          return;
        }
      }
      s.addObjectToInventory(obj, room);
      s.putOwner(obj, s.scummVar("ego"));
      s.putClass(obj, kObjectClassUntouchable, true);
      s.putState(obj, 1);
      s.markObjectRectAsDirty(obj);
      s.clearDrawObjectQueue();
      s.runInventoryScript(obj);
    },
    loadRoomWithEgo: function() {
      var y = s.pop(), x = s.pop(), ro = popRoomAndObj(), a = derefActor(s.scummVar("ego"), "o6_loadRoomWithEgo");
      if (!a) return;
      a.putActor(0, 0, ro.room);
      s._egoPositioned = false;
      s.scummVar("walkto_obj", ro.obj);
      s.startScene(a.room, a, ro.obj);
      s.scummVar("walkto_obj", 0);
      s._camera.cur.x = s._camera.dest.x = a.getPos().x;
      s.setCameraFollows(a, false);
      s._fullRedraw = true;
      if (x != -1 && x != 0x7FFFFFFF) a.startWalkActor(x, y, -1);
    },

    getRandomNumber: function() {
      var max = s.pop(), r = rnd(0x7FFF);
      r = max + 1 > 0 ? r % (max + 1) : 0;
      s.scummVar("random_nr", r);
      s.push(r);
    },
    getRandomNumberRange: function() {
      var max = s.pop(), min = s.pop(), r = rnd(0x7FFF), range = max - min + 1;
      r = min + (range > 0 ? r % range : 0);
      s.scummVar("random_nr", r);
      s.push(r);
    },
    isScriptRunning: function() { s.push(bool(s.isScriptRunning(s.pop()))); },
    isRoomScriptRunning: function() { s.push(bool(s.isRoomScriptRunning(s.pop()))); },

    getActorMoving: function() { s.push(derefActorRead(s.pop(), "o6_getActorMoving").moving | 0); },
    getActorRoom: function() {
      var act = s.pop(), a;
      // 0 and 255 are asked for by the scripts and answered 0
      if (act == 0 || act == 255) { s.push(0); return; }
      a = s.getActor(act);
      s.push(a ? a.room : 0);
    },
    getActorWalkBox: function() {
      var a = derefActorRead(s.pop(), "o6_getActorWalkBox");
      // v6's "no box" is 0; this port keeps 0xFF internally
      s.push(a.ignoreBoxes || s.isInvalidBox(a.walkbox) ? 0 : a.walkbox);
    },
    getActorCostume: function() { s.push(derefActorRead(s.pop(), "o6_getActorCostume").costume); },
    getActorElevation: function() { s.push(derefActorRead(s.pop(), "o6_getActorElevation").elevation); },
    getActorWidth: function() { s.push(derefActorRead(s.pop(), "o6_getActorWidth").width); },
    getActorScaleX: function() { s.push(derefActorRead(s.pop(), "o6_getActorScaleX").scalex); },
    getActorAnimCounter: function() {
      s.push(derefActorRead(s.pop(), "o6_getActorAnimCounter").cost.animCounter | 0);
    },
    getAnimateVariable: function() {
      var v = s.pop(), a = derefActor(s.pop(), "o6_getAnimateVariable");
      s.push(a && a.getAnimVar ? a.getAnimVar(v) : 0);
    },
    isActorInBox: function() {
      var box = s.pop(), a = derefActorRead(s.pop(), "o6_isActorInBox");
      s.push(bool(s.checkXYInBoxBounds(box, a.pos.x, a.pos.y)));
    },
    getActorLayer: function() { s.push(derefActorRead(s.pop(), "getActorLayer").layer | 0); },

    getObjectX: function() { s.push(s.getObjX(s.pop())); },
    getObjectY: function() { s.push(s.getObjY(s.pop())); },
    getObjectOldDir: function() { s.push(_system.newDirToOldDir(getObjNewDir(s.pop()))); },
    getObjectNewDir: function() { s.push(getObjNewDir(s.pop())); },

    findInventory: function() {
      var idx = s.pop(), owner = s.pop();
      s.push(s.findInventory(owner, idx));
    },
    getInventoryCount: function() { s.push(s.getInventoryCount(s.pop())); },
    getVerbFromXY: function() {
      var y = s.pop(), x = s.pop(), over = s.findVerbAtPos(x, y);
      if (over) over = s._verbs[over].verbid;
      s.push(over);
    },
    beginOverride: function() {
      s.beginOverride();
      s._skipVideo = false;
    },
    endOverride: function() { s.endOverride(); },
    setObjectName: function() { s.setObjectName(s.pop()); },
    isSoundRunning: function() {
      var snd = s.pop();
      if (snd) snd = s.isSoundRunning(snd);
      s.push(snd | 0);
    },
    setBoxFlags: function() {
      var value = s.pop(), table = s.getStackList(65), num = table.length;
      while (--num >= 0) {
        // boxes.cpp setBoxFlags: flags with these bits are kept aside
        if (value & 0xC000) {
          s._extraBoxFlags = s._extraBoxFlags || [];
          s._extraBoxFlags[table[num]] = value;
        } else {
          s.setBoxFlags(table[num], value);
        }
      }
    },
    createBoxMatrix: function() { s.createBoxMatrix(); },

    resourceRoutines: function() {
      var subOp = s.fetchScriptByte(), resid, ro;
      switch (subOp) {
        case SO_LOAD_SCRIPT: s.ensureResourceLoaded("script", s.pop()); break;
        case SO_LOAD_SOUND: s.ensureResourceLoaded("sound", s.pop()); break;
        case SO_LOAD_COSTUME: s.ensureResourceLoaded("costume", s.pop()); break;
        case SO_LOAD_ROOM: s.ensureResourceLoaded("room", s.pop()); break;
        // nuking, locking and unlocking only manage memory, which the
        // browser does for us
        case 104: case 105: case 106: case 107:
        case 108: case 109: case 110: case 111:
        case 112: case 113: case 114: case 115:
          s.pop();
          break;
        case SO_CLEAR_HEAP:
          error("clear heap not working yet");
          break;
        case SO_LOAD_CHARSET:
          s.loadCharset(s.pop());
          break;
        case SO_NUKE_CHARSET:
          s.pop();
          break;
        case SO_LOAD_OBJECT:
          ro = popRoomAndObj();
          s.loadFlObject(ro.obj, ro.room);
          break;
        default:
          error("o6_resourceRoutines: default case " + subOp);
      }
    },

    roomOps: function() {
      var subOp = s.fetchScriptByte(), a, b, c, d, e, half = Math.floor(s._screenWidth / 2);
      switch (subOp) {
        case SO_ROOM_SCROLL:
          b = s.pop();
          a = s.pop();
          if (a < half) a = half;
          if (b < half) b = half;
          if (a > s._roomWidth - half) a = s._roomWidth - half;
          if (b > s._roomWidth - half) b = s._roomWidth - half;
          s.scummVar("camera_min_x", a);
          s.scummVar("camera_max_x", b);
          break;
        case SO_ROOM_SCREEN:
          b = s.pop();
          a = s.pop();
          s.initScreens(a, b);
          break;
        case SO_ROOM_PALETTE:
          d = s.pop(); c = s.pop(); b = s.pop(); a = s.pop();
          s.setPalColor(d, a, b, c);
          break;
        case SO_ROOM_SHAKE_ON: s.setShake(1); break;
        case SO_ROOM_SHAKE_OFF: s.setShake(0); break;
        case SO_ROOM_INTENSITY:
          c = s.pop(); b = s.pop(); a = s.pop();
          s.darkenPalette(a, a, a, b, c);
          break;
        case SO_ROOM_SAVEGAME:
          // ScummVM saves or loads at the end of the frame
          // (scummLoop_handleSaveLoad); not done here yet
          s._saveTemporaryState = true;
          s._saveLoadSlot = s.pop();
          s._saveLoadFlag = s.pop();
          if (s._game == "tentacle") s._saveSound = s._saveLoadSlot != 0;
          log("roomOps savegame: flag " + s._saveLoadFlag + " slot " + s._saveLoadSlot + " not supported");
          s._saveLoadFlag = 0;
          break;
        case SO_ROOM_FADE:
          a = s.pop();
          if (a) {
            s._switchRoomEffect = a & 0xFF;
            s._switchRoomEffect2 = (a >> 8) & 0xFF;
          } else {
            s.fadeIn(s._newEffect);
          }
          break;
        case SO_RGB_ROOM_INTENSITY:
          e = s.pop(); d = s.pop(); c = s.pop(); b = s.pop(); a = s.pop();
          s.darkenPalette(a, b, c, d, e);
          break;
        case SO_ROOM_SHADOW:
          e = s.pop(); d = s.pop(); c = s.pop(); b = s.pop(); a = s.pop();
          s.setShadowPalette(a, b, c, d, e, 0, 256);
          break;
        case SO_SAVE_STRING:
          error("save string not implemented");
          break;
        case SO_LOAD_STRING:
          error("load string not implemented");
          break;
        case SO_ROOM_TRANSFORM:
          d = s.pop(); c = s.pop(); b = s.pop(); a = s.pop();
          s.palManipulateInit(a, b, c, d);
          break;
        case SO_CYCLE_SPEED:
          b = s.pop();
          a = s.pop();
          if (a >= 1 && a <= 16 && s._colorCycle[a - 1])
            s._colorCycle[a - 1].delay = b != 0 ? Math.floor(0x4000 / (b * 0x4C)) : 0;
          else error("o6_roomOps: 187: color cycle " + a + " out of range");
          break;
        case SO_ROOM_NEW_PALETTE:
          s.setCurrentPalette(s.pop());
          break;
        default:
          error("o6_roomOps: default case " + subOp);
      }
    },

    actorOps: function() {
      var subOp = s.fetchScriptByte(), a, i, j, args;
      if (subOp == SO_ACTOR_INIT) {
        s._curActor = s.pop() & 0xFF;
        return;
      }
      a = s.getActor(s._curActor) || (s._curActor == 0 ? s._actors[0] : null);
      if (!a) {
        log("o6_actorOps: invalid actor " + s._curActor);
        // its operands still have to come off the stack
        a = null;
      }
      switch (subOp) {
        case SO_COSTUME: i = s.pop(); if (a) a.setActorCostume(i); break;
        case SO_STEP_DIST: j = s.pop(); i = s.pop(); if (a) a.setActorWalkSpeed(i, j); break;
        case SO_SOUND:
          args = s.getStackList(8);
          if (a) {
            a.sounds = a.sounds || [];
            for (i = 0; i < args.length; i++) a.sounds[i] = args[i];
            // costume.js playActorSounds plays this one
            a.sound = a.sounds[0] || 0;
          }
          break;
        case SO_WALK_ANIMATION: i = s.pop(); if (a) a.walkFrame = i; break;
        case SO_TALK_ANIMATION:
          j = s.pop(); i = s.pop();
          if (a) { a.talkStopFrame = j; a.talkStartFrame = i; }
          break;
        case SO_STAND_ANIMATION: i = s.pop(); if (a) a.standFrame = i; break;
        case SO_ANIMATION:
          // a dummy in v6
          s.pop(); s.pop(); s.pop();
          break;
        case SO_DEFAULT: if (a) a.initActor(0); break;
        case SO_ELEVATION:
          i = s.pop();
          if (a) {
            if (a.setElevation) a.setElevation(i);
            else if (a.elevation != i) { a.elevation = i; a.needRedraw = true; }
          }
          break;
        case SO_ANIMATION_DEFAULT:
          if (a) {
            a.initFrame = 1;
            a.walkFrame = 2;
            a.standFrame = 3;
            a.talkStartFrame = 4;
            a.talkStopFrame = 5;
          }
          break;
        case SO_PALETTE:
          j = s.pop(); i = s.pop();
          if (i < 0 || i > 255) { error("o6_actorOps: palette slot " + i); break; }
          if (a) a.setPalette(i, j);
          break;
        case SO_TALK_COLOR: i = s.pop(); if (a) a.talkColor = i; break;
        case SO_ACTOR_NAME:
          // the name follows in the script, read even without an actor
          s.loadPtrToResource("actor_name", a ? a.number : 0, null);
          break;
        case SO_INIT_ANIMATION: i = s.pop(); if (a) a.initFrame = i; break;
        case SO_ACTOR_WIDTH: i = s.pop(); if (a) a.width = i; break;
        case SO_SCALE: i = s.pop(); if (a) a.setScale(i, i); break;
        case SO_NEVER_ZCLIP: if (a) a.forceClip = 0; break;
        case SO_ALWAYS_ZCLIP_FT_DEMO:
        case SO_ALWAYS_ZCLIP: i = s.pop(); if (a) a.forceClip = i; break;
        case SO_IGNORE_BOXES:
        case SO_FOLLOW_BOXES:
          if (a) {
            a.ignoreBoxes = subOp == SO_IGNORE_BOXES;
            a.forceClip = 0;
            if (a.isInCurrentRoom()) a.putActor();
          }
          break;
        case SO_ANIMATION_SPEED:
          i = s.pop();
          if (a) {
            if (a.setAnimSpeed) a.setAnimSpeed(i);
            else { a.animSpeed = i; a.animProgress = 0; }
          }
          break;
        case SO_SHADOW: i = s.pop(); if (a) a.shadow_mode = i; break;
        case SO_TEXT_OFFSET:
          j = s.pop(); i = s.pop();
          if (a) { a.talkPosY = j; a.talkPosX = i; }
          break;
        case SO_ACTOR_VARIABLE:
          i = s.pop(); j = s.pop();
          if (a && a.setAnimVar) a.setAnimVar(j, i);
          break;
        case SO_ACTOR_IGNORE_TURNS_ON: if (a) a.ignoreTurns = true; break;
        case SO_ACTOR_IGNORE_TURNS_OFF: if (a) a.ignoreTurns = false; break;
        case SO_NEW: if (a) a.initActor(2); break;
        case SO_ACTOR_DEPTH: i = s.pop(); if (a) a.layer = i; break;
        case SO_ACTOR_WALK_SCRIPT: i = s.pop(); if (a) a.walkScript = i; break;
        case SO_ACTOR_STOP:
          if (a) {
            a.stopActorMoving();
            a.startAnimActor(a.standFrame);
          }
          break;
        case SO_ACTOR_FACE:
          j = s.pop();
          if (a) {
            a.moving &= ~MF_TURN;
            a.turnToDirection(j);
            a.setDirection(j);
          }
          break;
        case SO_ACTOR_TURN: i = s.pop(); if (a) a.turnToDirection(i); break;
        case SO_ACTOR_WALK_PAUSE: if (a) a.moving |= MF_FROZEN; break;
        case SO_ACTOR_WALK_RESUME: if (a) a.moving &= ~MF_FROZEN; break;
        case SO_ACTOR_TALK_SCRIPT: i = s.pop(); if (a) a.talkScript = i; break;
        default:
          error("o6_actorOps: default case " + subOp);
      }
    },

    verbOps: function() {
      var subOp = s.fetchScriptByte(), slot, vs, a, b;
      if (subOp == SO_VERB_INIT) {
        s._curVerb = s.pop();
        s._curVerbSlot = s.getVerbSlot(s._curVerb, 0);
        if (s._curVerbSlot < 0 || s._curVerbSlot >= s._nums['verbs'])
          error("new verb slot " + s._curVerbSlot + " out of range");
        return;
      }
      slot = s._curVerbSlot | 0;
      vs = s._verbs[slot];
      switch (subOp) {
        case SO_VERB_IMAGE:
          a = s.pop();
          if (slot) {
            s.setVerbObject(s._roomResource, a, slot);
            vs.type = kImageVerbType;
          }
          break;
        case SO_VERB_NAME:
          s.loadPtrToResource("verb", slot, null);
          vs.text = s.getVerbText(slot);
          vs.type = kTextVerbType;
          vs.imgindex = 0;
          break;
        case SO_VERB_COLOR: vs.color = s.pop(); break;
        case SO_VERB_HICOLOR: vs.hicolor = s.pop(); break;
        case SO_VERB_AT:
          vs.curRect.top = s.pop();
          vs.curRect.left = vs.origLeft = s.pop();
          break;
        case SO_VERB_ON: vs.curmode = 1; break;
        case SO_VERB_OFF: vs.curmode = 0; break;
        case SO_VERB_DELETE: s.killVerb(slot); break;
        case SO_VERB_NEW:
          slot = s.getVerbSlot(s._curVerb, 0);
          if (slot == 0) {
            for (slot = 1; slot < s._nums['verbs']; slot++)
              if (s._verbs[slot].verbid == 0) break;
            if (slot == s._nums['verbs']) { error("Too many verbs"); return; }
            s._curVerbSlot = slot;
          }
          vs = s._verbs[slot];
          vs.verbid = s._curVerb;
          vs.color = 2;
          vs.hicolor = 0;
          vs.dimcolor = 8;
          vs.type = kTextVerbType;
          vs.charset_nr = s._string[0]._default.charset;
          vs.curmode = 0;
          vs.saveid = 0;
          vs.key = 0;
          vs.center = false;
          vs.imgindex = 0;
          vs.text = "";
          break;
        case SO_VERB_DIMCOLOR: vs.dimcolor = s.pop(); break;
        case SO_VERB_DIM: vs.curmode = 2; break;
        case SO_VERB_KEY: vs.key = s.pop(); break;
        case SO_VERB_CENTER: vs.center = true; break;
        case SO_VERB_NAME_STR:
          // the name from a string array, by its id
          a = s.pop();
          s._res.nukeResource("verb", slot);
          s._res.createStringResource("verb", slot, a == 0 ? "" : s.getStringFromArray(a));
          vs.text = s.getVerbText(slot);
          vs.type = kTextVerbType;
          vs.imgindex = 0;
          break;
        case SO_VERB_IMAGE_IN_ROOM:
          b = s.pop();
          a = s.pop();
          if (slot && a != vs.imgindex) {
            s.setVerbObject(b, a, slot);
            vs.type = kImageVerbType;
            vs.imgindex = a;
          }
          break;
        case SO_VERB_BAKCOLOR: vs.bkcolor = s.pop(); break;
        case SO_END:
          // drawVerb: verbs.js draws every verb each frame; the rect is
          // what has to be right now, for clicks
          s.setVerbRect(vs);
          break;
        default:
          error("o6_verbops: default case " + subOp);
      }
    },

    getActorFromXY: function() {
      var y = s.pop(), x = s.pop();
      s.push(s.getActorFromPos(x, y));
    },
    findObject: function() {
      var y = s.pop(), x = s.pop();
      s.push(s.findObject(x, y));
    },
    pseudoRoom: function() {
      var list = s.getStackList(100), num = list.length, value = s.pop(), a;
      s._resourceMapper = s._resourceMapper || [];
      while (--num >= 0) {
        a = list[num];
        if (a > 0x7F) s._resourceMapper[a & 0x7F] = value;
      }
    },
    getVerbEntrypoint: function() {
      var e = s.pop(), v = s.pop();
      s.push(s.getVerbEntryPoint(v, e));
    },

    arrayOps: function() {
      var subOp = s.fetchScriptByte(), array = s.fetchScriptWord(), b, c, d, len, list, data, r, i;
      switch (subOp) {
        case SO_ASSIGN_STRING:
          b = s.pop();
          len = s.resStrLen(s._scriptPointer);
          data = s.defineArray(array, kStringArray, 0, len + 1).data;
          // copyScriptString: the string with its terminator, then a 0
          r = s._scriptPointer.newRelativeStream(0);
          for (i = 0; i < len + 1; i++) {
            c = r.readUI8();
            if (b + i < data.length) data[b + i] = c;
          }
          if (b + len + 1 < data.length) data[b + len + 1] = 0;
          s._scriptPointer.seek(len + 1);
          break;
        case SO_ASSIGN_INT_LIST:
          b = s.pop();
          c = s.pop();
          d = s.readVar(array);
          if (d == 0) s.defineArray(array, kIntArray, 0, b + c);
          while (c-- > 0) s.writeArray(array, 0, b + c, s.pop());
          break;
        case SO_ASSIGN_2DIM_LIST:
          b = s.pop();
          list = s.getStackList(128);
          len = list.length;
          d = s.readVar(array);
          if (d == 0) error("Must DIM a two dimensional array before assigning");
          c = s.pop();
          while (--len >= 0) s.writeArray(array, c, b + len, list[len]);
          break;
        default:
          error("o6_arrayOps: default case " + subOp + " (array " + array + ")");
      }
    },

    saveRestoreVerbs: function() {
      var c = s.pop(), b = s.pop(), a = s.pop(), subOp = s.fetchScriptByte(), slot, slot2;
      switch (subOp) {
        case SO_SAVE_VERBS:
          for (; a <= b; a++) {
            slot = s.getVerbSlot(a, 0);
            if (slot && s._verbs[slot].saveid == 0) s._verbs[slot].saveid = c;
          }
          break;
        case SO_RESTORE_VERBS:
          for (; a <= b; a++) {
            slot = s.getVerbSlot(a, c);
            if (slot) {
              slot2 = s.getVerbSlot(a, 0);
              if (slot2) s.killVerb(slot2);
              slot = s.getVerbSlot(a, c);
              s._verbs[slot].saveid = 0;
            }
          }
          break;
        case SO_DELETE_VERBS:
          for (; a <= b; a++) {
            slot = s.getVerbSlot(a, c);
            if (slot) s.killVerb(slot);
          }
          break;
        default:
          error("o6_saveRestoreVerbs: default case " + subOp);
      }
    },

    drawBox: function() {
      var color = s.pop(), y2 = s.pop(), x2 = s.pop(), y = s.pop(), x = s.pop();
      s.drawBox(x, y, x2, y2, color);
    },

    // waiting goes back over the opcode (and its jump offset) and breaks,
    // so it is tried again next frame
    wait: function() {
      var subOp = s.fetchScriptByte(), offs = -2, a, actnum;
      switch (subOp) {
        case SO_WAIT_FOR_ACTOR:
          offs = s.fetchScriptWordSigned();
          a = derefActor(s.pop(), "o6_wait:168");
          if (a && a.moving) break;
          return;
        case SO_WAIT_FOR_MESSAGE:
          if (s.scummVar("have_msg")) break;
          return;
        case SO_WAIT_FOR_CAMERA:
          if (Math.floor(s._camera.cur.x / 8) != Math.floor(s._camera.dest.x / 8)) break;
          return;
        case SO_WAIT_FOR_SENTENCE:
          if (s._sentenceNum) {
            if (s._sentence[s._sentenceNum - 1].freezeCount && !s.isScriptInUse(s.scummVar("sentence_script")))
              return;
            break;
          }
          if (!s.isScriptInUse(s.scummVar("sentence_script"))) return;
          break;
        case SO_WAIT_FOR_ANIMATION:
          offs = s.fetchScriptWordSigned();
          a = derefActor(s.pop(), "o6_wait:226");
          if (a && a.isInCurrentRoom() && a.needRedraw) break;
          return;
        case SO_WAIT_FOR_TURN:
          offs = s.fetchScriptWordSigned();
          actnum = s.pop();
          // The Dig passes an angle by mistake (bug #819)
          if (actnum % 45 == 0) actnum = s._curActor;
          a = derefActor(actnum, "o6_wait:232b");
          if (a && a.isInCurrentRoom() && (a.moving & MF_TURN)) break;
          return;
        default:
          error("o6_wait: default case 0x" + subOp.toString(16));
          return;
      }
      s._scriptPointer.seek(offs);
      breakHere();
    },

    soundKludge: function() {
      s.soundKludge(s.getStackList(16));
    },
    isAnyOf: function() {
      var list = s.getStackList(100), num = list.length, val = s.pop();
      while (--num >= 0) {
        if (list[num] == val) { s.push(1); return; }
      }
      s.push(0);
    },
    systemOps: function() {
      var subOp = s.fetchScriptByte();
      switch (subOp) {
        case SO_RESTART:
          if (s.restart) s.restart();
          else log("o6_systemOps: restart not supported");
          break;
        case SO_PAUSE:
          s._paused = true;
          break;
        case SO_QUIT:
          log("o6_systemOps: the game quits");
          s._shouldQuit = true;
          break;
        default:
          error("o6_systemOps invalid case " + subOp);
      }
    },

    delay: function() { pauseScript(s.pop() & 0xFFFF); },
    delaySeconds: function() { pauseScript((s.pop() >>> 0) * 60); },
    delayMinutes: function() { pauseScript((s.pop() & 0xFFFF) * 3600); },
    delayFrames: function() {
      var ss = s._vm.slot[s._currentScript];
      if (ss.delayFrameCount == 0) ss.delayFrameCount = s.pop();
      else ss.delayFrameCount--;
      if (ss.delayFrameCount) {
        s._scriptPointer.seek(-1);
        breakHere();
      }
    },
    stopSentence: function() {
      s._sentenceNum = 0;
      s.stopScript(s.scummVar("sentence_script"));
      s.clearClickedStatus();
    },

    printLine: function() {
      s._actorToPrintStrFor = 0xFF;
      decodeParseString(0, 0);
    },
    printText: function() { decodeParseString(1, 0); },
    printDebug: function() { decodeParseString(2, 0); },
    printSystem: function() { decodeParseString(3, 0); },
    printActor: function() { decodeParseString(0, 1); },
    printEgo: function() {
      s.push(s.scummVar("ego"));
      decodeParseString(0, 1);
    },
    talkActor: function() {
      var len;
      s._actorToPrintStrFor = s.pop();
      s._string[0].loadDefault();
      len = s.resStrLen(s._scriptPointer);
      s.actorTalk(s.readMessage(s._scriptPointer, len));
      s._scriptPointer.seek(len + 1);
    },
    talkEgo: function() {
      s.push(s.scummVar("ego"));
      o6.talkActor();
    },

    dimArray: function() {
      var subOp = s.fetchScriptByte(), type, arr;
      switch (subOp) {
        case SO_INT_ARRAY: type = kIntArray; break;
        case SO_BIT_ARRAY: type = kBitArray; break;
        case SO_NIBBLE_ARRAY: type = kNibbleArray; break;
        case SO_BYTE_ARRAY: type = kByteArray; break;
        case SO_STRING_ARRAY: type = kStringArray; break;
        case SO_UNDIM_ARRAY:
          s.nukeArray(s.fetchScriptWord());
          return;
        default:
          error("o6_dimArray: default case " + subOp);
          return;
      }
      arr = s.fetchScriptWord();
      s.defineArray(arr, type, 0, s.pop());
    },
    dim2dimArray: function() {
      var subOp = s.fetchScriptByte(), type, a, b;
      switch (subOp) {
        case SO_INT_ARRAY: type = kIntArray; break;
        case SO_BIT_ARRAY: type = kBitArray; break;
        case SO_NIBBLE_ARRAY: type = kNibbleArray; break;
        case SO_BYTE_ARRAY: type = kByteArray; break;
        case SO_STRING_ARRAY: type = kStringArray; break;
        default:
          error("o6_dim2dimArray: default case " + subOp);
          return;
      }
      b = s.pop();
      a = s.pop();
      s.defineArray(s.fetchScriptWord(), type, a, b);
    },
    dummy: function() {},

    distObjectObject: function() {
      var b = s.pop(), a = s.pop();
      s.push(s.getDistanceBetween(true, a, 0, true, b, 0));
    },
    distObjectPt: function() {
      var c = s.pop(), b = s.pop(), a = s.pop();
      s.push(s.getDistanceBetween(true, a, 0, false, b, c));
    },
    distPtPt: function() {
      var d = s.pop(), c = s.pop(), b = s.pop(), a = s.pop();
      s.push(s.getDistanceBetween(false, a, b, false, c, d));
    },

    // the "kludge" opcodes: the engine's own functions, by number
    kernelSetFunctions: function() {
      var args = stackArgs(30, 30), num = args.num, a, i, im;
      switch (args[0]) {
        case 3:
          break;   // dummy
        case 4:
          log("o6_kernelSetFunctions: grabCursor not supported");
          break;
        case 5:
          s.fadeOut(args[1]);
          break;
        case 6:
          s._fullRedraw = true;
          s.redrawBGAreas();
          for (i = 1; i < s._actors.length; i++)
            if (s._actors[i]) s._actors[i].needRedraw = true;
          s.processActors();
          s.fadeIn(args[1]);
          break;
        case 8:
          // startManiac: DOTT's Maniac Mansion on Ed's computer. ScummVM
          // runs it only when it is set up as a separate game; here it
          // is not, so the game carries on (ScummVM shows a message)
          log("o6_kernelSetFunctions: Maniac Mansion would start now");
          break;
        case 9:
          s.killAllScriptsExceptCurrent();
          break;
        case 104:
          s.nukeFlObjects(args[2], args[3]);
          break;
        case 107:
          a = derefActor(args[1], "o6_kernelSetFunctions: 107");
          if (a) a.setScale(args[2] & 0xFF, -1);
          break;
        case 108:
        case 109:
          if (num != 6) error("o6_kernelSetFunctions sub op " + args[0] + ": expected 6 params but got " + num);
          s.setShadowPalette(args[3], args[4], args[5], args[1], args[2], 0, 256);
          break;
        case 110:
          // clearCharsetMask: all text off the screen
          s.clearTextSurface();
          break;
        case 111:
          a = derefActor(args[1], "o6_kernelSetFunctions: 111");
          if (a) a.shadow_mode = args[2] + args[3];
          break;
        case 112:
          s.setShadowPalette(args[3], args[4], args[5], args[1], args[2], args[6], args[7]);
          break;
        case 114:
          error("stub o6_kernelSetFunctions_114()");
          break;
        case 117:
          s.freezeScripts(0x80);
          break;
        case 119:
          log("o6_kernelSetFunctions: enqueueObject (blast object) not supported");
          break;
        case 120:
          s.swapPalColors(args[1], args[2]);
          break;
        case 122:
          // an iMUSE command, answered in VAR_SOUNDRESULT
          im = s.initMusic();
          s.scummVar("soundresult", im ? (im.doCommand(args.slice(1, num)) << 16 >> 16) : 0);
          break;
        case 123:
          s.copyPalColor(args[2], args[1]);
          break;
        case 124:
          s._saveSound = args[1];
          break;
        default:
          error("o6_kernelSetFunctions: default case " + args[0] + " (param count " + num + ")");
      }
    },
    kernelGetFunctions: function() {
      var args = stackArgs(30, 30), vs = s._virtscreens[0], i, a, slot, flags;
      switch (args[0]) {
        case 113:
          if (vs && args[1] >= 0 && args[1] <= vs.w && args[2] >= 0 && args[2] <= vs.h)
            s.push(vs.getPixels(args[1], args[2]).readUI8());
          else
            s.push(0);
          break;
        case 115:
          s.push(s.getSpecialBox(args[1], args[2]));
          break;
        case 116:
          s.push(bool(s.checkXYInBoxBounds(args[3], args[1], args[2])));
          break;
        case 206:
          s.push(s.remapPaletteColor(args[1], args[2], args[3], -1));
          break;
        case 207: case 208: case 209: case 210:
          i = s.getObjectIndex(args[1]);
          if (i < 1) { error("o6_kernelGetFunctions " + args[0] + ": no object " + args[1]); s.push(0); break; }
          s.push(s._objs[i][["x_pos", "y_pos", "width", "height"][args[0] - 207]]);
          break;
        case 211:
          // getKeyState: whether a key is held down -- not tracked here
          s.push(s._keyDownMap && s._keyDownMap[args[1]] ? 1 : 0);
          break;
        case 212:
          a = derefActorRead(args[1], "o6_kernelGetFunctions:212");
          s.push(a.frame | 0);
          break;
        case 213:
          slot = s.getVerbSlot(args[1], 0);
          s.push(s._verbs[slot].curRect.left);
          break;
        case 214:
          slot = s.getVerbSlot(args[1], 0);
          s.push(s._verbs[slot].curRect.top);
          break;
        case 215:
          flags = s._extraBoxFlags && s._extraBoxFlags[args[1]];
          if (flags && (flags & 0x00FF) == 0x00C0) s.push(flags);
          else s.push(s.getBoxFlags(args[1]));
          break;
        default:
          error("o6_kernelGetFunctions: default case " + args[0]);
          s.push(0);
      }
    },

    pickOneOf: function() {
      var args = s.getStackList(100), i = s.pop();
      if (i < 0 || i > args.length) error("o6_pickOneOf: " + i + " out of range (0, " + (args.length - 1) + ")");
      s.push(args[i] | 0);
    },
    pickOneOfDefault: function() {
      var def = s.pop(), args = s.getStackList(100), i = s.pop();
      if (i < 0 || i >= args.length) i = def;
      else i = args[i];
      s.push(i);
    },

    getDateTime: function() {
      var d = new Date();
      s.scummVar("timedate_year", d.getFullYear() - 1900);
      s.scummVar("timedate_month", d.getMonth());
      s.scummVar("timedate_day", d.getDate());
      s.scummVar("timedate_hour", d.getHours());
      s.scummVar("timedate_minute", d.getMinutes());
    },
    stopTalking: function() { s.stopTalk(); },
    shuffle: function() {
      var b = s.pop(), a = s.pop();
      s.shuffleArray(s.fetchScriptWord(), a, b);
    },
    findAllObjects: function() {
      var room = s.pop(), i = 1, n = s._nums['local_objects'];
      if (room != s._currentRoom) error("o6_findAllObjects: current room is not " + room);
      s.writeVar(0, 0);
      s.defineArray(0, kIntArray, 0, n + 1);
      s.writeArray(0, 0, 0, n);
      while (i < n) {
        s.writeArray(0, 0, i, s._objs[i] ? s._objs[i].obj_nr : 0);
        i++;
      }
      s.push(s.readVar(0));
    },
    getPixel: function() {
      var y = s.pop(), x = s.pop(), n = s.findVirtScreen(y), vs = n == null ? null : s._virtscreens[n];
      if (!vs || x > s._screenWidth - 1 || x < 0) { s.push(-1); return; }
      s.push(vs.getPixels(x, y - vs.topline).readUI8());
    },
    pickVarRandom: function() {
      var args = s.getStackList(100), num = args.length, value = s.fetchScriptWord(), counter, dim1, a, v2;
      if (s.readVar(value) == 0) {
        s.defineArray(value, kIntArray, 0, num);
        for (counter = 0; counter < num; counter++)
          s.writeArray(value, 0, counter + 1, args[counter]);
        s.shuffleArray(value, 1, num);
        s.writeArray(value, 0, 0, 2);
        s.push(s.readArray(value, 0, 1));
        return;
      }
      num = s.readArray(value, 0, 0);
      a = s.getArray(value);
      dim1 = a.dim1 - 1;
      if (dim1 < num) {
        v2 = s.readArray(value, 0, num - 1);
        s.shuffleArray(value, 1, dim1);
        num = s.readArray(value, 0, 1) == v2 ? 2 : 1;
      }
      s.writeArray(value, 0, 0, num + 1);
      s.push(s.readArray(value, 0, num));
    },
    // Sam & Max and v7 only; DOTT's rooms have one set of boxes
    setBoxSet: function() {
      var arg = s.pop();
      log("o6_setBoxSet(" + arg + ") not supported");
    }
  };

  // object.cpp getObjNewDir: an actor's facing, or the object's direction
  function getObjNewDir(obj) {
    var a, p;
    if (s.objIsActor(obj)) {
      a = derefActorRead(obj, "getObjNewDir");
      return a.facing | 0;
    }
    p = s.getObjectXYPos(obj);
    return p ? p.dir : 0;
  }

  // script_v6.cpp ScummEngine_v6::setupOpcodes
  s._opcodeTables = s._opcodeTables || {};
  s._opcodeTables[6] = {
    0x00: o6.pushByte,
    0x01: o6.pushWord,
    0x02: o6.pushByteVar,
    0x03: o6.pushWordVar,
    0x06: o6.byteArrayRead,
    0x07: o6.wordArrayRead,
    0x0a: o6.byteArrayIndexedRead,
    0x0b: o6.wordArrayIndexedRead,
    0x0c: o6.dup,
    0x0d: o6.not,
    0x0e: o6.eq,
    0x0f: o6.neq,
    0x10: o6.gt,
    0x11: o6.lt,
    0x12: o6.le,
    0x13: o6.ge,
    0x14: o6.add,
    0x15: o6.sub,
    0x16: o6.mul,
    0x17: o6.div,
    0x18: o6.land,
    0x19: o6.lor,
    0x1a: o6.pop,
    0x42: o6.writeByteVar,
    0x43: o6.writeWordVar,
    0x46: o6.byteArrayWrite,
    0x47: o6.wordArrayWrite,
    0x4a: o6.byteArrayIndexedWrite,
    0x4b: o6.wordArrayIndexedWrite,
    0x4e: o6.byteVarInc,
    0x4f: o6.wordVarInc,
    0x52: o6.byteArrayInc,
    0x53: o6.wordArrayInc,
    0x56: o6.byteVarDec,
    0x57: o6.wordVarDec,
    0x5a: o6.byteArrayDec,
    0x5b: o6.wordArrayDec,
    0x5c: o6["if"],
    0x5d: o6.ifNot,
    0x5e: o6.startScript,
    0x5f: o6.startScriptQuick,
    0x60: o6.startObject,
    0x61: o6.drawObject,
    0x62: o6.drawObjectAt,
    0x63: o6.drawBlastObject,
    0x64: o6.setBlastObjectWindow,
    0x65: o6.stopObjectCode,
    0x66: o6.stopObjectCode,
    0x67: o6.endCutscene,
    0x68: o6.cutscene,
    0x69: o6.stopMusic,
    0x6a: o6.freezeUnfreeze,
    0x6b: o6.cursorCommand,
    0x6c: o6.breakHere,
    0x6d: o6.ifClassOfIs,
    0x6e: o6.setClass,
    0x6f: o6.getState,
    0x70: o6.setState,
    0x71: o6.setOwner,
    0x72: o6.getOwner,
    0x73: o6.jump,
    0x74: o6.startSound,
    0x75: o6.stopSound,
    0x76: o6.startMusic,
    0x77: o6.stopObjectScript,
    0x78: o6.panCameraTo,
    0x79: o6.actorFollowCamera,
    0x7a: o6.setCameraAt,
    0x7b: o6.loadRoom,
    0x7c: o6.stopScript,
    0x7d: o6.walkActorToObj,
    0x7e: o6.walkActorTo,
    0x7f: o6.putActorAtXY,
    0x80: o6.putActorAtObject,
    0x81: o6.faceActor,
    0x82: o6.animateActor,
    0x83: o6.doSentence,
    0x84: o6.pickupObject,
    0x85: o6.loadRoomWithEgo,
    0x87: o6.getRandomNumber,
    0x88: o6.getRandomNumberRange,
    0x8a: o6.getActorMoving,
    0x8b: o6.isScriptRunning,
    0x8c: o6.getActorRoom,
    0x8d: o6.getObjectX,
    0x8e: o6.getObjectY,
    0x8f: o6.getObjectOldDir,
    0x90: o6.getActorWalkBox,
    0x91: o6.getActorCostume,
    0x92: o6.findInventory,
    0x93: o6.getInventoryCount,
    0x94: o6.getVerbFromXY,
    0x95: o6.beginOverride,
    0x96: o6.endOverride,
    0x97: o6.setObjectName,
    0x98: o6.isSoundRunning,
    0x99: o6.setBoxFlags,
    0x9a: o6.createBoxMatrix,
    0x9b: o6.resourceRoutines,
    0x9c: o6.roomOps,
    0x9d: o6.actorOps,
    0x9e: o6.verbOps,
    0x9f: o6.getActorFromXY,
    0xa0: o6.findObject,
    0xa1: o6.pseudoRoom,
    0xa2: o6.getActorElevation,
    0xa3: o6.getVerbEntrypoint,
    0xa4: o6.arrayOps,
    0xa5: o6.saveRestoreVerbs,
    0xa6: o6.drawBox,
    0xa7: o6.pop,
    0xa8: o6.getActorWidth,
    0xa9: o6.wait,
    0xaa: o6.getActorScaleX,
    0xab: o6.getActorAnimCounter,
    0xac: o6.soundKludge,
    0xad: o6.isAnyOf,
    0xae: o6.systemOps,
    0xaf: o6.isActorInBox,
    0xb0: o6.delay,
    0xb1: o6.delaySeconds,
    0xb2: o6.delayMinutes,
    0xb3: o6.stopSentence,
    0xb4: o6.printLine,
    0xb5: o6.printText,
    0xb6: o6.printDebug,
    0xb7: o6.printSystem,
    0xb8: o6.printActor,
    0xb9: o6.printEgo,
    0xba: o6.talkActor,
    0xbb: o6.talkEgo,
    0xbc: o6.dimArray,
    0xbd: o6.dummy,
    0xbe: o6.startObjectQuick,
    0xbf: o6.startScriptQuick2,
    0xc0: o6.dim2dimArray,
    0xc4: o6.abs,
    0xc5: o6.distObjectObject,
    0xc6: o6.distObjectPt,
    0xc7: o6.distPtPt,
    0xc8: o6.kernelGetFunctions,
    0xc9: o6.kernelSetFunctions,
    0xca: o6.delayFrames,
    0xcb: o6.pickOneOf,
    0xcc: o6.pickOneOfDefault,
    0xcd: o6.stampObject,
    0xd0: o6.getDateTime,
    0xd1: o6.stopTalking,
    0xd2: o6.getAnimateVariable,
    0xd4: o6.shuffle,
    0xd5: o6.jumpToScript,
    0xd6: o6.band,
    0xd7: o6.bor,
    0xd8: o6.isRoomScriptRunning,
    0xdd: o6.findAllObjects,
    0xe1: o6.getPixel,
    0xe3: o6.pickVarRandom,
    0xe4: o6.setBoxSet,
    0xec: o6.getActorLayer,
    0xed: o6.getObjectNewDir
  };
}());
