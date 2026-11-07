/*
 * The script machinery, ported from ScummVM's engines/scumm/script.cpp:
 * script slots and the machine's state, running, nesting, freezing and
 * stopping scripts, reading and writing variables, fetching a script's
 * bytes, and cutscenes and overrides. The opcodes scripts run are each
 * version's own: script_v5.js (script_v5.cpp).
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

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
    // scumm.cpp: level 0 means "no cutscene"; an override outside any
    // cutscene uses that level's entry
    t.cutSceneStackPointer = 0;
    t.cutScenePtr = [];
    t.cutSceneScript = [];
    t.cutSceneScriptIndex = 0xFF;
    t.cutSceneData = [];

    for(var i = 0; i < 80; i++) {
      if(i < 15)
        t.nest[i] = new s.NestedScript();
      t.slot[i] = new s.ScriptSlot(i);
      t.localvar[i] = [];
    }
  }

  // A variable by its name in vars.js. Older versions have fewer: those
  // missing are kept aside, so they neither clash with each other nor
  // land on a real variable.
  s.scummVar = function(name,value) {
    var t = this, n = t._vars[name];
    if(n === undefined) {
      t._unmappedVars = t._unmappedVars || {};
      if(typeof value != "undefined") t._unmappedVars[name] = value;
      return t._unmappedVars[name] || 0;
    }
    if(typeof value != "undefined")
      t._scummVars[n] = value;
    return t._scummVars[n];
  }

  s.runBootscript = function() {
    var t = this, i, args = [];
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
      if(t._currentScript != i && vm.slot[i].status != "dead" &&
         (!vm.slot[i].freezeResistant || flag >= 0x80)) {
        // Only the freeze flag -- leave `status` alone, so a script that was
        // mid-delay still is one when it thaws.
        vm.slot[i].frozen = true;
        vm.slot[i].freezeCount++;
      }
    }
    // queued sentences wait out the freeze too
    for(i = 0; i < NUM_SENTENCE; i++) {
      if(!t._sentence[i]) t._sentence[i] = {};
      t._sentence[i].freezeCount = (t._sentence[i].freezeCount || 0) + 1;
    }
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
    for(i = 0; i < NUM_SENTENCE; i++) {
      if(t._sentence[i] && t._sentence[i].freezeCount > 0)
        t._sentence[i].freezeCount--;
    }
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
      scriptOffs = t._resourceHeaderSize;
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
      nest.number = 0;
      nest.where = "";
    } else {
      // the CALLER's identity, as ScummVM stores it -- this recorded the
      // callee's number and where, which the resume check below compares
      // against the caller's slot
      var callerSlot = t._vm.slot[t._currentScript];
      nest.number = callerSlot.number;
      nest.where = callerSlot.where;
      nest.slot = t._currentScript;
    }

    t._vm.numNestedScripts++;
    t._currentScript = slot.slot;

    t.getScriptBaseAddress();
    t.getScriptEntryPoint();
    try {
      t.executeScript();
    } finally {
      // even when a script throws, or the nesting depth leaks
      if(t._vm.numNestedScripts > 0)
        t._vm.numNestedScripts--;
    }

    // Resume the caller only if it is still the script that called us: not
    // stopped, not frozen, and not replaced in its slot. A room change kills
    // room scripts, and the slot can be reused by the new room's entry
    // script before we get back here; resuming then ran the wrong code.
    if(nest.number) {
      var caller = t._vm.slot[nest.slot];
      if(caller.number == nest.number && caller.where == nest.where &&
         caller.status != "dead" && caller.freezeCount == 0) {
        t._currentScript = nest.slot;
        t.getScriptBaseAddress();
        t.getScriptEntryPoint();
        return;
      }
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
        vm.nest[i].number = 0;
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
      var slot = t.getScriptSlot();
      slot.status = "running";
      slot.number = 10001;
      slot.where = "room";
      // v5: the EXCD block, past its header; older: an offset in the room
      slot.offs = t._gfx["EXCD_offs"] || 8;
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
      var slot = t.getScriptSlot();
      slot.status = "running";
      slot.number = 10002;
      slot.where = "room";
      slot.offs = t._gfx["ENCD_offs"] || 8;
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
    var i, slot, vm = s._vm, obj, owner;
    for(i = 0; i < vm.slot.length; i++) {
      slot = vm.slot[i];
      if(slot.where == "room" || slot.where == "local" || slot.where == "flobject") {
        if(slot.cutSceneOverride) {
          slot.cutSceneOverride = 0;
        }
        slot.status = "dead";
      }
    }
    // script.cpp: names given to this room's objects go with the room
    for(i = 0; i < s._nums['new_names']; i++) {
      obj = s._newNames[i];
      if(obj) {
        owner = s.getOwner(obj);
        if(owner == 0 || owner == OF_OWNER_ROOM) {
          s._newNames[i] = 0;
          s._res.nukeResource("object_name", i);
        }
      }
    }
  };

  s.decreaseScriptDelay = function(amount) {
    var t = this, slots = t._vm.slot, i;
    for(i = 0; i < slots.length; i++) {
      var slot = slots[i];
      // a frozen script's delay waits too: in ScummVM freezing takes the
      // slot out of ssPaused
      if(slot.status == "paused" && !slot.frozen) {
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

  s.currentScriptNumber = function() {
    var slot = this._vm.slot[this._currentScript];
    return slot ? slot.number : -1;
  };

  s.inventoryScriptInCutscene = function() {
    var t = this, i, ss;
    for(i = 0; i < t._vm.slot.length; i++) {
      ss = t._vm.slot[i];
      if(ss.status != "dead" && ss.where == "inventory" && ss.cutSceneOverride) return true;
    }
    return false;
  };

  s.clearClickedStatus = function() {
    var t = this;
    // (ScummVM resets the key pressed here: keys typed ahead go too)
    t._keyQueue = [];
    t._mouseAndKeyboardStat = 0;
    t._leftBtnPressed  &= ~MS_CLICKED;
    t._rightBtnPressed &= ~MS_CLICKED;
  };

  /* The sentence queue, from ScummVM's doSentence / checkAndRunSentenceScript
     (script.cpp). A click builds a sentence (verb + one or two objects) and
     pushes it here; one is popped per frame and handed to VAR_SENTENCE_SCRIPT,
     which is the game script that acts on it and writes the sentence line. */

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
    // v1/v2's sentence script is always script 2
    var t = this, i, ss, st, args = [],
        sentenceScript = t._version <= 2 ? 2 : t.scummVar("sentence_script");

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

    if(t._version <= 2) {
      // v1/v2 pass the sentence in variables, not arguments
      t.scummVar("active_verb", st.verb);
      t.scummVar("active_object1", st.objectA);
      t.scummVar("active_object2", st.objectB);
      t.scummVar("verb_allowed", t.getVerbEntryPoint(st.objectA, st.verb) != 0 ? 1 : 0);
    } else {
      args[0] = st.verb;
      args[1] = st.objectA;
      args[2] = st.objectB;
    }

    t._currentScript = 0xFF;
    if(sentenceScript) t.runScript(sentenceScript, 0, 0, args);
  };

  s.isScriptRunning = function(script) {
    var t = this, slots = t._vm.slot, i, slot;
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
        nest.number = 0;
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

  s.getResultPos = function() {
    var t = this, a;
    t._resultVarNumber = t.fetchScriptWord();
    // script.cpp getResultPos: an indexed variable, var[base + index]. The
    // flag has to come off either way -- it used to stay on whenever the
    // index was a variable, and the constant-index case lost its index, so
    // writes to arrays (the inventory's slot table among them) went nowhere.
    if(t._resultVarNumber & 0x2000) {
      a = t.fetchScriptWord();
      if(a & 0x2000) {
        t._resultVarNumber += t.readVar(a & ~0x2000);
      } else {
        t._resultVarNumber += a & 0xFFF;
      }
      t._resultVarNumber &= ~0x2000;
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
      // script.cpp readVar: MI2's copy protection is passed by its own
      // check reading var 518 in place of 490, as ScummVM does with its
      // copy_protection setting off
      if(varId == 490 && t._game == "monkey2") varId = 518;
      return t._scummVars[varId];
    }
    if(varId & 0x8000) {
      // v3 keeps its bit variables in the variables: var >> 4, bit var & 15
      if(t._version == 3)
        return (t._scummVars[(varId >> 4) & 0xFF] & (1 << (varId & 0xF))) ? 1 : 0;
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
    var t = this, speed;
    if(!(varId & 0xF000)) {
      // script.cpp: the boot script's text speed gives way to the player's
      if(varId == t._vars.charinc && t._currentRoom == 0 && (speed = t.savedTextSpeed()) !== null)
        value = 9 - speed;
      t._scummVars[varId] = value;
    }
    if(varId & 0x8000) {
      if(t._version == 3) {
        speed = (varId >> 4) & 0xFF;
        if(value) t._scummVars[speed] |= 1 << (varId & 0xF);
        else t._scummVars[speed] &= ~(1 << (varId & 0xF));
        return;
      }
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
    vm.slot[scr].cutSceneOverride++;
    vm.cutSceneStackPointer++;
    if(vm.cutSceneStackPointer >= 5) error("Cutscene stack overflow");   // kMaxCutsceneNum
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

    if(slot.cutSceneOverride > 0)
      slot.cutSceneOverride--;
    for(var i = 0; i < 16; i++) { args[i] = 0; }
    args[0] = vm.cutSceneData[vm.cutSceneStackPointer];
    t.scummVar("override", 0);
    log("end cutscene");
    if(vm.cutScenePtr[vm.cutSceneStackPointer] && slot.cutSceneOverride > 0)
      slot.cutSceneOverride--;

    vm.cutSceneScript[vm.cutSceneStackPointer] = 0;
    vm.cutScenePtr[vm.cutSceneStackPointer] = 0;
    if(vm.cutSceneStackPointer == 0) {
      error("Cutscene stack underflow");
      return;
    }
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

}());
