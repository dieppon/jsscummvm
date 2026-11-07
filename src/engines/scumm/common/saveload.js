/*
 * Saving and loading, after ScummVM's engines/scumm/saveload.cpp: the
 * state scripts can change is written out between frames, and loading
 * rebuilds the room from the game files, then lays that state back over
 * it.
 *
 * A save is a JSON snapshot. Streams -- an inventory item's copy of its
 * object code, an image verb's picture, string and name resources -- are
 * stored with their bytes. Saves live in the browser's localStorage, one
 * key per slot.
 */
(function(){
  var s = ScummVM.engines.SCUMM;
  var VERSION = 1;

  // Engine fields that make up a game's state
  var ENGINE_KEYS = [
    "_currentRoom", "_roomResource", "_userPut", "_cursorState", "_curCharset",
    "_actorToPrintStrFor", "_switchRoomEffect", "_switchRoomEffect2", "_newEffect",
    "_screenEffectFlag", "_egoPositioned", "_scummVars", "_bitVars",
    "_objectOwnerTable", "_objectStateTable", "_classData", "_inventory", "_newNames",
    "_verbs", "_objs", "_boxes", "_boxMatrix", "_scaleSlots", "_currentPalette",
    "_shadowPalette", "_colorCycle", "_palManipCounter", "_palManipStart", "_palManipEnd",
    "_palManipPalette", "_palManipIntermediatePal", "_charsetData", "_charsetColorMap",
    "_string", "_sentence", "_sentenceNum", "_actors", "_shakeEnabled",
    "_screenB", "_screenH",
    // v1/v2: the interface the engine draws, and variables v5 has and v2
    // does not
    "_userState", "_inventoryOffset", "_unmappedVars"
  ];
  var VM_KEYS = ["slot", "nest", "localvar", "cutSceneStackPointer", "cutScenePtr",
                 "cutSceneScript", "cutSceneScriptIndex", "cutSceneData"];
  var CAMERA_KEYS = ["cur", "dest", "last", "mode", "follows", "movingToActor"];
  var RESOURCE_TYPES = ["string", "verb", "actor_name", "object_name", "inventory"];

  // --- to and from plain data ---------------------------------------------

  function freeze(v) {
    var out, k;
    if (v === null || v === undefined || typeof v != "object") return v;
    if (v instanceof ScummVM.Stream)
      return {__stream: "S", b: v.buffer, f: v.filename, l: v.length, e: v.encByte, o: v.offset};
    if (v instanceof ScummVM.WritableStream)
      return {__stream: "W", b: v.buffer.join(""), l: v.length, o: v.offset};
    if (Array.isArray(v)) return v.map(freeze);
    out = {};
    for (k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k) || typeof v[k] == "function") continue;
      out[k] = freeze(v[k]);
    }
    return out;
  }

  function thaw(v) {
    var st;
    if (v && v.__stream == "S") {
      st = new ScummVM.Stream(v.b, v.f, v.l);
      st.length = v.l;
      st.encByte = v.e;
      st.offset = v.o;
      return st;
    }
    if (v && v.__stream == "W") {
      st = new ScummVM.WritableStream(v.b, v.l);
      st.offset = v.o;
      return st;
    }
    if (Array.isArray(v)) return v.map(thaw);
    if (v && typeof v == "object") {
      var out = {}, k;
      for (k in v) out[k] = thaw(v[k]);
      return out;
    }
    return v;
  }

  // Write saved data back into a live object, keeping its methods and the
  // identity of the objects inside it (actors, verbs, script slots...)
  function restoreInto(target, data) {
    var k, d, cur;
    for (k in data) {
      d = data[k];
      cur = target[k];
      if (d && typeof d == "object" && !d.__stream && cur && typeof cur == "object" &&
          !(cur instanceof ScummVM.Stream) && !(cur instanceof ScummVM.WritableStream) &&
          Array.isArray(d) == Array.isArray(cur)) {
        if (Array.isArray(d)) {
          // arrays of plain values are replaced; arrays of objects are
          // restored element by element
          if (d.length && d.some(function(x) { return x && typeof x == "object" && !x.__stream; })) {
            for (var i = 0; i < d.length; i++) {
              if (cur[i] && typeof cur[i] == "object" && d[i] && typeof d[i] == "object" && !d[i].__stream)
                restoreInto(cur[i], d[i]);
              else
                cur[i] = thaw(d[i]);
            }
            cur.length = d.length;
          } else {
            target[k] = thaw(d);
          }
        } else {
          restoreInto(cur, d);
        }
      } else {
        target[k] = thaw(d);
      }
    }
  }

  // --- saving ---------------------------------------------------------------

  s.saveState = function() {
    var t = this, state = {version: VERSION, game: t._game, engine: {}, vm: {}, camera: {}, res: {}},
        i, k;
    for (i = 0; i < ENGINE_KEYS.length; i++) {
      k = ENGINE_KEYS[i];
      state.engine[k] = freeze(t[k]);
    }
    for (i = 0; i < VM_KEYS.length; i++) state.vm[VM_KEYS[i]] = freeze(t._vm[VM_KEYS[i]]);
    for (i = 0; i < CAMERA_KEYS.length; i++) state.camera[CAMERA_KEYS[i]] = freeze(t._camera[CAMERA_KEYS[i]]);
    // a slot running the room's entry/exit code points into the room data
    state.vm.slotPtrs = t._vm.slot.map(function(sl) {
      if (!sl.ptr) return null;
      if (sl.ptr === t._gfx["EXCD"]) return "EXCD";
      if (sl.ptr === t._gfx["ENCD"]) return "ENCD";
      return null;
    });
    for (i = 0; i < RESOURCE_TYPES.length; i++)
      state.res[RESOURCE_TYPES[i]] = freeze(t._res.types[RESOURCE_TYPES[i]].address);
    state.cd = {sound: t._currentCDSound, timer: t._cdMusicTimer, running: t._cdTimerRunning,
                status: freeze(t._cdStatus)};
    return state;
  };

  // --- loading --------------------------------------------------------------

  s.loadState = function(state) {
    var t = this, i, k, room, sl;
    if (!state || state.version != VERSION || state.game != t._game) return false;

    // whatever was going on stops
    t.stopTalk();
    t.stopAllSounds();
    t.clearTextSurface();
    t._effectQueue = [];
    t._effectBusy = false;
    t._pendingFadeIn = null;
    t._soundQueue = [];
    t._musicQueue = [];

    // the room, from the game files
    room = state.engine._currentRoom;
    t._currentRoom = room;
    t._roomResource = state.engine._roomResource;
    if (room) {
      t.ensureResourceLoaded("room", t._roomResource);
      t.setupRoomSubBlocks();
      t.resetRoomSubBlocks();
      t.initBGBuffers(t._roomHeight);
    } else {
      t._gfx = {ENCD: 0, EXCD: 0, EPAL: 0, CLUT: 0, PALS: 0};
    }

    // ...and the state over it
    for (k in state.engine) {
      if (k == "_actors" || k == "_verbs" || k == "_objs" || k == "_string") restoreInto(t[k], state.engine[k]);
      else t[k] = thaw(state.engine[k]);
    }
    var vmData = {};
    for (k in state.vm) if (k != "slotPtrs") vmData[k] = state.vm[k];
    restoreInto(t._vm, vmData);
    for (i = 0; i < t._vm.slot.length; i++) {
      sl = t._vm.slot[i];
      k = state.vm.slotPtrs[i];
      sl.ptr = k ? t._gfx[k] : null;
    }
    t._vm.numNestedScripts = 0;
    t._currentScript = 0xFF;
    restoreInto(t._camera, state.camera);
    for (i = 0; i < RESOURCE_TYPES.length; i++)
      t._res.types[RESOURCE_TYPES[i]].address = thaw(state.res[RESOURCE_TYPES[i]]);

    // the screen as the room had it laid out
    if (t._screenB !== undefined) t.initScreens(t._screenB, t._screenH);
    for (i = 1; i < t._actors.length; i++) {
      if (t._actors[i]) t._actors[i].needRedraw = true;
    }
    t._imageVerbSig = null;
    // v1/v2 draw their inventory and sentence line themselves
    if (t.redrawV2Inventory) {
      t.redrawV2Inventory();
      t.drawSentence();
    }
    t._fullRedraw = true;
    t._bgNeedsRedraw = true;
    t.cameraMoved();

    // the CD track, from where it had got to
    if (state.cd && state.cd.sound && state.cd.status) {
      var st = thaw(state.cd.status);
      t._currentCDSound = state.cd.sound;
      t.playCDTrack(st.track, st.loops, Math.round((st.start + state.cd.timer / 60) * 75),
                    st.end ? Math.round((st.end - st.start - state.cd.timer / 60) * 75) : 0);
      t._cdMusicTimer = state.cd.timer;
      t._cdTimerRunning = state.cd.running;
    }
    return true;
  };

  // --- slots in localStorage ------------------------------------------------

  function slotKey(game, n) { return "jsscummvm." + game + ".save." + n; }

  s.saveToSlot = function(n, name) {
    var t = this, data = {name: name, date: Date.now(), room: t._currentRoom, state: t.saveState()};
    try {
      window.localStorage.setItem(slotKey(t._game, n), JSON.stringify(data));
      return true;
    } catch (e) {
      error("Could not save: " + e.message);
      return false;
    }
  };

  s.loadFromSlot = function(n) {
    var t = this, raw;
    try { raw = window.localStorage.getItem(slotKey(t._game, n)); } catch (e) { raw = null; }
    if (!raw) return false;
    return t.loadState(JSON.parse(raw).state);
  };

  // What is in each slot, for the menu
  s.listSlots = function(count) {
    var t = this, out = [], i, raw, d;
    for (i = 1; i <= count; i++) {
      d = null;
      try {
        raw = window.localStorage.getItem(slotKey(t._game, i));
        if (raw) {
          d = JSON.parse(raw);
          d = {name: d.name, date: d.date, room: d.room};
        }
      } catch (e) { d = null; }
      out.push(d);
    }
    return out;
  };
}());
