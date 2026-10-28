(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM,
      NUM_SCRIPT_SLOT = 80;

  s.ScriptSlot = function(slot) {
    var t = this;
    t.number = 0;
    t.offs = 0;
    t.status = "dead";
    t.where = "";
    t.freezeResistant = false;
    t.recursive = false;
    t.freezeCount = 0;
    // Frozen is deliberately not part of `status`: a script can be waiting
    // out a delay ("paused") and frozen by a cutscene at the same time, and
    // the two have to be tracked separately or they corrupt each other.
    t.frozen = false;
    t.cutSceneOverride = 0;
    t.delayFrameCount = 0;
    t.didexec = false;
    t.args = [];
    t.slot = slot;
    t.cycle = 0;
    t.delay = 0;
    t.ptr = null;
  };

  s.NestedScript = function() {
    var t = this;
    t.number = 0;
    t.where = "";
    t.slot = 0;
  };

  s.VirtualMachineState = function() {
    var t = this;
    t.slot = [];
    t.nest = [];
    t.numNestedScripts = 0;
    t.localvar = []
    t.cutSceneStackPointer = -1;
    t.cutScenePtr = [];
    t.cutSceneScript = [];
    t.cutSceneScriptIndex = 0;
    t.cutSceneData = [];

    for(var i = 0; i < 80; i++) {
      if(i < 15)
        t.nest[i] = new s.NestedScript();
      t.slot[i] = new s.ScriptSlot(i);
      t.localvar[i] = [];
    }
  }

  s.scummVar = function(name,value) {
    var t = this;
    if(typeof value != "undefined")
      t._scummVars[t._vars[name]] = value;
    return t._scummVars[t._vars[name]];
  }

  s.runBootscript = function() {
    var t = this, i;
    args = [];
    for(i = 0; i < 16; i++) {
      args[i] = 0;
    }
    args[0] = t._bootParam;
    t.runScript(1, 0, 0, args);
  };

  var slot_status = ["dead", "paused", "running"];

  s.freezeScripts = function(flag) {
    var t = this, vm = t._vm, i;
    for(i = 0; i < vm.slot.length; i++) {
      if(t._currentScript != i && vm.slot[i].status != "dead" && !vm.slot[i].freezeResistant) {
        // Only the freeze flag -- leave `status` alone, so a script that was
        // mid-delay still is one when it thaws.
        vm.slot[i].frozen = true;
        vm.slot[i].freezeCount++;
      }
    }
    // sentence stuff
    if(vm.cutSceneScriptIndex != 0xFF) {
      vm.slot[vm.cutSceneScriptIndex].frozen = false;
      vm.slot[vm.cutSceneScriptIndex].freezeCount = 0;
    }
  };

  s.unfreezeScripts = function() {
    var t = this, vm = t._vm, i;
    for(i = 0; i < vm.slot.length; i++) {
      // The count guard matters: without it a script that was never frozen
      // is decremented to -1 and can never reach 0 again, so it stays stuck.
      if(vm.slot[i].freezeCount > 0 && !--vm.slot[i].freezeCount) {
        vm.slot[i].frozen = false;
      }
    }
    // sentence stuff
  };

  s.runAllScripts = function() {
    var t = this, i, vm = t._vm, numCycles = 1, cycle, slot;

    for(i = 0; i < vm.slot.length; i++) {
      slot = vm.slot[i];
      slot.didexec = false;
    }
    t._currentScript = 0xFF;
    for(cycle = 1; cycle <= numCycles; cycle++) {
      for(i = 0; i < vm.slot.length; i++) {
        slot = vm.slot[i];
        if(slot.cycle == cycle && slot.status == "running" && !slot.frozen && !slot.didexec) {
          t._currentScript = i;
          t.getScriptBaseAddress();
          t.getScriptEntryPoint();
          t.executeScript();
        }
      }
    }
  }

  s.runScript = function(script, freezeResistant, recursive, args, cycle) {
    var t = this, slot, scriptPtr, scriptOffs, scriptType;
    if(!script) return;
    if(!recursive) t.stopScript(script);


    if(script < t._nums['global_scripts']) {
      scriptPtr = t.getResourceAddress("script", script);
      scriptOffs = 8;
      scriptType = "global";
      // log("runScript(Global-"+script+") from "+t._roomResource);
    } else {
      scriptOffs = t._localScriptOffsets[script - t._nums['global_scripts']];
      scriptType = "local";
      // log("runScript("+script+") from "+t._roomResource);
    }

    if(!cycle) cycle = 1;

    slot = t.getScriptSlot();
    slot.number = script;
    slot.offs = scriptOffs;
    slot.status = "running";
    slot.where = scriptType;
    slot.freezeResistant = freezeResistant;
    slot.recursive = recursive;
    slot.freezeCount = 0;
    slot.frozen = false;
    slot.delayFrameCount = 0;
    slot.ptr = null;
    slot.cycle = cycle;

    t.initializeLocals(slot.slot, args);

    t.runScriptNested(slot);
  };

  s.runScriptNested = function(slot) {
    var t = this, nest;

    t.updateScriptPtr();

    nest = t._vm.nest[t._vm.numNestedScripts];

    if(t._currentScript == 0xFF) {
      nest.number = 0xFF;
      nest.where = "";
    } else {
      nest.number = slot.number;
      nest.where = slot.where;
      nest.slot = t._currentScript;
    }

    t._vm.numNestedScripts++;
    t._currentScript = slot.slot;

    t.getScriptBaseAddress();
    t.getScriptEntryPoint();
    t.executeScript();


    if(t._vm.numNestedScripts > 0)
      t._vm.numNestedScripts--;

    if(nest.number != 0xFF) {
      t._currentScript = nest.slot;
      t.getScriptBaseAddress();
      t.getScriptEntryPoint();
      return;
    }

    t._currentScript = 0xFF;
  };

  s.stopObjectScript = function(script) {
    var t = this, vm = t._vm, i, ss;
    if(!script) return;

    for(i = 0; i < vm.slot.length; i++) {
      ss = vm.slot[i];
      if(!ss) continue;
      if(ss.number == script && ss.status != "dead" &&
         (ss.where == "room" || ss.where == "inventory" || ss.where == "flobject")) {
        ss.number = 0;
        ss.status = "dead";
        ss.where = "";
        if(t._currentScript == i) t._currentScript = 0xFF;
      }
    }

    for(i = 0; i < vm.numNestedScripts; i++) {
      if(vm.nest[i].number == script &&
         (vm.nest[i].where == "room" || vm.nest[i].where == "inventory" || vm.nest[i].where == "flobject")) {
        vm.nest[i].number = 0xFF;
        vm.nest[i].slot = 0xFF;
        vm.nest[i].where = "";
      }
    }
  };

  s.runExitScript = function() {
    var t = this, script = 0;
    if(script = t.scummVar("exit_script")) {
      t.runScript(script, 0, 0, 0);
    }
    if(t._gfx["EXCD"]) {
      slot = t.getScriptSlot();
      slot.status = "running";
      slot.number = 10001;
      slot.where = "room";
      slot.offs = 8;
      slot.ptr = t._gfx["EXCD"];
      slot.freezeResistant = 0;
      slot.freezeCount = 0;
      slot.frozen = false;
      slot.delayFrameCount = 0;
      slot.recursive = false;
      slot.cycle = 1;
      t.initializeLocals(slot.slot, []);
      t.runScriptNested(slot);
    }
    if(script = t.scummVar("exit_script2")) {
      t.runScript(script, 0, 0, 0);
    }
  };

  s.runEntryScript = function() {
    var t = this, script;
    if(script = t.scummVar("entry_script")) {
      t.runScript(script, 0, 0, 0);
    }
    if(t._gfx["ENCD"]) {
      slot = t.getScriptSlot();
      slot.status = "running";
      slot.number = 10002;
      slot.where = "room";
      slot.offs = 8;
      slot.ptr = t._gfx["ENCD"];
      slot.freezeResistant = 0;
      slot.freezeCount = 0;
      slot.frozen = false;
      slot.delayFrameCount = 0;
      slot.recursive = false;
      slot.cycle = 1;
      t.initializeLocals(slot.slot, []);
      t.runScriptNested(slot);
    }
    if(script = t.scummVar("entry_script2")) {
      t.runScript(script, 0, 0, 0);
    }
  };

  s.killScriptsAndResources = function() {
    var i, slot, vm = s._vm;
    for(i = 0; i < vm.slot.length; i++) {
      slot = vm.slot[i];
      if(slot.where == "room" || slot.where == "local") { // || flobject
        if(slot.cutSceneOverride) {
          slot.cutSceneOverride = 0;
        }
        slot.status = "dead";
      }
    }
  };

  s.decreaseScriptDelay = function(amount) {
    var t = this, slots = t._vm.slot, i;
    for(i = 0; i < slots.length; i++) {
      slot = slots[i];
      if(slot.status == "paused") {
        slot.delay -= amount;
        if(slot.delay < 0) {
          slot.status = "running";
          slot.delay = 0;
        }
      }
    }
  };

  s.isScriptInUse = function(script) {
    var t = this, i;
    for(i = 0; i < t._vm.slot.length; i++)
      if(t._vm.slot[i] && t._vm.slot[i].number == script) return true;
    return false;
  };

  s.clearClickedStatus = function() {
    var t = this;
    t._lastKeyHit = "";
    t._mouseAndKeyboardStat = 0;
    t._leftBtnPressed  &= ~MS_CLICKED;
    t._rightBtnPressed &= ~MS_CLICKED;
  };

  /* The sentence queue, from ScummVM's doSentence / checkAndRunSentenceScript
     (script.cpp). A click builds a sentence (verb + one or two objects) and
     pushes it here; one is popped per frame and handed to VAR_SENTENCE_SCRIPT,
     which is the game script that acts on it and writes the sentence line. */
  var NUM_SENTENCE = 6;

  s.doSentence = function(verb, objectA, objectB) {
    var t = this, st;
    if(t._sentenceNum >= NUM_SENTENCE) return;
    st = t._sentence[t._sentenceNum] || (t._sentence[t._sentenceNum] = {});
    t._sentenceNum++;
    st.verb = verb;
    st.objectA = objectA;
    st.objectB = objectB;
    st.preposition = (objectB != 0);
    st.freezeCount = 0;
  };

  s.checkAndRunSentenceScript = function() {
    var t = this, i, ss, st, args = [],
        sentenceScript = t.scummVar("sentence_script");

    for(i = 0; i < 25; i++) args[i] = 0;

    // Don't start another one while the script is still working on the last
    for(i = 0; i < t._vm.slot.length; i++) {
      ss = t._vm.slot[i];
      if(ss && ss.number == sentenceScript && ss.status != "dead" && ss.freezeCount == 0)
        return;
    }

    if(!t._sentenceNum || t._sentence[t._sentenceNum - 1].freezeCount) return;

    t._sentenceNum--;
    st = t._sentence[t._sentenceNum];

    if(st.preposition && st.objectB == st.objectA) return;

    args[0] = st.verb;
    args[1] = st.objectA;
    args[2] = st.objectB;

    t._currentScript = 0xFF;
    if(sentenceScript) t.runScript(sentenceScript, 0, 0, args);
  };

  s.isScriptRunning = function(script) {
    var t = this, slots = t._vm.slot, i;
    for(i = 0; i < slots.length; i++) {
      slot = slots[i];
      if(slot.number == script && (slot.where == "global" || slot.where == "local") && slot.status != "dead")
        return true;
    }
    return false;
  };

  s.updateScriptPtr = function() {
    var t = this, offset = 0;
    if(t._currentScript == 0xFF) {
      return;
    }
    t._vm.slot[t._currentScript].offs = t._scriptPointer.offset;
  }

  s.stopScript = function(script) {
    var t = this, i, slot, nest,
        slots = t._vm.slot;
    if(script == 0)
      return;
    for(i = 0; i < slots.length; i++) {
      slot = slots[i];
      if(script == slot.number && slot.status != "dead" && (slot.where == "global" || slot.where == "local")) {
        slot.number = 0;
        slot.status = "dead";
        // nukeArrays(i);
        if(t._currentScript == i)
          t._currentScript = 0xFF;
      }
    }
    for(i = 0; i < t._vm.numNestedScripts; i++) {
      nest = t._vm.nest[i];
      if(script == nest.number && (nest.where == "global" || nest.where == "local")) {
        // nukeArrays(nest.slot);
        nest.number = 0xFF;
        nest.slot = 0xFF;
        nest.where = "";
      }

    }
  };

  s.initializeLocals = function(slot, args) {
    var t = this, localvar = t._vm.localvar[slot], i;
    for(i = 0; i < 25; i++) {
      localvar[i] = args && args[i] ? args[i] : 0;
    }
  }

  s.getScriptSlot = function(n) {
    var t = this, i, slot = null;
    if(n && n > 0) {
      return t._vm.slot[n];
    } else {
      for(i = 1; i < t._vm.slot.length; i++) {
        slot = t._vm.slot[i];
        if(slot && slot.status == "dead")
          return slot;
      }
    }
    return null;
  };

  s.getScriptBaseAddress = function() {
    var t = this, slot;

    if(t._currentScript == 0xFF)
      return;

    // slot = t._vm.slot[t._currentScript]
    slot = t.getScriptSlot(t._currentScript);
    switch(slot.where) {
      case "global":
        t._scriptOrgPointer = t.getResourceAddress("script", slot.number);
        t._lastCodePointer = t._scriptOrgPointer.newRelativeStream();
      break;
      case "local":
      case "room":
        if(slot.ptr) t._scriptOrgPointer = slot.ptr;
        else t._scriptOrgPointer = t.getResourceAddress("room", t._roomResource);
        if(!t._scriptOrgPointer)
          log("FAIL!");
        t._lastCodePointer = t._scriptOrgPointer.newRelativeStream();
      break;
      case "flobject":
        t._scriptOrgPointer = t.getResourceAddress("fl_object",
          t._objs[t.getObjectIndex(slot.number)].fl_object_index);
        t._lastCodePointer = t._scriptOrgPointer.newRelativeStream();
      break;
      case "inventory":
        t._scriptOrgPointer = t.getResourceAddress("inventory", t.getInventorySlot(slot.number));
        t._lastCodePointer = t._scriptOrgPointer.newRelativeStream();
      break;
      default:
        log("Unknown script location "+slot.where);
      break;
    }
  };

  s.getScriptEntryPoint = function() {
    var t = this, offset;
    if(t._currentScript == 0xFF)
      return;
    if(t._scriptOrgPointer.offset > 0)
      t._scriptPointer = t._scriptOrgPointer.newRelativeStream(t._vm.slot[t._currentScript].offs - t._scriptOrgPointer.offset);
    else
      t._scriptPointer = t._scriptOrgPointer.newRelativeStream(t._vm.slot[t._currentScript].offs);
  };

  /* Locate an object's OBCD block, ported from ScummVM's getOBCDFromObject /
     getOBCDOffs (object.cpp). Returns the resource the code lives in together
     with the absolute offset of the OBCD inside it, in the same coordinate
     space the script slots use for "offs". */
  s.getOBCDAddress = function(obj) {
    var t = this, where, idx, od, res;

    where = t.whereIsObject(obj);
    if(where == WIO_NOT_FOUND) return null;

    if(where == WIO_INVENTORY) {
      idx = t.getInventorySlot(obj);
      if(idx < 0) return null;
      res = t.getResourceAddress("inventory", idx);
      if(!res) return null;
      return { res: res, abs: res.offset, where: "inventory" };
    }

    idx = t.getObjectIndex(obj);
    if(idx < 0) return null;
    od = t._objs[idx];

    if(od.fl_object_index) {
      res = t.getResourceAddress("fl_object", od.fl_object_index);
      if(!res) return null;
      // the FLOB wrapper is one header long, the OBCD follows it
      return { res: res, abs: res.offset + t._resourceHeaderSize, where: "flobject" };
    }

    if(!od.OBCDoffset) return null;
    res = t.getResourceAddress("room", t._roomResource);
    if(!res) return null;
    return { res: res, abs: od.OBCDoffset, where: "room" };
  };

  s.getInventorySlot = function(obj) {
    var t = this, i;
    for(i = 0; i < t._nums['inventory']; i++)
      if(t._inventory[i] == obj) return i;
    return -1;
  };

  /* Ported from ScummVM's getVerbEntrypoint (object.cpp). The offsets stored
     in the VERB table are relative to the start of the VERB block, not to the
     OBCD, so the block's own position has to be added back on. */
  s.getVerbEntryPoint = function(obj, entry) {
    var t = this, loc = t.getOBCDAddress(obj), ptr, total, cur, tag, size,
        verbOffs = 0, code, rel, MKID_BE = ScummVM.system.MKID_BE;

    if(!loc) return 0;

    ptr = loc.res.newAbsoluteStream(loc.abs + 4);
    total = ptr.readUI32(true);
    cur = t._resourceHeaderSize;

    while(cur < total) {
      ptr.seek(loc.abs + cur, true);
      tag = ptr.readUI32(true);
      size = ptr.readUI32(true);
      if(size <= t._resourceHeaderSize) return 0;
      if(tag == MKID_BE('VERB')) { verbOffs = cur; break; }
      cur += size;
    }
    if(!verbOffs) return 0;

    ptr.seek(loc.abs + verbOffs + t._resourceHeaderSize, true);
    for(;;) {
      code = ptr.readUI8();
      if(!code) return 0;              // end of table, no handler
      rel = ptr.readUI16();
      if(code == entry || code == 0xFF) // 0xFF is the catch-all entry
        return verbOffs + rel;
    }
  };

  /* Ported from ScummVM's runObjectScript (script.cpp). */
  s.runObjectScript = function(object, entry, freezeResistant, recursive, vars, slotIdx) {
    var t = this, loc, offs, slot;

    if(!object) return;
    if(!recursive) t.stopObjectScript(object);

    loc = t.getOBCDAddress(object);
    if(!loc) {
      log("runObjectScript: object "+object+" not found");
      return;
    }

    offs = t.getVerbEntryPoint(object, entry);
    if(!offs) return;

    slot = (slotIdx >= 0) ? t._vm.slot[slotIdx] : t.getScriptSlot();
    if(!slot) {
      log("runObjectScript: no free script slot for object "+object);
      return;
    }

    slot.number = object;
    slot.offs = loc.abs + offs;
    slot.status = "running";
    slot.where = loc.where;
    slot.freezeResistant = !!freezeResistant;
    slot.recursive = !!recursive;
    slot.freezeCount = 0;
    slot.frozen = false;
    slot.delayFrameCount = 0;
    slot.ptr = null;
    slot.cycle = 1;

    t.initializeLocals(slot.slot, vars);
    t.runScriptNested(slot);
  };

  s.executeScript = function() {
    var t = this;
    var slot = t._vm.slot[t._currentScript];

    while(t._currentScript != 0xFF) {
      if(t._scriptPointer.offset >= t._scriptPointer.length) {
        error("Script out of bounds");
        log(t._scriptPointer.offset);
        slot.number = 0;
        slot.status = "dead";
        t._currentScript = 0xFF;
        return;
      }
      slot = t._vm.slot[t._currentScript];
      t._opcode = t.fetchScriptByte();
      slot.didexec = true;

      // debug(5, "executing opcode 0x"+t._opcode.toString(16));
      t.executeOpcode(t._opcode);
    }
  };

  s.executeOpcode = function(i) {
    var t = this,
        opcodes = t._opcodes;
    if(opcodes[i]) {
      t._opcode = i;

      // log("Executing opcode 0x"+i.toString(16)+" at 0x"+(t._scriptPointer.offset).toString(16)+" in script "+t._vm.slot[t._currentScript].number);
      opcodes[i]();
    } else {
      log("Invalid opcode 0x"+i.toString(16)+" at 0x"+t._scriptPointer.offset.toString(16)+" stopping execution of script "+t._vm.slot[t._currentScript].number);
      t._vm.slot[t._currentScript].status = "dead";
      t._currentScript = 0xFF;
    }
  };

  s.setupScummVars = function() {
    var t = this;
    t._vars = {
      keypress: 0,
      ego: 1,
      camera_pos_x: 2,
      have_msg: 3,
      room: 4,
      override: 5,
      machine_speed: 6,
      num_actor: 8,
      current_lights: 9,
      currentdrive: 10,
      tmr_1: 11,
      tmr_2: 12,
      tmr_3: 13,
      music_timer: 14,
      actor_range_min: 15,
      actor_range_max: 16,
      camera_min_x: 17,
      camera_max_x: 18,
      timer_next: 19,
      virt_mouse_x: 20,
      virt_mouse_y: 21,
      room_resource: 22,
      last_sound: 23,
      cutseneexit_key: 24,
      talk_actor: 25,
      camera_fast_x: 26,
      scroll_script: 27,
      entry_script: 28,
      entry_script2: 29,
      exit_script: 30,
      exit_script2: 31,
      verb_script: 32,
      sentence_script: 33,
      inventory_script: 34,
      cutscene_start_script: 35,
      cutscene_end_script: 36,
      charinc: 37,
      walkto_obj: 38,
      debugmode: 39,
      heapspace: 40,
      restart_key: 42,
      pause_key: 43,
      mouse_x: 44,
      mouse_y: 45,
      timer: 46,
      timer_total: 47,
      soundcard: 48,
      videomode: 49,
      mainmenu_key: 50,
      fixeddisk: 51,
      cursorstate: 52,
      userput: 53,
      talk_string_y: 54,
      soundresult: 56,
      talkstop_key: 57,
      fade_delay: 59,
      nosubtitles: 60,
      soundparam: 64,
      soundparam2: 65,
      soundparam3: 66,
      inputmode: 67,
      memory_performance: 68,
      video_performance: 69,
      room_flag: 70,
      game_loaded: 71,
      new_room: 72
    };
  };

  s.resetScummVars = function() {
    var t = this,
        vm = t._vm;

    vm.numNestedScripts = 0;
    t._currentScript = 0xFF;
    t._currentRoom = 0;
    t.scummVar("talk_string_y", -0x50);
    t.scummVar("videomode", 19);
    t.scummVar("soundcard", 3);     // AdLib -- what the sound we play will be
    t.scummVar("heapspace", 1400);
    t.scummVar("fixeddisk", 1);
    t.scummVar("inputmode", 3);
    // vars.cpp: actors use their own colours and the room lights are on.
    // Left at 0, Monkey Island thinks every room is dark ("It's too dark to
    // see it").
    t.scummVar("current_lights", 1 | 2 | 8);

    t.scummVar("debugmode", t._debugMode);
    t.scummVar("fade_delay", 3);
    t.scummVar("charinc", 4);
    t.scummVar("machine_speed", 0xFF);

    t.setTalkingActor(0);

    // Setup Light
    t._scummVars[74] = 1225; // Monkey1 specific
  };

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
    var idx = s.getObjectIndex(object), od = s._objs[idx], pos = _system.Point(od.walk_x, od.walk_y);
    pos.dir = _system.oldDirToNewDir(od.actordir & 3);

    return pos;
  };


  /* --- object helpers, ported from ScummVM's object.cpp ----------------- */

  var OF_OWNER_ROOM = 0x0F;
  var kObjectClassUntouchable = 32;
  var WIO_NOT_FOUND = -1, WIO_INVENTORY = 0, WIO_ROOM = 1, WIO_FLOBJECT = 3;

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
    var t = this, i, b, a, od, mask = 0xF;

    for (i = 1; i < t._nums['local_objects']; i++) {
      od = t._objs[i];
      if (!od || od.obj_nr < 1) continue;
      if (t.getClass(od.obj_nr, kObjectClassUntouchable)) continue;

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

  s.findInventory = function(owner, idx) {
    var t = this, i, obj, count = 1;
    for (i = 0; i < t._nums['inventory']; i++) {
      obj = t._inventory[i];
      if (obj && t.getOwner(obj) == owner && count++ == idx) return obj;
    }
    return 0;
  };

  /* --- walk boxes ------------------------------------------------------- */
  /* setBoxFlags, setBoxScale and createBoxMatrix live in boxes.js. */

  /* --- verbs, ported from ScummVM's verbs.cpp / o5_verbOps ---------------- */

  var kTextVerbType = 0, kImageVerbType = 1;
  // verbs.h: the area a click happened in, passed to the verb script
  var kVerbClickArea = 1, kSceneClickArea = 2, kInventoryClickArea = 3,
      kKeyClickArea = 4, kSentenceClickArea = 5;

  s.VerbSlot = function() {
    var t = this;
    t.curRect = {left: 0, top: 0, right: 0, bottom: 0};
    t.verbid = 0;
    t.color = 2; t.hicolor = 0; t.dimcolor = 8; t.bkcolor = 0;
    t.type = kTextVerbType;
    t.charset_nr = 0; t.curmode = 0;
    t.saveid = 0; t.key = 0; t.center = false;
    t.imgindex = 0; t.origLeft = 0;
    t.text = "";
  };

  s.initVerbs = function() {
    var t = this, i;
    t._verbs = [];
    for (i = 0; i < t._nums['verbs']; i++) t._verbs[i] = new t.VerbSlot();
  };

  s.getVerbSlot = function(verbid, mode) {
    var t = this, i;
    for (i = 1; i < t._nums['verbs']; i++) {
      if (t._verbs[i].verbid == verbid && t._verbs[i].saveid == mode) return i;
    }
    return 0;
  };

  s.killVerb = function(slot) {
    var t = this, vs;
    if (slot == 0) return;
    vs = t._verbs[slot];
    vs.verbid = 0;
    vs.curmode = 0;
    vs.text = "";
    t._res.nukeResource("verb", slot);
  };

  // verbs.cpp findVerbAtPos: walk the slots backwards, first hit wins
  s.findVerbAtPos = function(x, y) {
    var t = this, i, vs;
    for (i = t._nums['verbs'] - 1; i > 0; i--) {
      vs = t._verbs[i];
      if (vs.curmode != 1 || !vs.verbid || vs.saveid) continue;
      if (y < vs.curRect.top || y >= vs.curRect.bottom) continue;
      if (vs.center) {
        if (x < -(vs.curRect.right - 2 * vs.curRect.left) || x >= vs.curRect.right) continue;
      } else {
        if (x < vs.curRect.left || x >= vs.curRect.right) continue;
      }
      return i;
    }
    return 0;
  };

  // script.cpp runInputScript: hand the click to the game's verb script
  s.runInputScript = function(clickArea, val, mode) {
    var t = this, args = [], i, verbScript = t.scummVar("verb_script");
    for (i = 0; i < 16; i++) args[i] = 0;
    args[0] = clickArea;
    args[1] = val;
    args[2] = mode;
    if (verbScript) t.runScript(verbScript, 0, 0, args);
  };

  // script.cpp runInventoryScript: the game redraws its inventory panel here
  s.runInventoryScript = function(i) {
    var t = this, args = [], j, invScript = t.scummVar("inventory_script");
    if (!invScript) return;
    for (j = 0; j < 16; j++) args[j] = 0;
    args[0] = i;
    t.runScript(invScript, 0, 0, args);
  };

  // verbs.cpp checkExecVerbs, the mouse half -- keyboard verbs are not wired up
  s.checkExecVerbs = function() {
    var t = this, over, zone;

    if (t.scummVar("userput") <= 0 || t._mouseAndKeyboardStat == 0) return;

    if (t._mouseAndKeyboardStat & MBS_MOUSE_MASK) {
      var code = (t._mouseAndKeyboardStat & MBS_LEFT_CLICK) ? 1 : 2;
      zone = t.findVirtScreen(t._mouse.y);
      if (zone == null) return;

      over = t.findVerbAtPos(t._mouse.x, t._mouse.y);
      if (over != 0) {
        t.runInputScript(kVerbClickArea, t._verbs[over].verbid, code);
      } else {
        t.runInputScript(zone == 0 ? kSceneClickArea : kVerbClickArea, 0, code);
      }
    }
  };

  // which virtual screen a y coordinate falls in; 0 is the main picture
  s.findVirtScreen = function(y) {
    var t = this, i, vs;
    for (i = 0; i < t._virtscreens.length; i++) {
      vs = t._virtscreens[i];
      if (!vs) continue;
      if (y >= vs.topline && y < vs.topline + vs.h) return i;
    }
    return null;
  };


  /* Draw the verb panel and the sentence line, from ScummVM's redrawVerbs and
     drawVerb (verbs.cpp). ScummVM draws verbs into the virtual screen and uses
     restoreVerbBG to clear the previous text; our canvas is repainted from
     scratch every frame, so this just redraws them all each time.

     The sentence line above the panel ("Walk to door") is not special-cased --
     it is a centred verb like any other, which is why it appears as soon as
     verbs are drawn at all. */
  s.drawVerbs = function() {
    var t = this, ctx = ScummVM.context,
        width = ScummVM.width, height = ScummVM.height,
        charset, img, data, i, j, vs, color, codes, lw, x, over = 0, any = false;

    if(!t._verbs || !t._verbs.length) return;

    for(i = 1; i < t._verbs.length; i++) {
      vs = t._verbs[i];
      if(vs && vs.verbid && !vs.saveid && vs.curmode &&
         vs.type == kTextVerbType && vs.text) { any = true; break; }
    }
    if(!any) return;

    charset = t._charset || (t._charset = new t.CharsetRenderer(t));
    if(!charset.setCurID(t._curCharset) && !charset.setCurID(1)) return;

    // ScummVM only highlights the verb under the pointer while the cursor is on
    if(t._cursorState > 0)
      over = t.findVerbAtPos(t._mouse.x, t._mouse.y);

    img = ctx.getImageData(0, 0, width, height);
    data = img.data;

    for(i = 1; i < t._verbs.length; i++) {
      vs = t._verbs[i];
      if(!vs || !vs.verbid || vs.saveid || !vs.curmode) continue;
      if(vs.type != kTextVerbType || !vs.text) continue;

      if(vs.curmode == 2) color = vs.dimcolor;
      else if(i == over && vs.hicolor) color = vs.hicolor;
      else color = vs.color;

      // The name is expanded every time it is drawn, as ScummVM's drawVerb
      // does: the sentence line is one verb whose name is "\xFF\x05<var>
      // \xFF\x06<var>..." -- the verb and object names held in variables.
      codes = t.verbDisplayCodes(vs);
      // ScummVM records the rect as it draws, so a verb whose text changes
      // (the sentence line) is clickable where it now is
      t.setVerbRect(vs);
      if(!codes.length) continue;

      lw = charset.getStringWidth(codes);
      // A centred verb is positioned by its middle, the same convention
      // setVerbRect and findVerbAtPos use.
      x = vs.center ? vs.curRect.left - Math.floor(lw / 2) : vs.curRect.left;
      if(x + lw > width) x = width - lw;
      if(x < 0) x = 0;

      // Multi-bit glyphs look their pixels up in the colour map, so the
      // colour has to be published there too (ScummVM's setColor).
      t._charsetColorMap[1] = color;
      charset.drawLine(data, width, height, codes, x, vs.curRect.top, color);
    }

    ctx.putImageData(img, 0, 0);
    t._verbMouseOver = over;
  };

  // The verb's name is stored as a resource by loadPtrToResource; pull it back
  // out as the raw bytes the charset renderer wants.
  s.getVerbText = function(slot) {
    return this.getResourceMessage("verb", slot) || "";
  };

  // A text verb's name, expanded, as the glyph codes to draw. Escape codes
  // that only steer text output are dropped.
  s.verbDisplayCodes = function(vs) {
    var t = this, msg = t.convertMessageToString(vs.text), codes = [], i, c;
    for (i = 0; i < msg.length; i++) {
      c = msg.charCodeAt(i) & 0xFF;
      if (c == 0xFF || c == 0xFE) {
        c = msg.charCodeAt(++i);
        if (c == 9 || c == 10 || c == 12 || c == 13 || c == 14) i += 2;
        continue;
      }
      codes.push(c);
    }
    return codes;
  };

  // verbs.cpp sizes a text verb's box from the string it draws
  s.setVerbRect = function(vs) {
    var t = this, cs, w = 0, h = 8, codes;
    if (!vs || vs.type != kTextVerbType) return;
    cs = t._charset || (t._charset = new t.CharsetRenderer(t));
    if (cs.setCurID(t._curCharset) || cs.setCurID(1)) {
      codes = t.verbDisplayCodes(vs);
      w = cs.getStringWidth(codes);
      h = cs.fontHeight;
    }
    // ScummVM draws a centred verb starting at left - width/2 and records
    // where it ended, so curRect.right comes out at left + width/2. That is
    // the convention findVerbAtPos decodes with its
    // "x < -(right - 2*left)" test, so the rect has to be built the same way
    // or every hit lands on the neighbouring column.
    vs.curRect.right = vs.curRect.left + (vs.center ? Math.floor(w / 2) : w);
    vs.curRect.bottom = vs.curRect.top + h;
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

  s.jumpRelative = function(cond) {
    var t = this, offset = t.fetchScriptWordSigned();
    if(!cond) {
      t._scriptPointer.seek(offset);
    }
  };

  s.push = function(a) {
    var t = this;
    t._vmstack[t._scummStackPos++] = a;
  };

  s.pop = function() {
    var t = this;
    return t._vmstack[--t._scummStackPos];
  };

  s.stopObjectCode = function() {
    var t = this, slot = t._vm.slot[t._currentScript];

    if(slot.where != "global" && slot.where != "local") {
      t.stopObjectScript(slot.number);
    } else {
      slot.number = 0;
      slot.status = "dead";
    }
    t._currentScript = 0xFF;
  };

  // string.cpp resStrLen. A 0xFF escape is followed by a code byte, and
  // every code except 1, 2, 3 and 8 carries a 2-byte parameter -- usually a
  // variable number, whose high byte is often 0. Stopping at the first 0
  // measured "\xFF\x05k\0..." as three bytes long and left the script
  // pointer inside the string, executing the rest of the text as opcodes.
  s.resStrLen = function(stream) {
    var t = this, chr, num = 0, seekStream;
    if(!stream)
      stream = t._scriptPointer;
    seekStream = stream.newRelativeStream(0);
    while((chr = seekStream.readUI8()) != 0) {
      num++;
      if(chr == 0xFF) {
        chr = seekStream.readUI8();
        num++;
        if(chr != 1 && chr != 2 && chr != 3 && chr != 8) {
          seekStream.seek(2);
          num += 2;
        }
      }
    }
    return num;
  };

  // The bytes of the message at the stream's current offset, escape codes and
  // their parameters intact, without the terminator. The stream is not moved.
  s.readMessage = function(stream, len) {
    var t = this, r, out = "", i;
    if(!stream) return "";
    if(len === undefined) len = t.resStrLen(stream);
    r = stream.newRelativeStream(0);
    for(i = 0; i < len; i++) out += String.fromCharCode(r.readUI8());
    return out;
  };

  // A string-like resource (verb, string, actor_name, object_name) as a message
  s.getResourceMessage = function(type, idx) {
    var t = this, r = t.getResourceAddress(type, idx);
    if(!r) return null;
    r = r.newRelativeStream(0);
    r.offset = 0;
    return t.readMessage(r);
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

  // string.cpp convertMessageToString and its helpers. Expands the variable,
  // verb, name and string codes; the ones that drive the text output itself
  // (newline, keep, wait, colour...) are passed through for the renderer.
  s.convertMessageToString = function(msg) {
    var t = this, dst = "", i = 0, chr, val;

    if(!msg) return "";

    while(i < msg.length) {
      chr = msg.charCodeAt(i++);
      if(chr == 0) break;
      if(chr == 0xFF) {
        chr = msg.charCodeAt(i++);
        if(chr == 1 || chr == 2 || chr == 3 || chr == 8) {
          dst += "\xFF" + String.fromCharCode(chr);
        } else {
          val = (msg.charCodeAt(i) | (msg.charCodeAt(i + 1) << 8)) & 0xFFFF;
          switch(chr) {
            case 4: dst += t.convertIntMessage(val); break;
            case 5: dst += t.convertVerbMessage(val); break;
            case 6: dst += t.convertNameMessage(val); break;
            case 7: dst += t.convertStringMessage(val); break;
            case 9: case 10: case 12: case 13: case 14:
              dst += "\xFF" + String.fromCharCode(chr) + msg.charAt(i) + msg.charAt(i + 1);
              break;
            default:
              i -= 2;
          }
          i += 2;
        }
      } else if(chr != 0x40) { // '@' is padding
        dst += String.fromCharCode(chr);
      }
    }
    return dst;
  };

  s.convertIntMessage = function(v) {
    return String(this.readVar(v));
  };

  s.convertVerbMessage = function(v) {
    var t = this, num = t.readVar(v), k, vs;
    if(num) {
      for(k = 1; k < t._nums['verbs']; k++) {
        vs = t._verbs[k];
        if(vs && num == vs.verbid && !vs.type && !vs.saveid)
          return t.convertMessageToString(t.getResourceMessage("verb", k));
      }
    }
    return "";
  };

  s.convertNameMessage = function(v) {
    var t = this, num = t.readVar(v);
    if(num) return t.convertMessageToString(t.getObjOrActorName(num));
    return "";
  };

  s.convertStringMessage = function(v) {
    var t = this;
    if(v) return t.convertMessageToString(t.getResourceMessage("string", v));
    return "";
  };

  s.getResultPos = function() {
    var t = this, a;
    t._resultVarNumber = t.fetchScriptWord();
    if(t._resultVarNumber & 0x2000) {
      a = t.fetchScriptWord();
      if(a & 0x2000) {
        t._resultVarNumber += t.readVar(a & ~0x2000);
      } else {
        t._resultVarNumber &= ~0x2000;
      }
    }
  };

  s.readVar = function(varId) {
    var t = this, a;
    if(varId & 0x2000) {
      a = t.fetchScriptWord();
      if(a & 0x2000)
        varId += t.readVar(a & ~0x2000);
      else
        varId += a & 0xFFF;
      varId &= ~0x2000;
    }
    if(!(varId & 0xF000)) {
      return t._scummVars[varId];
    }
    if(varId & 0x8000) {
      varId &= 0x7FFF;
      return (t._bitVars[varId >> 3] & (1 << (varId & 7))) ? 1 : 0;
    }
    if(varId & 0x4000) {
      varId &= 0xFFF;
      return t._vm.localvar[t._currentScript][varId];
    }
    return -1;
  };

  s.writeVar = function(varId, value) {
    var t = this;
    if(!(varId & 0xF000)) {
      t._scummVars[varId] = value;
    }
    if(varId & 0x8000) {
      varId &= 0x7FFF;
      if(value)
        t._bitVars[varId >> 3] |= (1 << (varId & 7));
      else
        t._bitVars[varId >> 3] &= ~(1 << (varId & 7));
    }
    if(varId & 0x4000) {
      varId &= 0xFFF;
      t._vm.localvar[t._currentScript][varId] = value;
    }
  };

  s.getVar = function() {
    var t = this, varId = t.fetchScriptWord();
    return t.readVar(varId);
  }

  s.getVarOrDirectByte = function(mask) {
    var t = this;
    if(t._opcode & mask)
      return t.getVar();
    return t.fetchScriptByte();
  };

  s.getVarOrDirectWord = function(mask) {
    var t = this;
    if(t._opcode & mask)
      return t.getVar();
    return t.fetchScriptWordSigned();
  };

  s.getWordVararg = function() {
    var t = this, data = [], i;

    // Numbers, not "\0": these become the script's local variables, and
    // "\0" == 0 is false in JavaScript -- every script started with fewer
    // than 16 arguments used to see its unused locals as non-zero.
    for(i = 0; i < 16; i++) {
      data[i] = 0;
    }

    i = 0;
    while((t._opcode = t.fetchScriptByte()) != 0xFF) {
      data[i++] = t.getVarOrDirectWord(PARAM_1);
    }
    return data;
  }

  s.setResult = function(value) {
    var t = this;
    t.writeVar(t._resultVarNumber, value);
  };

  s.updateCodePointer = function() {
    var t = this;

    if(t._lastCodePointer.offset != t._scriptOrgPointer.offset) {
      oldoffs = t._scriptPointer.offset;
      t.getScriptBaseAddress();
      t._scriptPointer.seek(oldoffs);
    }
  }

  s.fetchScriptByte = function() {
    this.updateCodePointer();
    var t = this, b = t._scriptPointer;
    return b.readUI8();
  };

  s.fetchScriptWord = function() {
    this.updateCodePointer();
    var t = this, b = t._scriptPointer;
    return b.readUI16();
  };

  s.fetchScriptWordSigned = function() {
    this.updateCodePointer();
    var t = this, b = t._scriptPointer;
    return b.readSI16();
  };

  s.fetchScriptDWord = function() {
    this.updateCodePointer();
    var t = this, b = t._scriptPointer;
    return b.readUI32();
  };

  s.fetchScriptDWordSigned = function() {
    this.updateCodePointer();
    var t = this, b = t._scriptPointer;
    return b.readSI32();
  };

  s.beginOverride = function() {
    var t = this, vm = t._vm, idx = vm.cutSceneStackPointer;
    vm.cutScenePtr[idx] = t._scriptPointer.offset;
    vm.cutSceneScript[idx] = t._currentScript;
    log("begin override");

    t.fetchScriptByte();
    t.fetchScriptWord();
    t.scummVar("override", 0);
  };

  s.endOverride = function() {
    var t = this, vm = t._vm, idx = vm.cutSceneStackPointer;

    log("ending override");
    vm.cutScenePtr[idx] = 0;
    vm.cutSceneScript[idx] = null;
    t.scummVar("override", 0);
  };

  s.beginCutscene = function(args) {
    var t = this, scr = t._currentScript, vm = t._vm;
    vm.slot[scr].cutsceneOverride++;
    vm.cutSceneStackPointer++;
    vm.cutSceneData[vm.cutSceneStackPointer] = args[0];
    vm.cutSceneScript[vm.cutSceneStackPointer] = 0;
    vm.cutScenePtr[vm.cutSceneStackPointer] = 0;

    vm.cutSceneScriptIndex = scr;
    if(t.scummVar("cutscene_start_script"))
      t.runScript(t.scummVar("cutscene_start_script"), 0, 0, args);
    vm.cutSceneScriptIndex = 0xFF;
  };

  s.endCutscene = function() {
    var t = this, vm = t._vm, slot = vm.slot[t._currentScript], args = [];

    if(slot.cutsceneOverride > 0)
      slot.cutsceneOverride--;
    for(var i = 0; i < 16; i++) { args[i] = 0; }
    args[0] = vm.cutSceneData[vm.cutSceneStackPointer];
    t.scummVar("override", 0);
    log("end cutscene");
    if(vm.cutScenePtr[vm.cutSceneStackPointer] && slot.cutsceneOverride > 0)
      slot.cutsceneOverride--;

    vm.cutSceneScript[vm.cutSceneStackPointer] = 0;
    vm.cutScenePtr[vm.cutSceneStackPointer] = 0;
    vm.cutSceneStackPointer--;

    if(t.scummVar("cutscene_end_script")) {
      log("running cutscene_end_script "+t.scummVar("cutscene_end_script"));
      t.runScript(t.scummVar("cutscene_end_script"), 0, 0, args);
    }
  };

  s.abortCutscene = function() {
    var t = this, vm = t._vm, slot, args = [], idx = vm.cutSceneStackPointer, offs = vm.cutScenePtr[idx];

    if(offs) {
      log("aborting cutscene "+idx+" at "+offs+" script "+vm.cutSceneScript[idx]);
      slot = vm.slot[vm.cutSceneScript[idx]];
      slot.offs = offs;
      slot.status = "running";
      slot.freezeCount = 0;
      slot.frozen = false;
      if(slot.cutSceneOverride > 0)
        slot.cutSceneOverride--;

      t.scummVar("override", 1);
      vm.cutScenePtr[idx] = 0
    }
    log("aborted cutscene");
  };

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

      s.runObjectScript(obj, script, (op & 0x20) != 0, (op & 0x40) != 0, data, -1);
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
       case 9: // lock script
       break;
       case 10: // lock sound
       break;
       case 11: // lock costume
       break;
       case 13: // unlock script
       break;
       case 15: // unlock costume
       break;
       case 17:
       break;
       case 18: // charset
         s.loadCharset(resid);
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
          table = s.getWordVararg();
          for(var i = 0; i < 16; i++)
            s._charsetColorMap[i] = parseInt(table[i]) ? parseInt(table[i]) : 0;
        break;
        default:
          if(s._opcodeCommands & 0x1F <= 14)
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
    roomOps: function() {
      var a = 0, b = 0, c, d, e;
      s._opcode = s.fetchScriptByte();
      switch(s._opcode & 0x1F) {
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
        case 10: // room fase
          a = s.getVarOrDirectWord(PARAM_1);
          if(a) {
            // _switchRoomEffect
          } else {
            // fadeIn
          }
        break;
        default:
          log("unimplemented roomOps opcode " + (s._opcode & 0x1F));
        break;
      }
    },
    isEqual: function() {
      var a, b, varId;
      varId = s.fetchScriptWord();
      a = s.readVar(varId);
      b = s.getVarOrDirectWord(PARAM_1);
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
      else s.setResult(Math.floor(s.readVar(s._resultVarNumber) / a));
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
      s.setResult(a.ignoreBoxes ? 0 : a.walkbox);
    },
    getAnimCounter: function() {
      s.getResultPos();
      s.setResult(s.getActor(s.getVarOrDirectByte(PARAM_1)).cost.animCounter);
    },
    isActorInBox: function() {
      var a = s.getActor(s.getVarOrDirectByte(PARAM_1)),
          box = s.getVarOrDirectByte(PARAM_2);
      s.jumpRelative(a.walkbox == box);
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

      a.putActor(-1, -1, room);
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
      // no sound engine
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
      s.getResultPos();
      // the charset renderer measures this; 0 until a string is set up
      s.setResult(0);
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
      s.getResultPos();
      s.getVarOrDirectWord(PARAM_1);
      s.setResult(-1);
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
      s.setResult(act.facing);
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
      var dst;
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
            s.push(s.pop() / i);
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
    },
    verbOps: function() {
      // ported from o5_verbOps -- it used to parse all of this and throw it
      // away, which is why _verbs stayed empty and nothing was ever clickable
      var verb = s.getVarOrDirectByte(PARAM_1),
          slot = s.getVerbSlot(verb, 0), vs, a;

      if (slot < 0 || slot >= s._nums['verbs']) { error("bad verb slot " + slot); return; }
      vs = s._verbs[slot];
      vs.verbid = verb;

      while ((s._opcode = s.fetchScriptByte()) != 0xFF) {
        switch (s._opcode & 0x1F) {
          case 1:  // image
            a = s.getVarOrDirectWord(PARAM_1);
            if (slot) vs.type = kImageVerbType;
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
            vs.charset_nr = s._string[0] ? (s._string[0].charset || 0) : 0;
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
          case 22: // assign object
            a = s.getVarOrDirectWord(PARAM_1);
            s.getVarOrDirectByte(PARAM_2);
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
        case 4: // wait for sentence
          // The sentence queue is not ported; with nothing queued the only
          // thing left to wait on is the sentence script itself.
          if(!s.isScriptRunning(s.scummVar("sentence_script")))
            return;
        break;
        default:
          log("unknown wait opcode 0x"+(s._opcode & 0x1F));
      }

      s._scriptPointer.offset = oldoffset;
      s._opcodeCommands.breakHere();
    },
    drawObject: function() {
      var state = 1, obj, idx, i, xpos = 255, ypos = 255, x, y, w, h, od;

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
        // Pos stuff
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
      act = s.getVarOrDirectByte(PARAM_1);
      s.setResult(act.elevation);
    },
    drawBox: function() {
      var x,y,x2,y2, color;
      x = s.getVarOrDirectWord(PARAM_1);
      y = s.getVarOrDirectWord(PARAM_2);
      s._opcode = s.fetchScriptByte();
      x2 = s.getVarOrDirectWord(PARAM_1);
      y2 = s.getVarOrDirectWord(PARAM_2);
      color = s.getVarOrDirectByte(PARAM_3);

      // s.drawBox(x, y, x2, y2, color);
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
      // s.setOwnerOf(obj, owner);
    },
    getRandomNr: function() {
      s.getResultPos();
      s.setResult(Math.floor(Math.random()*s.getVarOrDirectByte(PARAM_1)));
    },
    actorOps: function() {
      var a = s.getVarOrDirectByte(PARAM_1), act = s.getActor(a), i, j;

      while((s._opcode = s.fetchScriptByte()) != 0xFF) {
        switch(s._opcode & 0x1F) {
          case 1: // costume
            act.setActorCostume(s.getVarOrDirectByte(PARAM_1));
          break;
          case 2: // step dist
            i = s.getVarOrDirectByte(PARAM_1);
            j = s.getVarOrDirectByte(PARAM_2);
            act.setActorWalkSpeed(i, j);
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
            act.initActor(-1); //0);
          break;
          case 11: // palette
            i = s.getVarOrDirectByte(PARAM_1);
            j = s.getVarOrDirectByte(PARAM_2);
            act.setPalette(i, j);
          break;
          case 12: // talk color
            act.talkColor = s.getVarOrDirectByte(PARAM_1);
            log("set talk color "+act.talkColor);
          break;
          case 13: // actor name
            s.loadPtrToResource("actor_name", a, null);
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
            act.ignoreBoxes = !(s.opcode & 1);
            act.forceClip = 0;
            if(act.isInCurrentRoom())
              act.putActor();
          break;
          case 0:
          case 3: // sound
          case 15:
          case 16: // actor width
            //unimplemented
          break;
          default:
            log("unimplemented actorOps opcode " + (s._opcode & 0x1F));
          break;
        }
      }
    },
    breakHere: function() {
      s.updateScriptPtr();
      slot = s._vm.slot[s._currentScript];
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
      act.room = room;
      act.showActor();
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

      act.animateActor(anim);
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
    },
    setCameraAt: function() {
      s.setCameraAtEx(s.getVarOrDirectWord(PARAM_1));
      // s._screenEndStrip = s._gdi.numStrips - 1;
    },
    startSound: function() {
      var sound = s.getVarOrDirectByte(PARAM_1);
      s.scummVar("music_timer", 0);
      // addSoundToQueue
    },
    stopSound: function() {
      var sound = s.getVarOrDirectByte(PARAM_1);
      // stopSound
    },
    faceActor: function() {
      var act = s.getActor(s.getVarOrDirectByte(PARAM_1)), obj = s.getVarOrDirectWord(PARAM_2);
      act.faceToObject(obj);
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
      // getObjActToObjActDist
      s.setResult(1);
    },
    panCameraTo: function() {
      s.panCameraTo(s.getVarOrDirectWord(PARAM_1), 0);
    },
    pickupObject: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), room = s.getVarOrDirectByte(PARAM_2);
      if(room == 0) room = s._roomResource;
      // addObjectToInventory
      s.putOwner(obj, s.scummVar("ego"));
      // putClass untouchable
      s.putState(obj, 1);
      // object dirty
      s.clearDrawObjectQueue();
      // s.runInventoryScript(1);
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
          dist = s.fetchScriptByte();

      log("walkActorToActor");
    },
    walkActorToObject: function() {
      var a, obj, act, pos;
      a = s.getVarOrDirectByte(PARAM_1);
      obj = s.getVarOrDirectWord(PARAM_2);
      act = s.getActor(a);
      pos = s.getObjectXYPos(obj);
      act.startWalkActor(pos.x, pos.y, pos.dir);
    },
    startMusic: function() {
      var sound = s.getVarOrDirectByte(PARAM_1);
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
    saveRestoreVerbs: function() {
      var a, b, c;
      s._opcode = s.fetchScriptByte();
      a = s.getVarOrDirectByte(PARAM_1);
      b = s.getVarOrDirectByte(PARAM_2);
      c = s.getVarOrDirectByte(PARAM_3);
    },
    setClass: function() {
      var obj = s.getVarOrDirectWord(PARAM_1), newClass;

      while((s._opcode = s.fetchScriptByte()) != 0xFF) {
        newClass = s.getVarOrDirectWord(PARAM_1);
        if(newClass == 0) {
          // all class data
        } else {
        }
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
      // isSoundRunning
      s.setResult(0);
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
      // soundKludge
    },
    setObjectName: function() {
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
      s.getResultPos();
      x = s.getVarOrDirectByte(PARAM_1);
      y = s.getVarOrDirectByte(PARAM_2);
      s.setResult(0); // findObject(x, y);
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
  // unregistered byte.
  s._opcodes = {
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
    0x2f: s._opcodeCommands.ifNotState,
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
    0x45: s._opcodeCommands.drawObject,
    0x46: s._opcodeCommands.increment,
    0x47: s._opcodeCommands.setState,
    0x48: s._opcodeCommands.isEqual,
    0x49: s._opcodeCommands.faceActor,
    0x4a: s._opcodeCommands.startScript,
    0x4b: s._opcodeCommands.getVerbEntryPoint,
    0x4c: s._opcodeCommands.soundKludge,
    0x4d: s._opcodeCommands.walkActorToActor,
    0x4e: s._opcodeCommands.putActorAtObject,
    0x4f: s._opcodeCommands.ifState,
    0x50: s._opcodeCommands.pickupObjectOld,
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
    0x5c: s._opcodeCommands.oldRoomEffect,
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
    0x6f: s._opcodeCommands.ifNotState,
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
    0xaf: s._opcodeCommands.ifNotState,
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
    0xc5: s._opcodeCommands.drawObject,
    0xc6: s._opcodeCommands.decrement,
    0xc7: s._opcodeCommands.setState,
    0xc8: s._opcodeCommands.isEqual,
    0xc9: s._opcodeCommands.faceActor,
    0xca: s._opcodeCommands.startScript,
    0xcb: s._opcodeCommands.getVerbEntryPoint,
    0xcc: s._opcodeCommands.pseudoRoom,
    0xcd: s._opcodeCommands.walkActorToActor,
    0xce: s._opcodeCommands.putActorAtObject,
    0xcf: s._opcodeCommands.ifState,
    0xd0: s._opcodeCommands.pickupObjectOld,
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
    0xdc: s._opcodeCommands.oldRoomEffect,
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
    0xef: s._opcodeCommands.ifNotState,
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
