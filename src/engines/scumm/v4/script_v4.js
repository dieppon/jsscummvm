/*
 * The opcodes of SCUMM v4 (and, under v3's own, of v3): v5's table with a
 * few of its own, ported from ScummVM's script_v4.cpp.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM, C = s._opcodeCommands;

  var V4 = {
    ifState: function() {
      var a = s.getVarOrDirectWord(PARAM_1), b = s.getVarOrDirectByte(PARAM_2);
      s.jumpRelative(s.getState(a) == b);
    },
    ifNotState: function() {
      var a = s.getVarOrDirectWord(PARAM_1), b = s.getVarOrDirectByte(PARAM_2);
      s.jumpRelative(s.getState(a) != b);
    },
    // the object is taken: into the inventory, untouchable, state 1
    pickupObject: function() {
      var obj = s.getVarOrDirectWord(PARAM_1);
      if (obj < 1) return;
      if (s.getObjectIndex(obj) == -1) return;
      if (s.whereIsObject(obj) == WIO_INVENTORY) return;
      s.addObjectToInventory(obj, s._roomResource);
      s.markObjectRectAsDirty(obj);
      s.putOwner(obj, s.scummVar("ego"));
      s.putClass(obj, kObjectClassUntouchable, 1);
      s.putState(obj, 1);
      s.clearDrawObjectQueue();
      s.runInventoryScript(1);
    },
    // the room transition effects, or a fade in now
    oldRoomEffect: function() {
      var a;
      s._opcode = s.fetchScriptByte();
      if ((s._opcode & 0x1F) == 3) {
        a = s.getVarOrDirectWord(PARAM_1);
        if (a) {
          s._switchRoomEffect = a & 0xFF;
          s._switchRoomEffect2 = (a >> 8) & 0xFF;
        } else if (s.fadeIn) {
          s.fadeIn(s._newEffect);
        }
      }
    },
    // saving variables to files: only read past -- Indy's IQ points are
    // kept another way
    saveLoadVars: function() {
      s.fetchScriptByte();
      for (;;) {
        s._opcode = s.fetchScriptByte();
        if (s._opcode == 0) return;
        switch (s._opcode & 0x1F) {
          case 1:
            s.getResultPos();
            s.getResultPos();
          break;
          case 2:
            s.getVarOrDirectByte(PARAM_1);
            s.getVarOrDirectByte(PARAM_2);
          break;
          case 3:
            s._scriptPointer.seek(s.resStrLen(null) + 1);
          break;
          case 4:
          case 0x1F:
            return;
        }
      }
    },
    // only the number of slots: saving and loading are the F5 menu's
    saveLoadGame: function() {
      var a;
      s.getResultPos();
      a = s.getVarOrDirectByte(PARAM_1);
      s.setResult((a & 0xE0) == 0 ? 100 : 0);
    }
  };
  s._opcodeCommandsV4 = V4;

  // script_v4.cpp setupOpcodes, over v5's table
  s.buildOpcodesV4 = function() {
    var table = {}, k;
    for (k in s._opcodeTables[5]) table[k] = s._opcodeTables[5][k];
    [0x25, 0x45, 0x65, 0xa5, 0xc5, 0xe5].forEach(function(o) { table[o] = C.drawObject; });
    table[0x50] = table[0xd0] = V4.pickupObject;
    table[0x5c] = table[0xdc] = V4.oldRoomEffect;
    [0x0f, 0x4f, 0x8f, 0xcf].forEach(function(o) { table[o] = V4.ifState; });
    [0x2f, 0x6f, 0xaf, 0xef].forEach(function(o) { table[o] = V4.ifNotState; });
    table[0xa7] = V4.saveLoadVars;
    table[0x22] = table[0xa2] = V4.saveLoadGame;
    delete table[0x3b];
    delete table[0x4c];
    delete table[0xbb];
    return table;
  };
  s._opcodeTables[4] = s.buildOpcodesV4();
}());
