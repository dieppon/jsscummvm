/*
 * SCUMM v2 -- Maniac Mansion and Zak McKracken (enhanced) -- ported from
 * ScummVM's engines/scumm/script_v2.cpp, vars.cpp (setupScummVars for v2)
 * and the v2 parts of verbs.cpp, string.cpp and script.cpp.
 *
 * Its opcodes: many are v5's, the rest are v2's own. Variables are numbered
 * by a byte, and object states are bits (locked, pickupable, untouchable,
 * intrinsic). The engine, not the scripts, draws the interface: the
 * sentence line, the verbs and a four-slot inventory with arrows, and it
 * sends every click to script 4.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM;

  var SENTENCE_SCRIPT = 2;
  var kObjectStatePickupable = 1, kObjectStateUntouchable = 2,
      kObjectStateLocked = 4, kObjectStateIntrinsic = 8;
  var USERSTATE_SET_FREEZE = 0x01, USERSTATE_SET_CURSOR = 0x02, USERSTATE_SET_IFACE = 0x04,
      USERSTATE_FREEZE_ON = 0x08, USERSTATE_CURSOR_ON = 0x10, USERSTATE_IFACE_SENTENCE = 0x20,
      USERSTATE_IFACE_INVENTORY = 0x40, USERSTATE_IFACE_VERBS = 0x80,
      USERSTATE_IFACE_ALL = 0xE0;
  var V12_X_MULTIPLIER = 8, V12_Y_MULTIPLIER = 2;
  var kInventoryUpArrow = 4, kInventoryDownArrow = 5, kSentenceLine = 6;
  var INVENTORY_AREA = 32;
  var kSentenceClickArea = 3;   // kVerbClickArea 1, kSceneClickArea 2, kInventoryClickArea 4

  // getActiveObject
  function activeObject() { return s.getVarOrDirectWord(PARAM_1); }

  function rect(left, top, right, bottom) {
    return {left: left, top: top, right: right, bottom: bottom};
  }
  function contains(r, x, y) {
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }

  s.defineVersion("2", {
    // scumm.cpp ScummEngine_v2::resetScumm: the built-in font, and the
    // interface's boxes
    resetScumm: function() {
      var t = this;
      t._charset = new t.CharsetRendererV2(t);
      t._userState = 0;
      t._sentenceNum = 0;
      t._baseMethods.resetScumm.call(t);
      t.initV2MouseOver();
    },
    initCharset: function(no) {
      var t = this;
      t._curCharset = no;
      t._string[0]._default.charset = no;
      t._string[1]._default.charset = no;
    },

    // vars.cpp ScummEngine_v2::setupScummVars
    setupScummVars: function() {
      this._vars = {
        ego: 0, camera_pos_x: 2, have_msg: 3, room: 4, override: 5, machine_speed: 6,
        charcount: 7, active_verb: 8, active_object1: 9, active_object2: 10, num_actor: 11,
        current_lights: 12, currentdrive: 13, music_timer: 17, verb_allowed: 18,
        actor_range_min: 19, actor_range_max: 20, cursorstate: 21, camera_min_x: 23,
        camera_max_x: 24, timer_next: 25, sentence_verb: 26, sentence_object1: 27,
        sentence_object2: 28, sentence_preposition: 29, virt_mouse_x: 30, virt_mouse_y: 31,
        click_area: 32, click_verb: 33, click_object: 35, room_resource: 36, last_sound: 37,
        backup_verb: 38, keypress: 39, cutsceneexit_key: 40, talk_actor: 41
      };
    },

    // scumm.cpp: v1/v2 see the camera and the pointer in their coarse units
    updateScummVars: function() {
      var t = this;
      t.scummVar("have_msg", t._haveMsg);
      t.scummVar("camera_pos_x", t._camera.cur.x >> 3);
      t.scummVar("virt_mouse_x", t._virtualMouse.x >> 3);
      t.scummVar("virt_mouse_y", t._virtualMouse.y >> 1);
    },

    resetScummVars: function() {
      var t = this;
      t._vm.numNestedScripts = 0;
      t._currentScript = 0xFF;
      t._currentRoom = 0;
      t.setTalkingActor(0);
      // vars.cpp: Zak's fuller version needs a fast machine
      if (t._game == "zak") t.scummVar("machine_speed", 0x7FFF);
    },

    // script_v2.cpp: variables are a byte; 14 to 16 stand for the variable
    // they hold the number of
    getVar: function() {
      return this.readVar(this.fetchScriptByte());
    },
    readVar: function(v) {
      var t = this;
      if (v >= 14 && v <= 16) v = t._scummVars[v];
      return t._scummVars[v] || 0;
    },
    writeVar: function(v, value) {
      var t = this;
      // the cutscene key is Esc, whatever the game says
      if (v == t._vars.cutsceneexit_key && (value == 4 || value == 13 || value == 64)) value = 27;
      t._scummVars[v] = value;
    },
    getResultPos: function() {
      this._resultVarNumber = this.fetchScriptByte();
    },
    getResultPosIndirect: function() {
      this._resultVarNumber = this._scummVars[this.fetchScriptByte()];
    },

    // script_v2.cpp decodeParseString: control codes are bytes under 8, and
    // a high bit means a space after the character
    decodeParseString: function() {
      var t = this, buf = "", c, space, str = t._string[0];
      while ((c = t.fetchScriptByte())) {
        space = (c & 0x80) != 0;
        c &= 0x7F;
        if (c < 8) {
          buf += "\xFF" + String.fromCharCode(c);
          if (c > 3) buf += String.fromCharCode(t.fetchScriptByte()) + "\0";
        } else {
          buf += String.fromCharCode(c);
        }
        if (space) buf += " ";
      }
      str.x = 0;
      str.y = 0;
      str.right = t._screenWidth - 1;
      str.center = false;
      str.overhead = false;
      t.actorTalk(buf);
    },

    // script.cpp ScummEngine_v2::runInputScript: every click goes to script 4
    runInputScript: function(clickArea, val, mode) {
      var t = this, args = [], i;
      t.scummVar("click_area", clickArea);
      if (clickArea == 1) t.scummVar("click_verb", val);
      else if (clickArea == 4) t.scummVar("click_object", val);
      for (i = 0; i < 16; i++) args[i] = 0;
      args[0] = clickArea;
      args[1] = val;
      args[2] = mode;
      t.runScript(4, 0, 0, args);
    },
    runInventoryScript: function() { this.redrawV2Inventory(); },
    runInventoryScriptEx: function() {
      this.redrawV2Inventory();
      this.drawSentence();
    },

    // script.cpp: v2 freezes a script outright, with no count
    freezeScripts: function() {
      var t = this, vm = t._vm, i;
      for (i = 0; i < vm.slot.length; i++) {
        if (t._currentScript != i && vm.slot[i].status != "dead" && !vm.slot[i].freezeResistant) {
          vm.slot[i].frozen = true;
          vm.slot[i].freezeCount = 1;
        }
      }
    },
    unfreezeScripts: function() {
      var vm = this._vm, i;
      for (i = 0; i < vm.slot.length; i++) {
        vm.slot[i].frozen = false;
        vm.slot[i].freezeCount = 0;
      }
    },
    // script.cpp stopObjectCode, v2: a global or local script is stopped
    stopObjectCode: function() {
      var t = this, slot = t._vm.slot[t._currentScript];
      if (slot.where == "global" || slot.where == "local") {
        t.stopScript(slot.number);
      } else {
        slot.number = 0;
        slot.status = "dead";
      }
      t._currentScript = 0xFF;
    },

    // --- the interface the engine draws (verbs.cpp, string.cpp) ----------

    // initV2MouseOver: the inventory's four slots and arrows, and the
    // sentence line, in verb-screen coordinates
    initV2MouseOver: function() {
      var t = this, i, top;
      t._hiLiteColorVerbArrow = t._hiLiteColorInvSentence = 14;
      t._mouseOverBoxV2 = -1;
      t._mouseOverBoxesV2 = [];
      for (i = 0; i < 2; i++) {
        top = 32 + 8 * i;
        t._mouseOverBoxesV2[2 * i] = {rect: rect(0, top, 144, top + 8), color: 13, hicolor: 14};
        t._mouseOverBoxesV2[2 * i + 1] = {rect: rect(176, top, 320, top + 8), color: 13, hicolor: 14};
      }
      t._mouseOverBoxesV2[kInventoryUpArrow] = {rect: rect(144, 32, 176, 40), color: 1, hicolor: 14};
      t._mouseOverBoxesV2[kInventoryDownArrow] = {rect: rect(144, 40, 176, 48), color: 1, hicolor: 14};
      t._mouseOverBoxesV2[kSentenceLine] = {rect: rect(0, 0, 320, 8), color: 13, hicolor: 14};
      t._inventoryOffset = 0;
    },

    // clear the text drawn in a part of the verb screen (restoreBackground)
    restoreVerbArea: function(top, bottom, left, right) {
      var t = this, keep = [], i, g;
      for (i = 0; i < t._textLayer.length; i++) {
        g = t._textLayer[i];
        if (!g.main && !g.box && g.y >= top && g.y < bottom && g.x >= left && g.x < right) continue;
        keep.push(g);
      }
      t._textLayer = keep;
    },

    // draw a string at a box of the interface, highlighted if the pointer
    // is over it (checkV2MouseOver recolours it in place in ScummVM)
    drawV2Text: function(box, text, top) {
      var t = this, str = t._string[1], vs = t._virtscreens[2], i;
      str.charset = 1;
      str.x = box.rect.left;
      str.y = box.rect.top + vs.topline;
      str.right = box.rect.right - 1;
      str.color = box.color;
      str.center = false;
      str.height = 0;
      t.drawString(1, text);
      box.drawnFrom = t._textLayer.length;
    },

    redrawV2Inventory: function() {
      var t = this, vs = t._virtscreens[2], ego, count, visible, i, obj, name;
      t._mouseOverBoxV2 = -1;
      if (!(t._userState & USERSTATE_IFACE_INVENTORY)) return;
      if (!vs || !t._mouseOverBoxesV2) return;
      t.restoreVerbArea(vs.topline + INVENTORY_AREA, vs.topline + vs.h, 0, vs.w);
      ego = t.scummVar("ego");
      count = t.getInventoryCount(ego);
      visible = Math.min(4, count - t._inventoryOffset);
      for (i = 0; i < visible; i++) {
        obj = t.findInventory(ego, i + 1 + t._inventoryOffset);
        if (!obj) break;
        name = t.getObjOrActorName(obj);
        if (!name) continue;
        t.drawV2Text(t._mouseOverBoxesV2[i], t.convertMessageToString(name).substr(0, 18));
      }
      if (t._inventoryOffset > 0)
        t.drawV2Text(t._mouseOverBoxesV2[kInventoryUpArrow], " \x01\x02");
      if (t._inventoryOffset + 4 < count)
        t.drawV2Text(t._mouseOverBoxesV2[kInventoryDownArrow], " \x03\x04");
    },

    // checkV2Inventory: a click in the inventory -- an arrow scrolls it, a
    // slot gives its object
    checkV2Inventory: function(x, y) {
      var t = this, vs = t._virtscreens[2], ego = t.scummVar("ego"), i;
      y -= vs.topline;
      if (y < INVENTORY_AREA || !(t._mouseAndKeyboardStat & MBS_LEFT_CLICK)) return 0;
      if (contains(t._mouseOverBoxesV2[kInventoryUpArrow].rect, x, y)) {
        if (t._inventoryOffset >= 2) {
          t._inventoryOffset -= 2;
          t.redrawV2Inventory();
        }
      } else if (contains(t._mouseOverBoxesV2[kInventoryDownArrow].rect, x, y)) {
        if (t._inventoryOffset + 4 < t.getInventoryCount(ego)) {
          t._inventoryOffset += 2;
          t.redrawV2Inventory();
        }
      }
      for (i = 0; i < 4; i++)
        if (contains(t._mouseOverBoxesV2[i].rect, x, y)) break;
      if (i >= 4) return 0;
      return t.findInventory(ego, i + 1 + t._inventoryOffset);
    },

    // which interface box the pointer is over, for highlighting (drawn by
    // drawV2Highlight each frame)
    checkV2MouseOver: function() {
      var t = this, vs = t._virtscreens[2], i, box = -1;
      if (!(t._userState & USERSTATE_IFACE_INVENTORY) || !t._mouseOverBoxesV2) { t._mouseOverBoxV2 = -1; return; }
      if (t._cursorState > 0) {
        for (i = 0; i < t._mouseOverBoxesV2.length; i++)
          if (contains(t._mouseOverBoxesV2[i].rect, t._mouse.x, t._mouse.y - vs.topline)) { box = i; break; }
      }
      if (box != t._mouseOverBoxV2) {
        t.recolourV2Box(t._mouseOverBoxV2, false);
        t.recolourV2Box(box, true);
        t._mouseOverBoxV2 = box;
      }
    },
    recolourV2Box: function(i, on) {
      var t = this, box = i >= 0 && t._mouseOverBoxesV2[i], vs = t._virtscreens[2], r, j, g, from, to;
      if (!box) return;
      r = box.rect;
      from = on ? box.color : box.hicolor;
      to = on ? box.hicolor : box.color;
      for (j = 0; j < t._textLayer.length; j++) {
        g = t._textLayer[j];
        if (!g.main && !g.box && g.color == from && contains(r, g.x, g.y - vs.topline)) g.color = to;
      }
    },

    handleMouseOver: function(updateInventory) {
      var t = this;
      if (updateInventory) t._inventoryOffset = 0;
      if (t._completeScreenRedraw || updateInventory) t.redrawV2Inventory();
      t.checkV2MouseOver();
    },

    // string.cpp ScummEngine_v2::drawSentence: verb, object, preposition,
    // object, along the top of the verb screen
    drawSentence: function() {
      var t = this, vs = t._virtscreens[2], slot, buf, obj1, obj2, prep, name, ptr, str, out, len, i;
      if (!(t._userState & USERSTATE_IFACE_SENTENCE) || !vs) return;
      slot = t.getVerbSlot(t.scummVar("sentence_verb"), 0);
      buf = t.getResourceMessage("verb", slot);
      if (buf == null) return;
      buf = t.convertMessageToString(buf);
      obj1 = t.scummVar("sentence_object1");
      if (obj1 > 0) {
        name = t.getObjOrActorName(obj1);
        if (name) buf += " " + t.convertMessageToString(name);
      }
      prep = t.scummVar("sentence_preposition");
      if (prep > 0 && prep <= 4) buf += [" ", " in", " with", " on", " to"][prep];
      obj2 = t.scummVar("sentence_object2");
      if (obj2 > 0) {
        name = t.getObjOrActorName(obj2);
        if (name) buf += " " + t.convertMessageToString(name);
      }
      out = "";
      for (i = 0, len = 0; i < buf.length; i++) {
        if (buf[i] != "@") len++;
        if (len > 40) break;
        out += buf[i];
      }
      str = t._string[2];
      str.charset = 1;
      str.y = vs.topline;
      str.x = 0;
      str.right = vs.w - 1;
      str.color = 13;
      str.center = false;
      str.height = 0;
      t.restoreVerbArea(vs.topline, vs.topline + 8, 0, vs.w);
      t.drawString(2, out);
    },

    resetSentence: function() {
      var t = this;
      t.scummVar("sentence_verb", t.scummVar("backup_verb"));
      t.scummVar("sentence_object1", 0);
      t.scummVar("sentence_object2", 0);
      t.scummVar("sentence_preposition", 0);
    },

    // script_v2.cpp setUserState: which parts of the interface show, the
    // freeze, the cursor -- then the verb screen is redrawn
    setUserState: function(state) {
      var t = this, vs = t._virtscreens[2];
      if (state & USERSTATE_SET_IFACE) t._userState = state & USERSTATE_IFACE_ALL;
      if (state & USERSTATE_SET_FREEZE) {
        if (state & USERSTATE_FREEZE_ON) t.freezeScripts(0);
        else t.unfreezeScripts();
      }
      if (state & USERSTATE_SET_CURSOR) {
        t._userPut = t._cursorState = (state & USERSTATE_CURSOR_ON) ? 1 : 0;
      }
      if (vs) t.restoreVerbArea(vs.topline, vs.topline + vs.h, 0, vs.w);
      t.runInventoryScriptEx(1);
    },

    // verbs.cpp ScummEngine_v2::checkExecVerbs
    checkExecVerbs: function() {
      var t = this, i, v, object = -1, zone, code, over, k;
      if (t._userPut <= 0 || t._mouseAndKeyboardStat == 0) return;

      if (t._mouseAndKeyboardStat < MBS_MAX_KEY) {
        for (i = 1; i < t._nums['verbs']; i++) {
          v = t._verbs[i];
          if (v.verbid && v.saveid == 0 && v.curmode == 1 && t._mouseAndKeyboardStat == v.key) {
            t.runInputScript(1, v.verbid, 1);
            return;
          }
        }
        k = String.fromCharCode(t._mouseAndKeyboardStat);
        if (k == "u") {
          if (t._inventoryOffset >= 2) { t._inventoryOffset -= 2; t.redrawV2Inventory(); }
          return;
        }
        if (k == "j") {
          if (t._inventoryOffset + 4 < t.getInventoryCount(t.scummVar("ego"))) {
            t._inventoryOffset += 2;
            t.redrawV2Inventory();
          }
          return;
        }
        object = {i: 0, o: 1, k: 2, l: 3}[k];
        if (object !== undefined) {
          object = t.findInventory(t.scummVar("ego"), object + 1 + t._inventoryOffset);
          if (object > 0) t.runInputScript(4, object, 0);
          return;
        }
        t.runInputScript(5, t._mouseAndKeyboardStat, 1);
      } else if (t._mouseAndKeyboardStat & MBS_MOUSE_MASK) {
        zone = t.findVirtScreen(t._mouse.y);
        code = (t._mouseAndKeyboardStat & MBS_LEFT_CLICK) ? 1 : 2;
        if (zone == null) return;
        if (zone == 2 && t._mouse.y <= t._virtscreens[2].topline + 8) {
          t.runInputScript(kSentenceClickArea, 0, 0);
        } else if (zone == 2 && t._mouse.y >= t._virtscreens[2].topline + INVENTORY_AREA) {
          object = t.checkV2Inventory(t._mouse.x, t._mouse.y);
          if (object > 0) t.runInputScript(4, object, 0);
        } else {
          over = t.findVerbAtPos(t._mouse.x, t._mouse.y);
          if (over != 0) t.runInputScript(1, t._verbs[over].verbid, code);
          else t.runInputScript(zone == 0 ? 2 : 1, 0, code);
        }
      }
    },

    // object.cpp getVerbEntrypoint, v2: pairs of verb and offset from the
    // object, after its 15-byte header; 0xFF matches any verb
    getVerbEntryPoint: function(obj, entry) {
      var t = this, loc = t.getOBCDAddress(obj), p, code;
      if (!loc) return 0;
      p = loc.res.newAbsoluteStream(loc.abs + 15);
      for (;;) {
        code = p.readUI8();
        if (!code) return 0;
        if (code == entry || code == 0xFF) return p.readUI8();
        p.readUI8();
      }
    }
  });

  /* --- opcodes ------------------------------------------------------------ */

  var C = s._opcodeCommands;

  function setStateCommon(type) {
    var obj = activeObject();
    s.putState(obj, s.getState(obj) | type);
  }
  function clearStateCommon(type) {
    var obj = activeObject();
    s.putState(obj, s.getState(obj) & ~type);
  }
  function ifStateZeroCommon(type) {
    var obj = activeObject();
    s.jumpRelative((s.getState(obj) & type) != 0);
  }
  function ifStateNotZeroCommon(type) {
    var obj = activeObject();
    s.jumpRelative((s.getState(obj) & type) == 0);
  }
  // the v2 comparisons are unsigned 16-bit
  function compare(test) {
    return function() {
      var a = s.getVar() & 0xFFFF, b = s.getVarOrDirectWord(PARAM_1) & 0xFFFF;
      s.jumpRelative(test(a, b));
    };
  }
  // OBCD bytes of an object in the room or the inventory
  function obcdByte(obj, offs) {
    var loc = s.getOBCDAddress(obj);
    if (!loc) return null;
    return {res: loc.res, abs: loc.abs + offs};
  }

  var V2 = {
    setStateIntrinsicOn: function() {
      var obj = activeObject();
      s.putState(obj, s.getState(obj) | kObjectStateIntrinsic);
      s.markObjectRectAsDirty(obj);
      s.clearDrawObjectQueue();
    },
    setStateIntrinsicOff: function() {
      var obj = activeObject();
      s.putState(obj, s.getState(obj) & ~kObjectStateIntrinsic);
      s.markObjectRectAsDirty(obj);
      s.clearDrawObjectQueue();
    },
    setStateLocked: function() { setStateCommon(kObjectStateLocked); },
    setStateUnlocked: function() { clearStateCommon(kObjectStateLocked); },
    setStateUntouchable: function() { setStateCommon(kObjectStateUntouchable); },
    setStateTouchable: function() { clearStateCommon(kObjectStateUntouchable); },
    setStatePickupable: function() { setStateCommon(kObjectStatePickupable); },
    setStateUnpickupable: function() { clearStateCommon(kObjectStatePickupable); },
    ifStateIntrinsicOff: function() { ifStateZeroCommon(kObjectStateIntrinsic); },
    ifStateIntrinsicOn: function() { ifStateNotZeroCommon(kObjectStateIntrinsic); },
    ifStateUnlocked: function() { ifStateZeroCommon(kObjectStateLocked); },
    ifStateLocked: function() { ifStateNotZeroCommon(kObjectStateLocked); },
    ifStateTouchable: function() { ifStateZeroCommon(kObjectStateUntouchable); },
    ifStateUntouchable: function() { ifStateNotZeroCommon(kObjectStateUntouchable); },
    ifStateUnpickupable: function() { ifStateZeroCommon(kObjectStatePickupable); },
    ifStatePickupable: function() { ifStateNotZeroCommon(kObjectStatePickupable); },

    assignVarWordIndirect: function() {
      s.getResultPosIndirect();
      s.setResult(s.getVarOrDirectWord(PARAM_1));
    },
    assignVarByte: function() {
      s.getResultPos();
      s.setResult(s.fetchScriptByte());
    },
    // the preposition is the top three bits of the object's byte 12
    setObjPreposition: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), prep = s.fetchScriptByte(), p, b;
      if (s.whereIsObject(obj) == WIO_NOT_FOUND) return;
      p = obcdByte(obj, 12);
      if (!p || !p.res.writeByteAt) return;
      b = p.res.newAbsoluteStream(p.abs).readUI8();
      p.res.writeByteAt(p.abs, (b & 0x1F) | (prep << 5));
    },
    getObjPreposition: function() {
      var obj, p;
      s.getResultPos();
      obj = s.getVarOrDirectWord(PARAM_1);
      p = s.whereIsObject(obj) != WIO_NOT_FOUND && obcdByte(obj, 12);
      s.setResult(p ? p.res.newAbsoluteStream(p.abs).readUI8() >> 5 : 0xFF);
    },
    // bit variables are kept in the plain ones, sixteen to a variable
    setBitVar: function() {
      var v = s.fetchScriptWord(), a = s.getVarOrDirectByte(PARAM_1), bit = v + a,
          offs = bit & 0x0F;
      bit >>= 4;
      if (s.getVarOrDirectByte(PARAM_2)) s._scummVars[bit] |= (1 << offs);
      else s._scummVars[bit] &= ~(1 << offs);
    },
    getBitVar: function() {
      var v, a, bit, offs;
      s.getResultPos();
      v = s.fetchScriptWord();
      a = s.getVarOrDirectByte(PARAM_1);
      bit = v + a;
      offs = bit & 0x0F;
      bit >>= 4;
      s.setResult((s._scummVars[bit] & (1 << offs)) ? 1 : 0);
    },
    addIndirect: function() {
      s.getResultPosIndirect();
      s._scummVars[s._resultVarNumber] += s.getVarOrDirectWord(PARAM_1);
    },
    subIndirect: function() {
      s.getResultPosIndirect();
      s._scummVars[s._resultVarNumber] -= s.getVarOrDirectWord(PARAM_1);
    },
    add: function() {
      s.getResultPos();
      s._scummVars[s._resultVarNumber] += s.getVarOrDirectWord(PARAM_1);
    },
    subtract: function() {
      s.getResultPos();
      s._scummVars[s._resultVarNumber] -= s.getVarOrDirectWord(PARAM_1);
    },
    waitForActor: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1));
      if (a && a.moving) {
        s._scriptPointer.seek(-2);
        C.breakHere();
      }
    },
    waitForMessage: function() {
      if (s.scummVar("have_msg")) {
        s._scriptPointer.seek(-1);
        C.breakHere();
      }
    },
    waitForSentence: function() {
      if (!s._sentenceNum && !s.isScriptInUse(SENTENCE_SCRIPT)) return;
      s._scriptPointer.seek(-1);
      C.breakHere();
    },
    actorOps: function() {
      var act = s.getVarOrDirectByte(PARAM_1), arg = s.getVarOrDirectByte(PARAM_2), a, i;
      s._opcode = s.fetchScriptByte();
      if (act == 0 && s._opcode == 5) {
        s._string[0].color = arg;
        return;
      }
      a = s.getActor(act);
      // the arguments are read whether or not the actor is there, or the
      // script goes on from the middle of them
      switch (s._opcode) {
        case 1: if (a) a.sound = arg; break;
        case 2:
          i = s.fetchScriptByte();
          if (a) a.setPalette(i, arg);
        break;
        case 3:
          if (a) s.loadPtrToResource("actor_name", a.number, null);
          else s._scriptPointer.seek(s.resStrLen(null) + 1);
        break;
        case 4: if (a) a.setActorCostume(arg); break;
        case 5: if (a) a.talkColor = arg; break;
        default: error("o2_actorOps: " + s._opcode);
      }
    },
    restart: function() { log("o2_restart"); },
    // put an object's image on the room, possibly moved; any object of the
    // same size in the same place loses its image
    drawObject: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), xpos = s.getVarOrDirectByte(PARAM_2),
          ypos = s.getVarOrDirectByte(PARAM_3), idx = s.getObjectIndex(obj), od, i, o;
      if (idx == -1) return;
      od = s._objs[idx];
      if (xpos != 0xFF) {
        od.walk_x += xpos * 8 - od.x_pos;
        od.x_pos = xpos * 8;
        od.walk_y += ypos * 8 - od.y_pos;
        od.y_pos = ypos * 8;
      }
      s.addObjectToDrawQueue(idx);
      for (i = s._nums['local_objects'] - 1; i >= 0; i--) {
        o = s._objs[i];
        if (o && o.obj_nr && o.x_pos == od.x_pos && o.y_pos == od.y_pos && o.width == od.width && o.height == od.height)
          s.putState(o.obj_nr, s.getState(o.obj_nr) & ~kObjectStateIntrinsic);
      }
      s.putState(obj, s.getState(od.obj_nr) | kObjectStateIntrinsic);
    },
    resourceRoutines: function() {
      var types = [null, null, "costume", "room", null, "script", "sound"],
          resid = s.getVarOrDirectByte(PARAM_1), op = s.fetchScriptByte(), type = types[op >> 4] || null;
      if ((op & 0x0F) == 0 || !type) return;
      if ((op & 0x0F) == 1) s.ensureResourceLoaded(type, resid);
    },
    // a new verb, or one deleted, or switched on or off
    verbOps: function() {
      var verb = s.fetchScriptByte(), slot, state, x, y, prep, vs;
      switch (verb) {
        case 0:
          slot = s.getVarOrDirectByte(PARAM_1) + 1;
          s.killVerb(slot);
        break;
        case 0xFF:
          verb = s.fetchScriptByte();
          state = s.fetchScriptByte();
          slot = s.getVerbSlot(verb, 0);
          s._verbs[slot].curmode = state;
        break;
        default:
          x = s.fetchScriptByte() * 8;
          y = s.fetchScriptByte() * 8;
          slot = s.getVarOrDirectByte(PARAM_1) + 1;
          prep = s.fetchScriptByte();
          vs = s._verbs[slot];
          vs.verbid = verb;
          vs.color = 2;
          vs.hicolor = s._hiLiteColorVerbArrow || 14;
          vs.dimcolor = 8;
          vs.type = kTextVerbType;
          vs.charset_nr = 1;
          vs.curmode = 1;
          vs.saveid = 0;
          vs.center = false;
          vs.imgindex = 0;
          vs.prep = prep;
          vs.curRect.left = vs.origLeft = x;
          vs.curRect.top = y;
          vs.curRect.bottom = y + 8;
          vs.key = "qwertasdfgzxcvb".charCodeAt(slot - 1) || 0;
          s.loadPtrToResource("verb", slot, null);
          vs.text = s.getResourceMessage("verb", slot) || "";
          s.setVerbRect(vs);
        break;
      }
    },
    doSentence: function() {
      var a = s.getVarOrDirectByte(PARAM_1), st, back, special, slot, i, ss;
      if (a == 0xFC) {
        s._sentenceNum = 0;
        s.stopScript(SENTENCE_SCRIPT);
        return;
      }
      if (a == 0xFB) {
        s.resetSentence();
        return;
      }
      st = s._sentence[s._sentenceNum] || (s._sentence[s._sentenceNum] = {});
      s._sentenceNum++;
      st.verb = a;
      st.objectA = s.getVarOrDirectWord(PARAM_2);
      st.objectB = s.getVarOrDirectWord(PARAM_3);
      st.preposition = st.objectB != 0;
      st.freezeCount = 0;
      s._opcode = s.fetchScriptByte();
      switch (s._opcode) {
        case 0: break;
        case 1:
          // run it now
          s._sentenceNum--;
          if (st.verb == 254) {
            s.stopObjectScript(st.objectA);
            break;
          }
          if (st.verb != 253 && st.verb != 250) {
            s.scummVar("active_verb", st.verb);
            s.scummVar("active_object1", st.objectA);
            s.scummVar("active_object2", st.objectB);
            back = false;
            special = false;
          } else {
            back = st.verb == 250;
            special = true;
            st.verb = 253;
          }
          slot = -1;
          for (i = 0; i < s._vm.slot.length; i++) {
            ss = s._vm.slot[i];
            if (st.objectA == ss.number && !!ss.freezeResistant == back && !!ss.recursive == special &&
                (ss.where == "room" || ss.where == "inventory" || ss.where == "flobject")) {
              slot = i;
              break;
            }
          }
          s.runObjectScript(st.objectA, st.verb, back, special, null, slot);
        break;
        case 2:
          // show it on the sentence line
          s._sentenceNum--;
          s.scummVar("sentence_verb", st.verb);
          s.scummVar("sentence_object1", st.objectA);
          s.scummVar("sentence_object2", st.objectB);
          s.drawSentence();
        break;
      }
    },
    drawSentence: function() { s.drawSentence(); },
    // the object's class byte, its byte 6
    ifClassOfIs: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), clsop = s.getVarOrDirectByte(PARAM_2), p, cls;
      p = obcdByte(obj, 6);
      if (!p) { C.jumpRelative(); return; }
      cls = p.res.newAbsoluteStream(p.abs).readUI8();
      s.jumpRelative((cls & clsop) == clsop);
    },
    walkActorTo: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)), x = s.getVarOrDirectByte(PARAM_2),
          y = s.getVarOrDirectByte(PARAM_3);
      if (a) a.startWalkActor(x, y, -1);
    },
    putActor: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)), x = s.getVarOrDirectByte(PARAM_2),
          y = s.getVarOrDirectByte(PARAM_3);
      if (a) a.putActor(x, y);
    },
    startScript: function() {
      var script = s.getVarOrDirectByte(PARAM_1);
      // script_v2.cpp: Zak's copy protection (script 15 in room 45) is
      // skipped, as ScummVM does with copy_protection off
      if (s._game == "zak" && script == 15 && s._roomResource == 45) return;
      // script_v2.cpp: Maniac Mansion workarounds -- the doorbell
      // script 87 is not started over scripts 88/89, nor the
      // closed-door script 155 once var 120 is set
      if (s._game == "maniac") {
        if (script == 87 && (s.isScriptRunning(88) || s.isScriptRunning(89))) return;
        if (script == 155 && s.readVar(120) == 1) return;
      }
      s.runScript(script, 0, 0, null);
    },
    stopScript: function() {
      var script = s.getVarOrDirectByte(PARAM_1);
      if (script == 0) script = s._vm.slot[s._currentScript].number;
      if (s._currentScript != 0 && s._vm.slot[s._currentScript].number == script) s.stopObjectCode();
      else s.stopScript(script);
    },
    panCameraTo: function() {
      s.panCameraTo(s.getVarOrDirectByte(PARAM_1) * V12_X_MULTIPLIER, 0);
    },
    walkActorToObject: function() {
      var actor = s.getVarOrDirectByte(PARAM_1), obj = s.getVarOrDirectWord(PARAM_2), a, pos, r;
      if (s.whereIsObject(obj) == WIO_NOT_FOUND) return;
      a = s.getActor(actor);
      if (!a) return;
      pos = s.getObjectXYPos(obj);
      r = a.adjustXYToBeInBox(pos.x, pos.y);
      a.startWalkActor(r.x, r.y, pos.dir);
    },
    putActorAtObject: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)), obj = s.getVarOrDirectWord(PARAM_2), x, y, pos, r;
      if (s.whereIsObject(obj) != WIO_NOT_FOUND) {
        pos = s.getObjectXYPos(obj);
        r = a.adjustXYToBeInBox(pos.x, pos.y);
        x = r.x;
        y = r.y;
      } else {
        x = 30;
        y = 60;
      }
      a.putActor(x, y);
    },
    putActorInRoom: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)), room = s.getVarOrDirectByte(PARAM_2);
      if (!a) return;
      a.room = room;
      if (!room) a.putActor(0, 0, 0);
      // script_v2.cpp: Zak's actor 7 with object 344 locked
      if (s._game == "zak" && a.number == 7 && (s.getState(344) & kObjectStateLocked) &&
          room != 10 && room != 16 && s._currentRoom != 10)
        s.writeVar(245, 0x18);
    },
    getActorElevation: function() {
      var a;
      s.getResultPos();
      a = s.getActor(s.getVarOrDirectByte(PARAM_1));
      s.setResult(a ? a.elevation : 0);
    },
    setActorElevation: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)), e = s.getVarOrDirectByte(PARAM_2);
      if (e > 127) e -= 256;
      if (a) a.setElevation ? a.setElevation(e) : (a.elevation = e);
    },
    actorFromPos: function() {
      var x, y;
      s.getResultPos();
      x = s.getVarOrDirectByte(PARAM_1) * V12_X_MULTIPLIER;
      y = s.getVarOrDirectByte(PARAM_2) * V12_Y_MULTIPLIER;
      s.setResult(s.getActorFromPos(x, y));
    },
    findObject: function() {
      var x, y;
      s.getResultPos();
      x = s.getVarOrDirectByte(PARAM_1) * V12_X_MULTIPLIER;
      y = s.getVarOrDirectByte(PARAM_2) * V12_Y_MULTIPLIER;
      s.setResult(s.findObject(x, y));
    },
    getActorX: function() {
      s.getResultPos();
      s.setResult(s.getObjX(s.getVarOrDirectByte(PARAM_1)));
    },
    getActorY: function() {
      s.getResultPos();
      s.setResult(s.getObjY(s.getVarOrDirectByte(PARAM_1)));
    },
    isGreater: compare(function(a, b) { return b > a; }),
    isGreaterEqual: compare(function(a, b) { return b >= a; }),
    isLess: compare(function(a, b) { return b < a; }),
    isLessEqual: compare(function(a, b) { return b <= a; }),
    isEqual: function() {
      var v = s.fetchScriptByte(), a = s.readVar(v), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(((b << 16) >> 16) == ((a << 16) >> 16));
    },
    lights: function() {
      var a = s.getVarOrDirectByte(PARAM_1), b = s.fetchScriptByte(), c = s.fetchScriptByte();
      if (c == 0) s.scummVar("current_lights", a);
      s._fullRedraw = true;
    },
    loadRoomWithEgo: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), room = s.getVarOrDirectByte(PARAM_2),
          a = s.getActor(s.scummVar("ego")), x, y, pos, r;
      a.putActor(a.realPos ? a.realPos().x : a.pos.x, a.realPos ? a.realPos().y : a.pos.y, room);
      s._egoPositioned = false;
      x = s.fetchScriptByte(); if (x > 127) x -= 256;
      y = s.fetchScriptByte(); if (y > 127) y -= 256;
      s.startScene(a.room, a, obj);
      pos = s.getObjectXYPos(obj);
      r = a.adjustXYToBeInBox(pos.x, pos.y);
      a.putActor(r.x, r.y, s._currentRoom);
      a.setDirection(pos.dir + 180);
      s.setCameraAt(a.getPos().x, a.getPos().y);
      s.setCameraFollows(a);
      s._fullRedraw = true;
      s.resetSentence();
      if (x >= 0 && y >= 0) a.startWalkActor(x, y, -1);
      s.runScript(5, 0, 0, null);
    },
    setOwnerOf: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), owner = s.getVarOrDirectByte(PARAM_2);
      s.setOwnerOf(obj, owner);
    },
    // a 24-bit count of frames, stored inverted
    delay: function() {
      var d = s.fetchScriptByte() | (s.fetchScriptByte() << 8) | (s.fetchScriptByte() << 16),
          slot = s._vm.slot[s._currentScript];
      slot.delay = 0xFFFFFF - d;
      slot.status = "paused";
      C.breakHere();
    },
    setCameraAt: function() {
      s.setCameraAtEx(s.getVarOrDirectByte(PARAM_1) * V12_X_MULTIPLIER);
    },
    roomOps: function() {
      var a = s.getVarOrDirectByte(PARAM_1), b = s.getVarOrDirectByte(PARAM_2), half = s._screenWidth / 2;
      s._opcode = s.fetchScriptByte();
      switch (s._opcode & 0x1F) {
        case 1:
          a = Math.min(Math.max(a * 8, half), s._roomWidth - half);
          b = Math.min(Math.max(b * 8, half), s._roomWidth - half);
          s.scummVar("camera_min_x", a);
          s.scummVar("camera_max_x", b);
        break;
        case 2:
          s._roomPalette[b] = a;
          s._fullRedraw = true;
        break;
      }
    },
    cutscene: function() {
      var vm = s._vm;
      vm.cutSceneData[0] = s._userState | (s._userPut ? 16 : 0);
      vm.cutSceneData[1] = s.scummVar("cursorstate");
      vm.cutSceneData[2] = s._currentRoom;
      vm.cutSceneData[3] = s._camera.mode;
      s.scummVar("cursorstate", 200);
      s.setUserState(USERSTATE_SET_IFACE | USERSTATE_SET_CURSOR | USERSTATE_SET_FREEZE | USERSTATE_FREEZE_ON);
      s._sentenceNum = 0;
      s.stopScript(SENTENCE_SCRIPT);
      s.resetSentence();
      vm.cutScenePtr[0] = 0;
    },
    endCutscene: function() {
      var vm = s._vm;
      vm.cutSceneStackPointer = 0;
      s.scummVar("override", 0);
      vm.cutSceneScript[0] = 0;
      vm.cutScenePtr[0] = 0;
      s.scummVar("cursorstate", vm.cutSceneData[1]);
      s.setUserState(vm.cutSceneData[0] | USERSTATE_SET_IFACE | USERSTATE_SET_CURSOR | USERSTATE_SET_FREEZE);
      s.actorFollowCamera(s.scummVar("ego"));
    },
    beginOverride: function() {
      var vm = s._vm;
      vm.cutScenePtr[0] = s._scriptPointer.offset;
      vm.cutSceneScript[0] = s._currentScript;
      s.fetchScriptByte();
      s.fetchScriptWord();
    },
    chainScript: function() {
      var script = s.getVarOrDirectByte(PARAM_1);
      s.stopScript(s._vm.slot[s._currentScript].number);
      s._currentScript = 0xFF;
      s.runScript(script, 0, 0, null);
    },
    pickupObject: function() {
      var obj = s.getVarOrDirectWord(PARAM_1);
      if (obj < 1) return;
      if (s.getObjectIndex(obj) == -1) return;
      if (s.whereIsObject(obj) == WIO_INVENTORY) return;
      s.addObjectToInventory(obj, s._roomResource);
      s.markObjectRectAsDirty(obj);
      s.putOwner(obj, s.scummVar("ego"));
      s.putState(obj, s.getState(obj) | kObjectStateIntrinsic | kObjectStateUntouchable);
      s.clearDrawObjectQueue();
      s.runInventoryScript(1);
    },
    cursorCommand: function() {
      var cmd = s.getVarOrDirectWord(PARAM_1) & 0xFFFF;
      if (cmd & 0xFF) s.scummVar("cursorstate", cmd & 0xFF);
      s.setUserState(cmd >> 8);
    },
    getActorWalkBox: function() {
      var a;
      s.getResultPos();
      a = s.getActor(s.getVarOrDirectByte(PARAM_1));
      s.setResult(a && a.isInCurrentRoom() ? a.walkbox : 0xFF);
    },
    dummy: function() {},
    switchCostumeSet: function() { s.fetchScriptByte(); },
    setBoxFlags: function() {
      var a = s.getVarOrDirectByte(PARAM_1), b = s.fetchScriptByte();
      s.setBoxFlags(a, b);
    },
    // o4_saveLoadGame: how many slots there are, and nothing more -- saving
    // and loading are the F5 menu's
    saveLoadGame: function() {
      var a;
      s.getResultPos();
      a = s.getVarOrDirectByte(PARAM_1);
      s.setResult((a & 0xE0) == 0 ? 100 : 0);
    }
  };

  s._opcodeTables = s._opcodeTables || {};
  s._opcodeTables[2] = {
    0x00: C.stopObjectCode, 0x01: V2.putActor, 0x02: C.startMusic, 0x03: C.getActorRoom,
    0x04: V2.isGreaterEqual, 0x05: V2.drawObject, 0x06: V2.getActorElevation, 0x07: V2.setStateIntrinsicOn,
    0x08: C.isNotEqual, 0x09: C.faceActor, 0x0a: V2.assignVarWordIndirect, 0x0b: V2.setObjPreposition,
    0x0c: V2.resourceRoutines, 0x0d: C.walkActorToActor, 0x0e: V2.putActorAtObject, 0x0f: V2.ifStateIntrinsicOn,
    0x10: C.getObjectOwner, 0x11: C.animateActor, 0x12: V2.panCameraTo, 0x13: V2.actorOps,
    0x14: C.print, 0x15: V2.actorFromPos, 0x16: C.getRandomNr, 0x17: V2.setStateTouchable,
    0x18: C.jumpRelative, 0x19: V2.doSentence, 0x1a: C.move, 0x1b: V2.setBitVar,
    0x1c: C.startSound, 0x1d: V2.ifClassOfIs, 0x1e: V2.walkActorTo, 0x1f: V2.ifStateTouchable,
    0x20: C.stopMusic, 0x21: V2.putActor, 0x22: V2.saveLoadGame, 0x23: V2.getActorY,
    0x24: V2.loadRoomWithEgo, 0x25: V2.drawObject, 0x26: C.setVarRange, 0x27: V2.setStateLocked,
    0x28: C.equalZero, 0x29: V2.setOwnerOf, 0x2a: V2.addIndirect, 0x2b: C.delayVariable,
    0x2c: V2.assignVarByte, 0x2d: V2.putActorInRoom, 0x2e: V2.delay, 0x2f: V2.ifStateLocked,
    0x30: V2.setBoxFlags, 0x31: V2.getBitVar, 0x32: V2.setCameraAt, 0x33: V2.roomOps,
    0x34: C.getDist, 0x35: V2.findObject, 0x36: V2.walkActorToObject, 0x37: V2.setStatePickupable,
    0x38: V2.isLessEqual, 0x39: V2.doSentence, 0x3a: V2.subtract, 0x3b: V2.waitForActor,
    0x3c: C.stopSound, 0x3d: V2.setActorElevation, 0x3e: V2.walkActorTo, 0x3f: V2.ifStatePickupable,
    0x40: V2.cutscene, 0x41: V2.putActor, 0x42: V2.startScript, 0x43: V2.getActorX,
    0x44: V2.isLess, 0x45: V2.drawObject, 0x46: C.increment, 0x47: V2.setStateIntrinsicOff,
    0x48: V2.isEqual, 0x49: C.faceActor, 0x4a: V2.chainScript, 0x4b: V2.setObjPreposition,
    0x4c: V2.waitForSentence, 0x4d: C.walkActorToActor, 0x4e: V2.putActorAtObject, 0x4f: V2.ifStateIntrinsicOff,
    0x50: V2.pickupObject, 0x51: C.animateActor, 0x52: C.actorFollowCamera, 0x53: V2.actorOps,
    0x54: C.setObjectName, 0x55: V2.actorFromPos, 0x56: C.getActorMoving, 0x57: V2.setStateUntouchable,
    0x58: V2.beginOverride, 0x59: V2.doSentence, 0x5a: V2.add, 0x5b: V2.setBitVar,
    0x5c: V2.dummy, 0x5d: V2.ifClassOfIs, 0x5e: V2.walkActorTo, 0x5f: V2.ifStateUntouchable,
    0x60: V2.cursorCommand, 0x61: V2.putActor, 0x62: V2.stopScript, 0x63: C.getActorFacing,
    0x64: V2.loadRoomWithEgo, 0x65: V2.drawObject, 0x66: C.getClosestObjActor, 0x67: V2.setStateUnlocked,
    0x68: C.isScriptRunning, 0x69: V2.setOwnerOf, 0x6a: V2.subIndirect, 0x6b: V2.dummy,
    0x6c: V2.getObjPreposition, 0x6d: V2.putActorInRoom, 0x6e: V2.dummy, 0x6f: V2.ifStateUnlocked,
    0x70: V2.lights, 0x71: C.getActorCostume, 0x72: C.loadRoom, 0x73: V2.roomOps,
    0x74: C.getDist, 0x75: V2.findObject, 0x76: V2.walkActorToObject, 0x77: V2.setStateUnpickupable,
    0x78: V2.isGreater, 0x79: V2.doSentence, 0x7a: V2.verbOps, 0x7b: V2.getActorWalkBox,
    0x7c: C.isSoundRunning, 0x7d: V2.setActorElevation, 0x7e: V2.walkActorTo, 0x7f: V2.ifStateUnpickupable,
    0x80: C.breakHere, 0x81: V2.putActor, 0x82: C.startMusic, 0x83: C.getActorRoom,
    0x84: V2.isGreaterEqual, 0x85: V2.drawObject, 0x86: V2.getActorElevation, 0x87: V2.setStateIntrinsicOn,
    0x88: C.isNotEqual, 0x89: C.faceActor, 0x8a: V2.assignVarWordIndirect, 0x8b: V2.setObjPreposition,
    0x8c: V2.resourceRoutines, 0x8d: C.walkActorToActor, 0x8e: V2.putActorAtObject, 0x8f: V2.ifStateIntrinsicOn,
    0x90: C.getObjectOwner, 0x91: C.animateActor, 0x92: V2.panCameraTo, 0x93: V2.actorOps,
    0x94: C.print, 0x95: V2.actorFromPos, 0x96: C.getRandomNr, 0x97: V2.setStateTouchable,
    0x98: V2.restart, 0x99: V2.doSentence, 0x9a: C.move, 0x9b: V2.setBitVar,
    0x9c: C.startSound, 0x9d: V2.ifClassOfIs, 0x9e: V2.walkActorTo, 0x9f: V2.ifStateTouchable,
    0xa0: C.stopObjectCode, 0xa1: V2.putActor, 0xa2: V2.saveLoadGame, 0xa3: V2.getActorY,
    0xa4: V2.loadRoomWithEgo, 0xa5: V2.drawObject, 0xa6: C.setVarRange, 0xa7: V2.setStateLocked,
    0xa8: C.notEqualZero, 0xa9: V2.setOwnerOf, 0xaa: V2.addIndirect, 0xab: V2.switchCostumeSet,
    0xac: V2.drawSentence, 0xad: V2.putActorInRoom, 0xae: V2.waitForMessage, 0xaf: V2.ifStateLocked,
    0xb0: V2.setBoxFlags, 0xb1: V2.getBitVar, 0xb2: V2.setCameraAt, 0xb3: V2.roomOps,
    0xb4: C.getDist, 0xb5: V2.findObject, 0xb6: V2.walkActorToObject, 0xb7: V2.setStatePickupable,
    0xb8: V2.isLessEqual, 0xb9: V2.doSentence, 0xba: V2.subtract, 0xbb: V2.waitForActor,
    0xbc: C.stopSound, 0xbd: V2.setActorElevation, 0xbe: V2.walkActorTo, 0xbf: V2.ifStatePickupable,
    0xc0: V2.endCutscene, 0xc1: V2.putActor, 0xc2: V2.startScript, 0xc3: V2.getActorX,
    0xc4: V2.isLess, 0xc5: V2.drawObject, 0xc6: C.decrement, 0xc7: V2.setStateIntrinsicOff,
    0xc8: V2.isEqual, 0xc9: C.faceActor, 0xca: V2.chainScript, 0xcb: V2.setObjPreposition,
    0xcc: C.pseudoRoom, 0xcd: C.walkActorToActor, 0xce: V2.putActorAtObject, 0xcf: V2.ifStateIntrinsicOff,
    0xd0: V2.pickupObject, 0xd1: C.animateActor, 0xd2: C.actorFollowCamera, 0xd3: V2.actorOps,
    0xd4: C.setObjectName, 0xd5: V2.actorFromPos, 0xd6: C.getActorMoving, 0xd7: V2.setStateUntouchable,
    0xd8: C.printEgo, 0xd9: V2.doSentence, 0xda: V2.add, 0xdb: V2.setBitVar,
    0xdc: V2.dummy, 0xdd: V2.ifClassOfIs, 0xde: V2.walkActorTo, 0xdf: V2.ifStateUntouchable,
    0xe0: V2.cursorCommand, 0xe1: V2.putActor, 0xe2: V2.stopScript, 0xe3: C.getActorFacing,
    0xe4: V2.loadRoomWithEgo, 0xe5: V2.drawObject, 0xe6: C.getClosestObjActor, 0xe7: V2.setStateUnlocked,
    0xe8: C.isScriptRunning, 0xe9: V2.setOwnerOf, 0xea: V2.subIndirect, 0xeb: V2.dummy,
    0xec: V2.getObjPreposition, 0xed: V2.putActorInRoom, 0xee: V2.dummy, 0xef: V2.ifStateUnlocked,
    0xf0: V2.lights, 0xf1: C.getActorCostume, 0xf2: C.loadRoom, 0xf3: V2.roomOps,
    0xf4: C.getDist, 0xf5: V2.findObject, 0xf6: V2.walkActorToObject, 0xf7: V2.setStateUnpickupable,
    0xf8: V2.isGreater, 0xf9: V2.doSentence, 0xfa: V2.verbOps, 0xfb: V2.getActorWalkBox,
    0xfc: C.isSoundRunning, 0xfd: V2.setActorElevation, 0xfe: V2.walkActorTo, 0xff: V2.ifStateUnpickupable
  };
}());
