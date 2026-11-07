/*
 * The opcodes of SCUMM v5 games (Monkey Island 1 and 2, Indiana Jones and
 * the Fate of Atlantis, Loom CD...), ported from ScummVM's
 * engines/scumm/script_v5.cpp, and their table by opcode byte.
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  var unimplementedOpcode = function() {
    // log("opcode 0x"+s._opcode.toString(16)+" unimplemented");
  };

  s._opcodeCommands = {
    startScript: function() {
      var op, script, data;

      op = s._opcode;
      script = s.getVarOrDirectByte(PARAM_1);
      data = s.getWordVararg();

      s.runScript(script, (op & 0x20) != 0, (op & 0x40) != 0, data);
    },
    startObject: function() {
      var op = s._opcode,
          obj = s.getVarOrDirectWord(PARAM_1),
          script = s.getVarOrDirectByte(PARAM_2),
          data = s.getWordVararg();

      // o5_startObject: never freeze-resistant or recursive -- the opcode
      // bits that startScript reads that way mean "variable operand" here
      s.runObjectScript(obj, script, 0, 0, data, -1);
    },
    resourceRoutines: function() {
     var resType = ["script", "sound", "costume", "room"], resid = 0;
     s._opcode = s.fetchScriptByte();
     if(s._opcode != 17)
       resid = s.getVarOrDirectByte(PARAM_1);

     var op = s._opcode & 0x3F;
     switch(op) {
       case 1: // load script
       case 2: // load sound
       case 3: // load costume
         s.ensureResourceLoaded(resType[op - 1], resid);
       break;
       case 4: // room
         s.ensureResourceLoaded("room", resid);
         break;
       // nuking, locking and unlocking only manage memory, which a browser
       // does for us
       case 5: case 6: case 7: case 8:       // nuke script/sound/costume/room
       case 9: case 10: case 11: case 12:    // lock
       case 13: case 14: case 15: case 16:   // unlock
       case 17:                              // clear heap
       case 19:                              // nuke charset
       break;
       case 18: // charset
         s.loadCharset(resid);
       break;
       case 20: // load object -- loadFlObject; flobjects are not supported yet
         s.getVarOrDirectWord(PARAM_2);
         log("resourceRoutines: load object " + resid + " not supported");
       break;
       default:
         log("unimplemented resourceRoutines opcode "+op);
       break;
     }
    },
    move: function() {
      s.getResultPos();
      s.setResult(s.getVarOrDirectWord(PARAM_1));
    },
    cursorCommand: function() {
      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
        // These were no-ops, so _userPut never became 1 and checkExecVerbs
        // bailed out on every click -- the whole interface was dead.
        case 1: s._cursorState = 1; break;              // cursor on
        case 2: s._cursorState = 0; break;              // cursor off
        case 3: s._userPut = 1; break;                  // userput on
        case 4: s._userPut = 0; break;                  // userput off
        case 5: s._cursorState++; break;                // cursor soft on
        case 6: s._cursorState--; break;                // cursor soft off
        case 7: s._userPut++; break;                    // userput soft on
        case 8: s._userPut--; break;                    // userput soft off
        case 10: // cursor image
          s.getVarOrDirectByte(PARAM_1); s.getVarOrDirectByte(PARAM_2);
        break;
        case 11: // cursor hotspot
          s.getVarOrDirectByte(PARAM_1); s.getVarOrDirectByte(PARAM_2);
          s.getVarOrDirectByte(PARAM_3);
        break;
        case 12: // cursor set
          s._currentCursor = s.getVarOrDirectByte(PARAM_1);
        break;
        case 13: // charset set
          no = s.getVarOrDirectByte(PARAM_1);
          s.initCharset(no);
        break;
        case 14: // unknown
          // the charset's colour table, kept in _charsetData too so the next
          // initCharset does not undo it
          table = s.getWordVararg();
          var cs = s._string[1]._default.charset;
          if(!s._charsetData[cs]) s._charsetData[cs] = [];
          for(var i = 0; i < 16; i++)
            s._charsetColorMap[i] = s._charsetData[cs][i] = table[i] & 0xFF;
        break;
        default:
          log("unimplemented cursorCommand opcode " + (s._opcode & 0x1F));
        break;
      }
      s.scummVar("cursorstate", s._cursorState);
      s.scummVar("userput", s._userPut);
    },
    setVarRange : function() {
      var a, b;
      s.getResultPos();
      a = s.fetchScriptByte();
      do {
        if(s._opcode & 0x80)
          b = s.fetchScriptWordSigned();
        else
          b = s.fetchScriptByte();
        s.setResult(b);
        s._resultVarNumber++;
      } while(--a);
    },
    stringOps: function() {
      // o5_stringOps. String resources are WritableStreams, so characters
      // can be read and poked by index.
      var a, b, c, ptr;
      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
        case 1: // loadstring
          a = s.getVarOrDirectByte(PARAM_1);
          s.loadPtrToResource("string", a, null);
        break;
        case 2: // copystring
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          s._res.nukeResource("string", a);
          ptr = s.getResourceAddress("string", b);
          if(ptr) s.loadPtrToResource("string", a, ptr.newRelativeStream(0).seek(0, true));
        break;
        case 3: // setStringChar
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          c = s.getVarOrDirectByte(PARAM_3);
          ptr = s.getResourceAddress("string", a);
          if(!ptr) { error("String "+a+" does not exist"); break; }
          ptr.writeByteAt(b, c);
        break;
        case 4: // getStringChar
          s.getResultPos();
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          ptr = s.getResourceAddress("string", a);
          if(!ptr) { error("String "+a+" does not exist"); s.setResult(0); break; }
          s.setResult(ptr.newRelativeStream(0).seek(b, true).readUI8());
        break;
        case 5: // createString
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          s._res.nukeResource("string", a);
          if(b) s._res.createResource("string", a, b, -1);
        break;
        default:
          log("unimplemented stringOps opcode " + (s._opcode & 0x1F));
        break;
      }
    },
    // o5_roomOps (palette effects and transitions in effects.js)
    roomOps: function() {
      var a = 0, b = 0, c, d, e, ptr, half = Math.floor(s._screenWidth / 2);
      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
        case 1: // room scroll: how far the camera may go
          a = s.getVarOrDirectWord(PARAM_1);
          b = s.getVarOrDirectWord(PARAM_2);
          if(a < half) a = half;
          if(b < half) b = half;
          if(a > s._roomWidth - half) a = s._roomWidth - half;
          if(b > s._roomWidth - half) b = s._roomWidth - half;
          s.scummVar("camera_min_x", a);
          s.scummVar("camera_max_x", b);
        break;
        case 3: // room screen
          a = s.getVarOrDirectWord(PARAM_1);
          b = s.getVarOrDirectWord(PARAM_2);
          s.initScreens(a, b);
        break;
        case 4: // room palette
          a = s.getVarOrDirectWord(PARAM_1);
          b = s.getVarOrDirectWord(PARAM_2);
          c = s.getVarOrDirectWord(PARAM_3);
          s._opcode = s.fetchScriptByte();
          d = s.getVarOrDirectByte(PARAM_1);
          s.setPalColor(d, a, b, c);
        break;
        case 5: // shake on
          s.setShake(1);
        break;
        case 6: // shake off
          s.setShake(0);
        break;
        case 7: // room scale
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          s._opcode = s.fetchScriptByte();
          c = s.getVarOrDirectByte(PARAM_1);
          d = s.getVarOrDirectByte(PARAM_2);
          s._opcode = s.fetchScriptByte();
          e = s.getVarOrDirectByte(PARAM_2);
          s.setScaleSlot(e - 1, 0, b, a, 0, d, c);
        break;
        case 8: // room intensity
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          c = s.getVarOrDirectByte(PARAM_3);
          s.darkenPalette(a, a, a, b, c);
        break;
        case 9: // savegame
          s.getVarOrDirectByte(PARAM_1);
          s.getVarOrDirectByte(PARAM_2);
        break;
        case 10: // fade
          a = s.getVarOrDirectWord(PARAM_1);
          if(a) {
            s._switchRoomEffect = a & 0xFF;
            s._switchRoomEffect2 = (a >> 8) & 0xFF;   // (byte), as ScummVM
          } else {
            s.fadeIn(s._newEffect);
          }
        break;
        case 11: // RGB room intensity
        case 12: // room shadow
          a = s.getVarOrDirectWord(PARAM_1);
          b = s.getVarOrDirectWord(PARAM_2);
          c = s.getVarOrDirectWord(PARAM_3);
          var op = s._opcode & 0x1F;
          s._opcode = s.fetchScriptByte();
          d = s.getVarOrDirectByte(PARAM_1);
          e = s.getVarOrDirectByte(PARAM_2);
          if(op == 11) s.darkenPalette(a, b, c, d, e);
          else s.setShadowPalette(a, b, c, d, e, 0, 256);
        break;
        case 13: // save string: Fate of Atlantis keeps its Indy Quotient
                 // points in a file, across games -- here, the browser
          a = s.getVarOrDirectByte(PARAM_1);
          while(s.fetchScriptByte()) {}
          ptr = s.getResourceAddress("string", a);
          if(ptr) {
            b = [];
            for(c = 0; c < 1024; c++) {
              d = ptr.newRelativeStream(0).seek(c, true).readUI8();
              if(!d) break;
              b.push(d);
            }
            try {
              window.localStorage.setItem("jsscummvm." + s._game + ".iq", JSON.stringify(b));
              s.scummVar("soundresult", 0);
            } catch(err) { /* not kept */ }
          }
        break;
        case 14: // load string: the points back
          a = s.getVarOrDirectByte(PARAM_1);
          while(s.fetchScriptByte()) {}
          try { b = JSON.parse(window.localStorage.getItem("jsscummvm." + s._game + ".iq")); } catch(err) { b = null; }
          if(b && b.length) {
            s._res.nukeResource("string", a);
            s._res.createResource("string", a, b.length + 1, -1);
            ptr = s.getResourceAddress("string", a);
            for(c = 0; c < b.length; c++) ptr.writeByteAt(c, b[c]);
            ptr.writeByteAt(b.length, 0);
            s.scummVar("soundresult", 0);
          }
        break;
        case 15: // room transform: fade towards colours held in strings
          a = s.getVarOrDirectByte(PARAM_1);
          s._opcode = s.fetchScriptByte();
          b = s.getVarOrDirectByte(PARAM_1);
          c = s.getVarOrDirectByte(PARAM_2);
          s._opcode = s.fetchScriptByte();
          d = s.getVarOrDirectByte(PARAM_1);
          s.palManipulateInit(a, b, c, d);
        break;
        case 16: // cycle speed
          a = s.getVarOrDirectByte(PARAM_1);
          b = s.getVarOrDirectByte(PARAM_2);
          if(a >= 1 && a <= 16)
            s._colorCycle[a - 1].delay = b != 0 ? Math.floor(0x4000 / (b * 0x4C)) : 0;
        break;
        default:
          error("roomOps: unknown sub-op " + (s._opcode & 0x1F));
        break;
      }
    },
    isEqual: function() {
      var a, b, varId;
      varId = s.fetchScriptWord();
      a = s.readVar(varId);
      b = s.getVarOrDirectWord(PARAM_1);
      // ScummVM's hack for bug #441: MI2 plays Largo's screams only for
      // sound card 5, and other effects only for 3 (what we report)
      if(s._game == "monkey2" && varId == 48 && b == 5) b = a;
      s.jumpRelative(b == a);
    },
    isGreater: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b > a);
    },
    isGreaterEqual: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b >= a);
    },
    isLess: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b < a);
    },
    isLessEqual: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b <= a);
    },
    isNotEqual: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b != a);
    },
    /* --- ported from ScummVM script_v5.cpp -------------------------------- */

    multiply: function() {
      s.getResultPos();
      var a = s.getVarOrDirectWord(PARAM_1);
      s.setResult(s.readVar(s._resultVarNumber) * a);
    },
    divide: function() {
      s.getResultPos();
      var a = s.getVarOrDirectWord(PARAM_1);
      if (a == 0) { error("Divide by zero"); s.setResult(0); }
      else s.setResult(Math.trunc(s.readVar(s._resultVarNumber) / a));   // C division
    },
    or: function() {
      s.getResultPos();
      var a = s.getVarOrDirectWord(PARAM_1);
      s.setResult(s.readVar(s._resultVarNumber) | a);
    },
    decrement: function() {
      s.getResultPos();
      s.setResult(s.readVar(s._resultVarNumber) - 1);
    },
    isGreaterEqual: function() {
      var a = s.getVar(), b = s.getVarOrDirectWord(PARAM_1);
      s.jumpRelative(b >= a);
    },

    ifState: function() {
      var a = s.getVarOrDirectWord(PARAM_1), b = s.getVarOrDirectByte(PARAM_2);
      s.jumpRelative(s.getState(a) == b);
    },
    ifNotState: function() {
      var a = s.getVarOrDirectWord(PARAM_1), b = s.getVarOrDirectByte(PARAM_2);
      s.jumpRelative(s.getState(a) != b);
    },
    ifClassOfIs: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), cls, b, cond = true;
      while ((s._opcode = s.fetchScriptByte()) != 0xFF) {
        cls = s.getVarOrDirectWord(PARAM_1);
        b = s.getClass(obj, cls);
        if (((cls & 0x80) && !b) || (!(cls & 0x80) && b)) cond = false;
      }
      s.jumpRelative(cond);
    },

    getActorX: function() {
      s.getResultPos();
      s.setResult(s.getObjX(s.getVarOrDirectWord(PARAM_1)));
    },
    getActorY: function() {
      s.getResultPos();
      s.setResult(s.getObjY(s.getVarOrDirectWord(PARAM_1)));
    },
    getActorWidth: function() {
      s.getResultPos();
      s.setResult(s.getActor(s.getVarOrDirectByte(PARAM_1)).width);
    },
    getActorScale: function() {
      s.getResultPos();
      s.setResult(s.getActor(s.getVarOrDirectByte(PARAM_1)).scalex);
    },
    getActorCostume: function() {
      s.getResultPos();
      s.setResult(s.getActor(s.getVarOrDirectByte(PARAM_1)).costume);
    },
    getActorWalkBox: function() {
      s.getResultPos();
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1));
      // v5's "no box" is 0; this port keeps 0xFF internally
      s.setResult(a.ignoreBoxes || s.isInvalidBox(a.walkbox) ? 0 : a.walkbox);
    },
    getAnimCounter: function() {
      s.getResultPos();
      s.setResult(s.getActor(s.getVarOrDirectByte(PARAM_1)).cost.animCounter);
    },
    isActorInBox: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)),
          box = s.getVarOrDirectByte(PARAM_2);
      // the box's geometry, not the box the actor was last assigned
      s.jumpRelative(s.checkXYInBoxBounds(box, a.pos.x, a.pos.y));
    },

    putActorAtObject: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)),
          obj = s.getVarOrDirectWord(PARAM_2), p = null;
      if (s.whereIsObject(obj) != -1) p = s.getObjectOrActorXY(obj);
      if (!p) p = {x: 240, y: 120};
      a.putActor(p.x, p.y);
    },

    loadRoomWithEgo: function() {
      var obj = s.getVarOrDirectWord(PARAM_1),
          room = s.getVarOrDirectByte(PARAM_2),
          a = s.getActor(s.scummVar("ego")), x, y;

      a.putActor(a.pos.x, a.pos.y, room);
      s._egoPositioned = false;

      x = s.fetchScriptWordSigned();
      y = s.fetchScriptWordSigned();

      s.scummVar("walkto_obj", obj);
      s.startScene(a.room, a, obj);
      s.scummVar("walkto_obj", 0);

      s._camera.cur.x = s._camera.dest.x = a.pos.x;
      s.setCameraFollows(a);
      s._fullRedraw = true;

      if (x != -1) a.startWalkActor(x, y, -1);
    },

    stopObjectScript: function() {
      s.stopObjectScript(s.getVarOrDirectWord(PARAM_1));
    },
    stopMusic: function() {
      s.stopAllSounds();
    },

    getInventoryCount: function() {
      s.getResultPos();
      s.setResult(s.getInventoryCount(s.getVarOrDirectByte(PARAM_1)));
    },
    findInventory: function() {
      s.getResultPos();
      var owner = s.getVarOrDirectByte(PARAM_1),
          idx = s.getVarOrDirectByte(PARAM_2);
      s.setResult(s.findInventory(owner, idx));
    },
    getStringWidth: function() {
      var str, cs, msg, codes = [], i;
      s.getResultPos();
      str = s.getVarOrDirectByte(PARAM_1);
      msg = s.getResourceMessage("string", str) || "";
      for(i = 0; i < msg.length; i++) codes.push(msg.charCodeAt(i) & 0xFF);
      codes.push(0);
      cs = s.getCharsetRenderer(s._string[0].charset);
      s.setResult(cs ? s.textWidth(cs, codes, 0) : 0);
    },

    delayVariable: function() {
      s._vm.slot[s._currentScript].delay = s.getVar();
      s._vm.slot[s._currentScript].status = "paused";
      s._opcodeCommands.breakHere();
    },

    matrixOps: function() {
      var a, b;
      s._opcode = s.fetchScriptByte();
      switch (s._opcode & 0x1F) {
        case 1: a = s.getVarOrDirectByte(PARAM_1); b = s.getVarOrDirectByte(PARAM_2);
                s.setBoxFlags(a, b); break;
        case 2: a = s.getVarOrDirectByte(PARAM_1); b = s.getVarOrDirectByte(PARAM_2);
                s.setBoxScale(a, b); break;
        case 3: a = s.getVarOrDirectByte(PARAM_1); b = s.getVarOrDirectByte(PARAM_2);
                s.setBoxScale(a, (b - 1) | 0x8000); break;
        case 4: s.createBoxMatrix(); break;
      }
    },

    getClosestObjActor: function() {
      // ScummVM walks the object list looking for the nearest; without the
      // object list wired up this returns "none" rather than a wrong answer
      var act, obj, dist, closest = 0xFF, closestDist = 0xFF;
      s.getResultPos();
      act = s.getVarOrDirectWord(PARAM_1);
      obj = s.scummVar("actor_range_max");
      do {
        dist = s.getObjActToObjActDist(act, obj);
        if(dist < closestDist) {
          closestDist = dist;
          closest = obj;
        }
      } while(--obj >= s.scummVar("actor_range_min"));
      s.setResult(closest);
    },

    oldRoomEffect: function() {
      s._opcode = s.fetchScriptByte();
      s.getVarOrDirectWord(PARAM_1);
    },
    pickupObjectOld: function() {
      s.getVarOrDirectWord(PARAM_1);
    },
    debug: function() {
      s.getVarOrDirectWord(PARAM_1);
    },
    dummy: function() {
    },
    move_segafix: function() {
      s.getVarOrDirectByte(PARAM_1);
    },

    unimplementedOpcode: unimplementedOpcode,
    getActorMoving: function() {
      var act;
      s.getResultPos();
      act = s.getActor(s.getVarOrDirectByte(PARAM_1));
      s.setResult(act.moving);
      log("getActorMoving");
    },
    getActorFacing: function() {
      var act;
      s.getResultPos();
      act = s.getActor(s.getVarOrDirectByte(PARAM_1));
      s.setResult(_system.newDirToOldDir(act.facing));   // 0-3, not degrees
    },
    stopObjectCode: function() {
      s.stopObjectCode();
    },
    stopScript: function() {
      var script = s.getVarOrDirectByte(PARAM_1);
      if(!script) s.stopObjectCode();
      else s.stopScript(script);
    },
    notEqualZero: function() {
      var a = s.getVar();
      s.jumpRelative(a != 0);
    },
    equalZero: function() {
      var a = s.getVar();
      s.jumpRelative(a == 0);
    },
    expression: function() {
      var dst, i;
      s._scummStackPos = 0;
      s.getResultPos();
      dst = s._resultVarNumber;
      while((s._opcode = s.fetchScriptByte()) != 0xFF) {
        switch(s._opcode & 0x1F) {
          case 1: // varordirect
            s.push(s.getVarOrDirectWord(PARAM_1));
          break;
          case 2: // add
            i = s.pop();
            s.push(s.pop() + i);
          break;
          case 3: // sub
            i = s.pop();
            s.push(s.pop() - i);
          break;
          case 4: // mul
            i = s.pop();
            s.push(i * s.pop());
          break;
          case 5: // div
            i = s.pop();
            if(i == 0)
              error("Divide by zero");
            s.push(Math.trunc(s.pop() / i));  // C integer division
          break;
          case 6: // normal
            s._opcode = s.fetchScriptByte();
            s.executeOpcode(s._opcode);
            s.push(s.scummVar("keypress"));
          break;
          default:
            log("unimplemented expression opcode " + (s._opcode & 0x1F));
          break;
        }
      }
      // The nested opcodes above set _resultVarNumber for their own results;
      // restore ours and store what is left on the stack. This was missing,
      // so every expression was evaluated and thrown away.
      s._resultVarNumber = dst;
      s.setResult(s.pop());
    },
    verbOps: function() {
      // ported from o5_verbOps -- it used to parse all of this and throw it
      // away, which is why _verbs stayed empty and nothing was ever clickable
      var verb = s.getVarOrDirectByte(PARAM_1),
          slot = s.getVerbSlot(verb, 0), vs, a, b;

      if (slot < 0 || slot >= s._nums['verbs']) { error("bad verb slot " + slot); return; }
      vs = s._verbs[slot];
      vs.verbid = verb;

      while ((s._opcode = s.fetchScriptByte()) != 0xFF) {
        switch (s._opcode & 0x1F) {
          case 1:  // image
            a = s.getVarOrDirectWord(PARAM_1);
            if (slot) {
              s.setVerbObject(s._roomResource, a, slot);
              vs.type = kImageVerbType;
            }
            break;
          case 2:  // name
            s.loadPtrToResource("verb", slot, null);
            if (slot == 0) s._res.nukeResource("verb", slot);
            vs.text = s.getVerbText(slot);
            vs.type = kTextVerbType;
            vs.imgindex = 0;
            break;
          case 3:  vs.color = s.getVarOrDirectByte(PARAM_1); break;
          case 4:  vs.hicolor = s.getVarOrDirectByte(PARAM_1); break;
          case 5:  // verb at
            vs.curRect.left = s.getVarOrDirectWord(PARAM_1);
            vs.curRect.top = s.getVarOrDirectWord(PARAM_2);
            vs.origLeft = vs.curRect.left;
            break;
          case 6:  vs.curmode = 1; break;                 // on
          case 7:  vs.curmode = 0; break;                 // off
          case 8:  s.killVerb(slot); break;               // delete
          case 9:  // new
            slot = s.getVerbSlot(verb, 0);
            if (slot == 0) {
              for (slot = 1; slot < s._nums['verbs']; slot++)
                if (s._verbs[slot].verbid == 0) break;
              if (slot == s._nums['verbs']) { error("Too many verbs"); return; }
            }
            vs = s._verbs[slot];
            vs.verbid = verb;
            vs.color = 2; vs.hicolor = 0; vs.dimcolor = 8;
            vs.type = kTextVerbType;
            vs.charset_nr = s._string[0]._default.charset;
            vs.curmode = 0; vs.saveid = 0; vs.key = 0;
            vs.center = false; vs.imgindex = 0; vs.text = "";
            break;
          case 16: vs.dimcolor = s.getVarOrDirectByte(PARAM_1); break;
          case 17: vs.curmode = 2; break;                 // dim
          case 18: vs.key = s.getVarOrDirectByte(PARAM_1); break;
          case 19: vs.center = true; break;
          case 20: // name from string resource
            a = s.getResourceAddress("string", s.getVarOrDirectWord(PARAM_1));
            if (!a) s._res.nukeResource("verb", slot);
            else s.loadPtrToResource("verb", slot, a.newRelativeStream(0).seek(0, true));
            if (slot == 0) s._res.nukeResource("verb", slot);
            vs.text = s.getVerbText(slot);
            vs.type = kTextVerbType;
            vs.imgindex = 0;
            break;
          case 22: // assign object: an image from another room
            a = s.getVarOrDirectWord(PARAM_1);
            b = s.getVarOrDirectByte(PARAM_2);
            if (slot && vs.imgindex != a) {
              s.setVerbObject(b, a, slot);
              vs.type = kImageVerbType;
              vs.imgindex = a;
            }
            break;
          case 23: vs.bkcolor = s.getVarOrDirectByte(PARAM_1); break;
          default:
            log("unimplemented verbOps opcode " + (s._opcode & 0x1F));
            break;
        }
      }
      s.setVerbRect(vs);
    },
    wait: function() {
      var oldoffset = s._scriptPointer.offset - 1;

      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
        case 1: // wait for actor
          var a = s.getActor(s.getVarOrDirectByte(PARAM_1));
          if(a && a.moving) {
            // log("wait for actor "+a.number);
            break;
          }
          // log("done waiting for actor "+a.number);
          return;
        break;
        case 2: // wait for message
          if(s.scummVar("have_msg"))
            break;
          return;
        break;
        case 3: // wait for camera
          if(Math.floor(s._camera.cur.x / 8) != Math.floor(s._camera.dest.x / 8))
            break;
          return;
        break;
        case 4: // wait for sentence: until the queue is empty and the
                // sentence script has finished
          if(s._sentenceNum) {
            if(s._sentence[s._sentenceNum - 1].freezeCount &&
               !s.isScriptInUse(s.scummVar("sentence_script")))
              return;
          } else if(!s.isScriptInUse(s.scummVar("sentence_script")))
            return;
        break;
        default:
          log("unknown wait opcode 0x"+(s._opcode & 0x1F));
      }

      s._scriptPointer.offset = oldoffset;
      s._opcodeCommands.breakHere();
    },
    drawObject: function() {
      var state = 1, obj, idx, i, xpos = 255, ypos = 255, x, y, w, h, od, o;

      obj = s.getVarOrDirectWord(PARAM_1);
      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
        case 0:
          xpos = s.getVarOrDirectWord(PARAM_1);
          ypos = s.getVarOrDirectWord(PARAM_2);
          // log("drawObject "+obj+" opcode 0 "+xpos+"/"+ypos);
          return;
        break;
        case 1: // draw at
          xpos = s.getVarOrDirectWord(PARAM_1);
          ypos = s.getVarOrDirectWord(PARAM_2);
        break;
        case 2: // set state
          state = s.getVarOrDirectWord(PARAM_1);
        break;
        case 0x1F:
        break;
        default:
          log("unimplemented drawObject opcode " + (s._opcode & 0x1F));
        break;
      }
      idx = s.getObjectIndex(obj);
      if(idx == -1) return;

      od = s._objs[idx];
      if(xpos != 0xFF) {
        // draw at: move the object (and where you walk to for it), in strips
        od.walk_x += (xpos * 8) - od.x_pos;
        od.x_pos = xpos * 8;
        od.walk_y += (ypos * 8) - od.y_pos;
        od.y_pos = ypos * 8;
      }
      s.addObjectToDrawQueue(idx);

      x = od.x_pos; y = od.y_pos; w = od.width; h = od.height;

      i = s._objs.length - 1;
      do {
        o = s._objs[i];
        if(o && o.obj_nr && o.x_pos == x && o.y_pos == y && o.width == w && o.height == h) {
          s.putState(o.obj_nr, 0);
        }
      } while(--i);
      s.putState(obj, state);
    },
    setState: function() {
      var obj, state;
      obj = s.getVarOrDirectWord(PARAM_1);
      state = s.getVarOrDirectByte(PARAM_2);
      s.putState(obj, state);
      s.markObjectRectAsDirty(obj);
      if(s._bgNeedsRedraw)
        s.clearDrawObjectQueue();
    },
    getActorElevation: function() {
      var act;
      s.getResultPos();
      act = s.getActor(s.getVarOrDirectByte(PARAM_1));
      s.setResult(act ? act.elevation : 0);
    },
    drawBox: function() {
      var x,y,x2,y2, color;
      x = s.getVarOrDirectWord(PARAM_1);
      y = s.getVarOrDirectWord(PARAM_2);
      s._opcode = s.fetchScriptByte();
      x2 = s.getVarOrDirectWord(PARAM_1);
      y2 = s.getVarOrDirectWord(PARAM_2);
      color = s.getVarOrDirectByte(PARAM_3);
      s.drawBox(x, y, x2, y2, color);
    },
    pseudoRoom: function() {
      var i = s.fetchScriptByte(), j;
      while((j = s.fetchScriptByte()) != 0) {
        if(j >= 0x80) {
          //resourceMapper stuff
        }
      }
    },
    setOwnerOf: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), owner = s.getVarOrDirectByte(PARAM_2);
      s.setOwnerOf(obj, owner);
    },
    getRandomNr: function() {
      s.getResultPos();
      // inclusive of the maximum, as ScummVM's getRandomNumber is
      s.setResult(Math.floor(Math.random()*(s.getVarOrDirectByte(PARAM_1) + 1)));
    },
    // o5_actorOps. Every sub-op has to consume its operands, or the rest of
    // the list is read out of step.
    actorOps: function() {
      var a = s.getVarOrDirectByte(PARAM_1), act = s.getActor(a), i, j, op;

      while((s._opcode = s.fetchScriptByte()) != 0xFF) {
        op = s._opcode & 0x1F;
        switch(op) {
          case 0: // dummy
            s.getVarOrDirectByte(PARAM_1);
          break;
          case 1: // costume
            act.setActorCostume(s.getVarOrDirectByte(PARAM_1));
          break;
          case 2: // step dist
            i = s.getVarOrDirectByte(PARAM_1);
            j = s.getVarOrDirectByte(PARAM_2);
            act.setActorWalkSpeed(i, j);
          break;
          case 3: // sound
            act.sound = s.getVarOrDirectByte(PARAM_1);
          break;
          case 4: // walk animation
            act.walkFrame = s.getVarOrDirectByte(PARAM_1);
          break;
          case 5: // talk animation
            act.talkStartFrame = s.getVarOrDirectByte(PARAM_1);
            act.talkStopFrame = s.getVarOrDirectByte(PARAM_2);
          break;
          case 6: // stand animation
            act.standFrame = s.getVarOrDirectByte(PARAM_1);
          break;
          case 7: // animation
            s.getVarOrDirectByte(PARAM_1);
            s.getVarOrDirectByte(PARAM_2);
            s.getVarOrDirectByte(PARAM_3);
          break;
          case 8: // default
            act.initActor(0);
          break;
          case 9: // elevation
            i = s.getVarOrDirectWord(PARAM_1);
            if(i >= 0x8000) i -= 0x10000;
            if(act.elevation != i) {
              act.elevation = i;
              act.needRedraw = true;
            }
          break;
          case 10: // animation default
            act.initFrame = 1;
            act.walkFrame = 2;
            act.standFrame = 3;
            act.talkStartFrame = 4;
            act.talkStopFrame = 5;
          break;
          case 11: // palette
            i = s.getVarOrDirectByte(PARAM_1);
            j = s.getVarOrDirectByte(PARAM_2);
            act.setPalette(i, j);
          break;
          case 12: // talk color
            act.talkColor = s.getVarOrDirectByte(PARAM_1);
          break;
          case 13: // actor name
            s.loadPtrToResource("actor_name", a, null);
          break;
          case 14: // init animation
            act.initFrame = s.getVarOrDirectByte(PARAM_1);
          break;
          case 16: // actor width
            act.width = s.getVarOrDirectByte(PARAM_1);
          break;
          case 17: // actor scale
            i = s.getVarOrDirectByte(PARAM_1);
            j = s.getVarOrDirectByte(PARAM_2);
            act.boxscale = i;
            act.setScale(i, j);
          break;
          case 18: // never zclip
            act.forceClip = 0;
          break;
          case 19: // always zclip
            act.forceClip = s.getVarOrDirectByte(PARAM_1);
          break;
          case 20: // ignore boxes
          case 21: // follow boxes
            // This read `s.opcode`, which is undefined, so "follow boxes" also
            // turned box-following off and actors walked through walls.
            act.ignoreBoxes = !(s._opcode & 1);
            act.forceClip = 0;
            if(act.isInCurrentRoom())
              act.putActor();
          break;
          case 22: // animation speed
            act.animSpeed = s.getVarOrDirectByte(PARAM_1);
            act.animProgress = 0;
          break;
          case 23: // shadow
            act.shadow_mode = s.getVarOrDirectByte(PARAM_1);
          break;
          default:
            error("actorOps: unknown sub-op " + op);
          break;
        }
      }
    },
    breakHere: function() {
      s.updateScriptPtr();
      s._currentScript = 0xFF;
    },
    jumpRelative: function() {
      s.jumpRelative(false);
    },
    loadRoom: function() {
      var room = s.getVarOrDirectByte(PARAM_1);
      s.startScene(room, 0, 0);
      s._fullRedraw = true;
    },
    print: function() {
      s._actorToPrintStrFor = s.getVarOrDirectByte(PARAM_1);
      s.decodeParseString();
    },
    printEgo: function() {
      s._actorToPrintStrFor = s.scummVar("ego");
      s.decodeParseString();
    },
    putActorInRoom: function() {
      var a = s.getVarOrDirectByte(PARAM_1), act = s.getActor(a), room = s.getVarOrDirectByte(PARAM_2);
      if(!act) { window.console.log("put actor "+a+" into room "+room+" failed"); return; }
      // o5_putActorInRoom
      if(act.visible && s._currentRoom != room && s.getTalkingActor() == act.number)
        s.stopTalk();
      act.room = room;
      if(!room)
        act.putActor(0, 0, 0);
    },
    putActor: function() {
      var act = s.getActor(s.getVarOrDirectByte(PARAM_1)), x = s.getVarOrDirectWord(PARAM_2), y = s.getVarOrDirectWord(PARAM_3);
      if(act) act.putActor(x, y);
    },
    actorFollowCamera: function() {
      s.actorFollowCamera(s.getVarOrDirectByte(PARAM_1));
    },
    animateActor: function() {
      var act = s.getActor(s.getVarOrDirectByte(PARAM_1)), anim = s.getVarOrDirectByte(PARAM_2);

      if(act) act.animateActor(anim);
    },
    cutscene: function() {
      var args = s.getWordVararg();
      s.beginCutscene(args);
    },
    endCutscene: function() {
      s.endCutscene();
    },
    isScriptRunning: function() {
      s.getResultPos();
      var script = s.getVarOrDirectByte(PARAM_1), running = s.isScriptRunning(script);
      s.setResult(running ? 1 : 0);
      // ScummVM workaround (bug #346, also in the original): in room 25
      // script 204 can stop an inventory object's script in the middle of
      // its cutscene. Report "still running" while one is in a cutscene.
      if(s._currentRoom == 25 && s.currentScriptNumber() == 204 && s.inventoryScriptInCutscene())
        s.setResult(1);
    },
    setCameraAt: function() {
      s.setCameraAtEx(s.getVarOrDirectWord(PARAM_1));
      // s._screenEndStrip = s._gdi.numStrips - 1;
    },
    startSound: function() {
      var start = s._scriptPointer.offset - 1, sound = s.getVarOrDirectByte(PARAM_1);
      // ScummVM: in MI2, Largo talking to the bartender (103) or Mad Marty
      // (110) waits for Largo's theme (151) to finish -- try again next
      // frame
      if(s._game == "monkey2" && (sound == 103 || sound == 110) && s.isSoundRunning(151)) {
        s._scriptPointer.offset = start;
        s._opcodeCommands.breakHere();
        return;
      }
      s.scummVar("music_timer", 0);
      s.startSound(sound);
    },
    stopSound: function() {
      s.stopSound(s.getVarOrDirectByte(PARAM_1));
    },
    faceActor: function() {
      var act = s.getActor(s.getVarOrDirectByte(PARAM_1)), obj = s.getVarOrDirectWord(PARAM_2);
      if(act) act.faceToObject(obj);
    },
    systemOps: function() {
      var subOp = s.fetchScriptByte();
      switch(subOp) {
        default:
          log("unimplemented systemOps opcode " + subOp);
      }
      // a.faceToObject(obj)
    },
    and: function() {
      var a;
      s.getResultPos();
      a = s.getVarOrDirectWord(PARAM_1);
      s.setResult(s.readVar(s._resultVarNumber) & a);
    },
    getVerbEntryPoint: function() {
      var a, b;
      s.getResultPos();
      a = s.getVarOrDirectWord(PARAM_1);
      b = s.getVarOrDirectWord(PARAM_2);
      s.setResult(s.getVerbEntryPoint(a, b));
    },
    getDist: function() {
      var a, b;
      s.getResultPos();
      a = s.getVarOrDirectWord(PARAM_1);
      b = s.getVarOrDirectWord(PARAM_2);
      s.setResult(s.getObjActToObjActDist(a, b));
    },
    panCameraTo: function() {
      s.panCameraTo(s.getVarOrDirectWord(PARAM_1), 0);
    },
    pickupObject: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), room = s.getVarOrDirectByte(PARAM_2);
      if(room == 0) room = s._roomResource;
      // o5_pickupObject
      s.addObjectToInventory(obj, room);
      s.putOwner(obj, s.scummVar("ego"));
      s.putClass(obj, kObjectClassUntouchable, true);
      s.putState(obj, 1);
      s.markObjectRectAsDirty(obj);
      s.clearDrawObjectQueue();
      s.runInventoryScript(1);
    },
    lights: function() {
      var a = s.getVarOrDirectByte(PARAM_1), b = s.fetchScriptByte(), c = s.fetchScriptByte();
      if(c == 0)
        s.scummVar('current_lights', a);
      else if(c == 1) {
        // flashlight
      }
      s._fullRedraw = true;
    },
    increment: function() {
      s.getResultPos();
      s.setResult(s.readVar(s._resultVarNumber) + 1);
    },
    doSentence: function() {
      var verb = s.getVarOrDirectByte(PARAM_1);
      if(verb == 0xFE) {
        s._sentenceNum = 0;
        s.stopScript(s.scummVar("sentence_script"));
        s.clearClickedStatus();
        return;
      }
      var objectA = s.getVarOrDirectWord(PARAM_2), objectB = s.getVarOrDirectWord(PARAM_3);
      s.doSentence(verb, objectA, objectB);
    },
    delay: function() {
      var delay = s.fetchScriptByte();
      delay |= s.fetchScriptByte() << 8;
      delay |= s.fetchScriptByte() << 16;
      s._vm.slot[s._currentScript].delay = delay;
      s._vm.slot[s._currentScript].status = "paused";
      s._opcodeCommands.breakHere();
    },
    walkActorTo: function() {
      var a = s.getVarOrDirectByte(PARAM_1),
          act = s.getActor(a),
          x = s.getVarOrDirectWord(PARAM_2),
          y = s.getVarOrDirectWord(PARAM_3);

      act.startWalkActor(x, y, -1);
    },
    walkActorToActor: function() {
      var nr = s.getVarOrDirectByte(PARAM_1),
          nr2 = s.getVarOrDirectByte(PARAM_2),
          dist = s.fetchScriptByte(), a, to, x, y;

      // o5_walkActorToActor / walkActorToActor
      a = s.getActor(nr);
      to = s.getActor(nr2);
      if(!a || !a.isInCurrentRoom() || !to || !to.isInCurrentRoom()) return;
      if(dist == 0xFF) {
        dist = Math.trunc(a.scalex * a.width / 0xFF);
        dist += Math.trunc(Math.trunc(to.scalex * to.width / 0xFF) / 2);
      }
      x = to.pos.x;
      y = to.pos.y;
      if(x < a.pos.x) x += dist;
      else x -= dist;
      a.startWalkActor(x, y, -1);
    },
    walkActorToObject: function() {
      var a, obj, act, pos;
      a = s.getVarOrDirectByte(PARAM_1);
      obj = s.getVarOrDirectWord(PARAM_2);
      act = s.getActor(a);
      if(s.whereIsObject(obj) == WIO_NOT_FOUND) return;
      pos = s.getObjectXYPos(obj);
      act.startWalkActor(pos.x, pos.y, pos.dir);
    },
    startMusic: function() {
      s.startSound(s.getVarOrDirectByte(PARAM_1));
    },
    beginOverride: function() {
      if(s.fetchScriptByte() != 0)
        s.beginOverride();
      else
        s.endOverride();
    },
    getObjectOwner: function() {
      s.getResultPos();
      s.setResult(s.getOwner(s.getVarOrDirectWord(PARAM_1)));
    },
    getObjectState: function() {
      s.getResultPos();
      s.setResult(s.getState(s.getVarOrDirectWord(PARAM_1)));
    },
    chainScript: function() {
      var vm = s._vm, script, cur, vars;
      script = s.getVarOrDirectByte(PARAM_1);
      vars = s.getWordVararg();
      cur = s._currentScript;
      vm.slot[cur].number = 0;
      vm.slot[cur].status = "dead";
      s._currentScript = 0xFF;
      s.runScript(script, vm.slot[cur].freezeResistant, vm.slot[cur].recursive, vars);
    },
    // o5_saveRestoreVerbs: how the game hides the verbs for cutscenes and
    // conversations and brings them back. A saved verb (saveid != 0) is not
    // drawn or clickable; this used to parse its operands and do nothing.
    saveRestoreVerbs: function() {
      var a, b, c, slot, slot2, op;
      op = s._opcode = s.fetchScriptByte();
      a = s.getVarOrDirectByte(PARAM_1);
      b = s.getVarOrDirectByte(PARAM_2);
      c = s.getVarOrDirectByte(PARAM_3);
      switch(op) {
        case 1: // save
          for(; a <= b; a++) {
            slot = s.getVerbSlot(a, 0);
            if(slot && s._verbs[slot].saveid == 0)
              s._verbs[slot].saveid = c;
          }
        break;
        case 2: // restore
          for(; a <= b; a++) {
            slot = s.getVerbSlot(a, c);
            if(slot) {
              slot2 = s.getVerbSlot(a, 0);
              if(slot2) s.killVerb(slot2);
              slot = s.getVerbSlot(a, c);
              s._verbs[slot].saveid = 0;
            }
          }
        break;
        case 3: // delete
          for(; a <= b; a++) {
            slot = s.getVerbSlot(a, c);
            if(slot) s.killVerb(slot);
          }
        break;
        default:
          error("saveRestoreVerbs: unknown subopcode " + op);
      }
    },
    setClass: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), newClass;

      // o5_setClass: class 0 clears them all, bit 7 sets rather than clears
      while((s._opcode = s.fetchScriptByte()) != 0xFF) {
        newClass = s.getVarOrDirectWord(PARAM_1);
        if(newClass == 0) {
          s._classData[obj] = 0;
          continue;
        }
        s.putClass(obj, newClass, (newClass & 0x80) != 0);
      }
    },
    add: function() {
      var a;
      s.getResultPos();
      a = s.getVarOrDirectWord(PARAM_1);
      s.setResult(s.readVar(s._resultVarNumber) + a);
    },
    subtract: function() {
      var a;
      s.getResultPos();
      a = s.getVarOrDirectWord(PARAM_1);
      s.setResult(s.readVar(s._resultVarNumber) - a);
    },
    freezeScripts: function() {
      var scr = s.getVarOrDirectByte(PARAM_1);
      if(scr != 0) s.freezeScripts(scr);
      else s.unfreezeScripts();
    },
    isSoundRunning: function() {
      var snd;
      s.getResultPos();
      snd = s.getVarOrDirectByte(PARAM_1);
      if(snd) snd = s.isSoundRunning(snd);
      s.setResult(snd);
    },
    getActorRoom: function() {
      var act;
      s.getResultPos();
      act = s.getActor(s.getVarOrDirectByte(PARAM_1));
      if(act) s.setResult(act.room);
      else s.setResult(0);
    },
    soundKludge: function() {
      var items;
      items = s.getWordVararg();
      s.soundKludge(items);
    },
    setObjectName: function() {
      // ScummVM workaround (bug #10571, also in the original): script 68
      // renames the grog mugs, which restarts inventory scripts -- wait out
      // any that is in a cutscene (the kidnap note) instead of killing it
      if(s.currentScriptNumber() == 68 && s.inventoryScriptInCutscene()) {
        s._scriptPointer.seek(-1);
        s._opcodeCommands.breakHere();
        return;
      }
      s.setObjectName(s.getVarOrDirectWord(PARAM_1));
    },
    findObject: function() {
      var x, y;
      s.getResultPos();
      x = s.getVarOrDirectByte(PARAM_1);
      y = s.getVarOrDirectByte(PARAM_2);
      s.setResult(s.findObject(x, y));
    },
    actorFromPos: function() {
      var x, y;
      s.getResultPos();
      x = s.getVarOrDirectWord(PARAM_1);
      y = s.getVarOrDirectWord(PARAM_2);
      s.setResult(s.getActorFromPos(x, y));
    }
  };

  // The full 256-entry table, generated from ScummVM's own OPCODE list in
  // script_v5.cpp. The high bits of the opcode select whether each argument
  // is a literal or a variable, so one instruction occupies several slots and
  // every one of them has to be registered -- executeOpcode kills the running
  // script on an unregistered byte, which is what used to happen whenever a
  // script walked an actor with a variable argument.
  // The full 256-entry table, generated from the base v5 OPCODE list in
  // ScummVM's script_v5.cpp (that file also carries a Sega CD override block
  // further down, which must NOT be folded in -- it remaps 0x1a away from
  // o5_move). The high bits of an opcode select whether each argument is a
  // literal or a variable, so one instruction occupies several slots and all
  // of them must be registered: executeOpcode kills the running script on an
  // unregistered byte. The entries ScummVM comments out for v5 (0x2f/0x6f/
  // 0xaf/0xef, 0x4f/0xcf, 0x45/0xc5, 0x50/0xd0, 0x5c/0xdc) are left out too:
  // a valid script never uses them, so reaching one means the stream is out
  // of step, and stopping says so.
  // The opcode table of v5 games, by opcode byte (script_v5.cpp
  // setupOpcodes). scumm.js runs the table of the game's version.
  s._opcodeTables = s._opcodeTables || {};
  s._opcodeTables[5] = {
    0x00: s._opcodeCommands.stopObjectCode,
    0x01: s._opcodeCommands.putActor,
    0x02: s._opcodeCommands.startMusic,
    0x03: s._opcodeCommands.getActorRoom,
    0x04: s._opcodeCommands.isGreaterEqual,
    0x05: s._opcodeCommands.drawObject,
    0x06: s._opcodeCommands.getActorElevation,
    0x07: s._opcodeCommands.setState,
    0x08: s._opcodeCommands.isNotEqual,
    0x09: s._opcodeCommands.faceActor,
    0x0a: s._opcodeCommands.startScript,
    0x0b: s._opcodeCommands.getVerbEntryPoint,
    0x0c: s._opcodeCommands.resourceRoutines,
    0x0d: s._opcodeCommands.walkActorToActor,
    0x0e: s._opcodeCommands.putActorAtObject,
    0x0f: s._opcodeCommands.getObjectState,
    0x10: s._opcodeCommands.getObjectOwner,
    0x11: s._opcodeCommands.animateActor,
    0x12: s._opcodeCommands.panCameraTo,
    0x13: s._opcodeCommands.actorOps,
    0x14: s._opcodeCommands.print,
    0x15: s._opcodeCommands.actorFromPos,
    0x16: s._opcodeCommands.getRandomNr,
    0x17: s._opcodeCommands.and,
    0x18: s._opcodeCommands.jumpRelative,
    0x19: s._opcodeCommands.doSentence,
    0x1a: s._opcodeCommands.move,
    0x1b: s._opcodeCommands.multiply,
    0x1c: s._opcodeCommands.startSound,
    0x1d: s._opcodeCommands.ifClassOfIs,
    0x1e: s._opcodeCommands.walkActorTo,
    0x1f: s._opcodeCommands.isActorInBox,
    0x20: s._opcodeCommands.stopMusic,
    0x21: s._opcodeCommands.putActor,
    0x22: s._opcodeCommands.getAnimCounter,
    0x23: s._opcodeCommands.getActorY,
    0x24: s._opcodeCommands.loadRoomWithEgo,
    0x25: s._opcodeCommands.pickupObject,
    0x26: s._opcodeCommands.setVarRange,
    0x27: s._opcodeCommands.stringOps,
    0x28: s._opcodeCommands.equalZero,
    0x29: s._opcodeCommands.setOwnerOf,
    0x2a: s._opcodeCommands.startScript,
    0x2b: s._opcodeCommands.delayVariable,
    0x2c: s._opcodeCommands.cursorCommand,
    0x2d: s._opcodeCommands.putActorInRoom,
    0x2e: s._opcodeCommands.delay,
    0x30: s._opcodeCommands.matrixOps,
    0x31: s._opcodeCommands.getInventoryCount,
    0x32: s._opcodeCommands.setCameraAt,
    0x33: s._opcodeCommands.roomOps,
    0x34: s._opcodeCommands.getDist,
    0x35: s._opcodeCommands.findObject,
    0x36: s._opcodeCommands.walkActorToObject,
    0x37: s._opcodeCommands.startObject,
    0x38: s._opcodeCommands.isLessEqual,
    0x39: s._opcodeCommands.doSentence,
    0x3a: s._opcodeCommands.subtract,
    0x3b: s._opcodeCommands.getActorScale,
    0x3c: s._opcodeCommands.stopSound,
    0x3d: s._opcodeCommands.findInventory,
    0x3e: s._opcodeCommands.walkActorTo,
    0x3f: s._opcodeCommands.drawBox,
    0x40: s._opcodeCommands.cutscene,
    0x41: s._opcodeCommands.putActor,
    0x42: s._opcodeCommands.chainScript,
    0x43: s._opcodeCommands.getActorX,
    0x44: s._opcodeCommands.isLess,
    0x46: s._opcodeCommands.increment,
    0x47: s._opcodeCommands.setState,
    0x48: s._opcodeCommands.isEqual,
    0x49: s._opcodeCommands.faceActor,
    0x4a: s._opcodeCommands.startScript,
    0x4b: s._opcodeCommands.getVerbEntryPoint,
    0x4c: s._opcodeCommands.soundKludge,
    0x4d: s._opcodeCommands.walkActorToActor,
    0x4e: s._opcodeCommands.putActorAtObject,
    0x51: s._opcodeCommands.animateActor,
    0x52: s._opcodeCommands.actorFollowCamera,
    0x53: s._opcodeCommands.actorOps,
    0x54: s._opcodeCommands.setObjectName,
    0x55: s._opcodeCommands.actorFromPos,
    0x56: s._opcodeCommands.getActorMoving,
    0x57: s._opcodeCommands.or,
    0x58: s._opcodeCommands.beginOverride,
    0x59: s._opcodeCommands.doSentence,
    0x5a: s._opcodeCommands.add,
    0x5b: s._opcodeCommands.divide,
    0x5d: s._opcodeCommands.setClass,
    0x5e: s._opcodeCommands.walkActorTo,
    0x5f: s._opcodeCommands.isActorInBox,
    0x60: s._opcodeCommands.freezeScripts,
    0x61: s._opcodeCommands.putActor,
    0x62: s._opcodeCommands.stopScript,
    0x63: s._opcodeCommands.getActorFacing,
    0x64: s._opcodeCommands.loadRoomWithEgo,
    0x65: s._opcodeCommands.pickupObject,
    0x66: s._opcodeCommands.getClosestObjActor,
    0x67: s._opcodeCommands.getStringWidth,
    0x68: s._opcodeCommands.isScriptRunning,
    0x69: s._opcodeCommands.setOwnerOf,
    0x6a: s._opcodeCommands.startScript,
    0x6b: s._opcodeCommands.debug,
    0x6c: s._opcodeCommands.getActorWidth,
    0x6d: s._opcodeCommands.putActorInRoom,
    0x6e: s._opcodeCommands.stopObjectScript,
    0x70: s._opcodeCommands.lights,
    0x71: s._opcodeCommands.getActorCostume,
    0x72: s._opcodeCommands.loadRoom,
    0x73: s._opcodeCommands.roomOps,
    0x74: s._opcodeCommands.getDist,
    0x75: s._opcodeCommands.findObject,
    0x76: s._opcodeCommands.walkActorToObject,
    0x77: s._opcodeCommands.startObject,
    0x78: s._opcodeCommands.isGreater,
    0x79: s._opcodeCommands.doSentence,
    0x7a: s._opcodeCommands.verbOps,
    0x7b: s._opcodeCommands.getActorWalkBox,
    0x7c: s._opcodeCommands.isSoundRunning,
    0x7d: s._opcodeCommands.findInventory,
    0x7e: s._opcodeCommands.walkActorTo,
    0x7f: s._opcodeCommands.drawBox,
    0x80: s._opcodeCommands.breakHere,
    0x81: s._opcodeCommands.putActor,
    0x82: s._opcodeCommands.startMusic,
    0x83: s._opcodeCommands.getActorRoom,
    0x84: s._opcodeCommands.isGreaterEqual,
    0x85: s._opcodeCommands.drawObject,
    0x86: s._opcodeCommands.getActorElevation,
    0x87: s._opcodeCommands.setState,
    0x88: s._opcodeCommands.isNotEqual,
    0x89: s._opcodeCommands.faceActor,
    0x8a: s._opcodeCommands.startScript,
    0x8b: s._opcodeCommands.getVerbEntryPoint,
    0x8c: s._opcodeCommands.resourceRoutines,
    0x8d: s._opcodeCommands.walkActorToActor,
    0x8e: s._opcodeCommands.putActorAtObject,
    0x8f: s._opcodeCommands.getObjectState,
    0x90: s._opcodeCommands.getObjectOwner,
    0x91: s._opcodeCommands.animateActor,
    0x92: s._opcodeCommands.panCameraTo,
    0x93: s._opcodeCommands.actorOps,
    0x94: s._opcodeCommands.print,
    0x95: s._opcodeCommands.actorFromPos,
    0x96: s._opcodeCommands.getRandomNr,
    0x97: s._opcodeCommands.and,
    0x98: s._opcodeCommands.systemOps,
    0x99: s._opcodeCommands.doSentence,
    0x9a: s._opcodeCommands.move,
    0x9b: s._opcodeCommands.multiply,
    0x9c: s._opcodeCommands.startSound,
    0x9d: s._opcodeCommands.ifClassOfIs,
    0x9e: s._opcodeCommands.walkActorTo,
    0x9f: s._opcodeCommands.isActorInBox,
    0xa0: s._opcodeCommands.stopObjectCode,
    0xa1: s._opcodeCommands.putActor,
    0xa2: s._opcodeCommands.getAnimCounter,
    0xa3: s._opcodeCommands.getActorY,
    0xa4: s._opcodeCommands.loadRoomWithEgo,
    0xa5: s._opcodeCommands.pickupObject,
    0xa6: s._opcodeCommands.setVarRange,
    0xa7: s._opcodeCommands.dummy,
    0xa8: s._opcodeCommands.notEqualZero,
    0xa9: s._opcodeCommands.setOwnerOf,
    0xaa: s._opcodeCommands.startScript,
    0xab: s._opcodeCommands.saveRestoreVerbs,
    0xac: s._opcodeCommands.expression,
    0xad: s._opcodeCommands.putActorInRoom,
    0xae: s._opcodeCommands.wait,
    0xb0: s._opcodeCommands.matrixOps,
    0xb1: s._opcodeCommands.getInventoryCount,
    0xb2: s._opcodeCommands.setCameraAt,
    0xb3: s._opcodeCommands.roomOps,
    0xb4: s._opcodeCommands.getDist,
    0xb5: s._opcodeCommands.findObject,
    0xb6: s._opcodeCommands.walkActorToObject,
    0xb7: s._opcodeCommands.startObject,
    0xb8: s._opcodeCommands.isLessEqual,
    0xb9: s._opcodeCommands.doSentence,
    0xba: s._opcodeCommands.subtract,
    0xbb: s._opcodeCommands.getActorScale,
    0xbc: s._opcodeCommands.stopSound,
    0xbd: s._opcodeCommands.findInventory,
    0xbe: s._opcodeCommands.walkActorTo,
    0xbf: s._opcodeCommands.drawBox,
    0xc0: s._opcodeCommands.endCutscene,
    0xc1: s._opcodeCommands.putActor,
    0xc2: s._opcodeCommands.chainScript,
    0xc3: s._opcodeCommands.getActorX,
    0xc4: s._opcodeCommands.isLess,
    0xc6: s._opcodeCommands.decrement,
    0xc7: s._opcodeCommands.setState,
    0xc8: s._opcodeCommands.isEqual,
    0xc9: s._opcodeCommands.faceActor,
    0xca: s._opcodeCommands.startScript,
    0xcb: s._opcodeCommands.getVerbEntryPoint,
    0xcc: s._opcodeCommands.pseudoRoom,
    0xcd: s._opcodeCommands.walkActorToActor,
    0xce: s._opcodeCommands.putActorAtObject,
    0xd1: s._opcodeCommands.animateActor,
    0xd2: s._opcodeCommands.actorFollowCamera,
    0xd3: s._opcodeCommands.actorOps,
    0xd4: s._opcodeCommands.setObjectName,
    0xd5: s._opcodeCommands.actorFromPos,
    0xd6: s._opcodeCommands.getActorMoving,
    0xd7: s._opcodeCommands.or,
    0xd8: s._opcodeCommands.printEgo,
    0xd9: s._opcodeCommands.doSentence,
    0xda: s._opcodeCommands.add,
    0xdb: s._opcodeCommands.divide,
    0xdd: s._opcodeCommands.setClass,
    0xde: s._opcodeCommands.walkActorTo,
    0xdf: s._opcodeCommands.isActorInBox,
    0xe0: s._opcodeCommands.freezeScripts,
    0xe1: s._opcodeCommands.putActor,
    0xe2: s._opcodeCommands.stopScript,
    0xe3: s._opcodeCommands.getActorFacing,
    0xe4: s._opcodeCommands.loadRoomWithEgo,
    0xe5: s._opcodeCommands.pickupObject,
    0xe6: s._opcodeCommands.getClosestObjActor,
    0xe7: s._opcodeCommands.getStringWidth,
    0xe8: s._opcodeCommands.isScriptRunning,
    0xe9: s._opcodeCommands.setOwnerOf,
    0xea: s._opcodeCommands.startScript,
    0xeb: s._opcodeCommands.debug,
    0xec: s._opcodeCommands.getActorWidth,
    0xed: s._opcodeCommands.putActorInRoom,
    0xee: s._opcodeCommands.stopObjectScript,
    0xf0: s._opcodeCommands.lights,
    0xf1: s._opcodeCommands.getActorCostume,
    0xf2: s._opcodeCommands.loadRoom,
    0xf3: s._opcodeCommands.roomOps,
    0xf4: s._opcodeCommands.getDist,
    0xf5: s._opcodeCommands.findObject,
    0xf6: s._opcodeCommands.walkActorToObject,
    0xf7: s._opcodeCommands.startObject,
    0xf8: s._opcodeCommands.isGreater,
    0xf9: s._opcodeCommands.doSentence,
    0xfa: s._opcodeCommands.verbOps,
    0xfb: s._opcodeCommands.getActorWalkBox,
    0xfc: s._opcodeCommands.isSoundRunning,
    0xfd: s._opcodeCommands.findInventory,
    0xfe: s._opcodeCommands.walkActorTo,
    0xff: s._opcodeCommands.drawBox,
  };

}());
