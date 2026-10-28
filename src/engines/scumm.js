var PARAM_1 = 0x80, PARAM_2 = 0x40, PARAM_3 = 0x20;

// mouse button state, from input.cpp / scumm.h
var MBS_LEFT_CLICK = 0x8000, MBS_RIGHT_CLICK = 0x4000, MBS_MAX_KEY = 0x0200,
    MBS_MOUSE_MASK = MBS_LEFT_CLICK | MBS_RIGHT_CLICK,
    MS_DOWN = 1, MS_CLICKED = 2;

(function(){
  var _system = ScummVM.system, Point = _system.Point;

  ScummVM.engines.SCUMM = {
    _screenWidth: 320,
    _screenHeight: 200,
    _engineStartTime: 0,
    _files: [],
    _file: null,
    _filenames: {},
    _fileOffset: 0,
    _game: "",
    _roomoffs: {},
    _roomno: {},
    _roomResource: 0,
    _lastLoadedRoom: -1,
    _nums: {},
    _objs: [],
    _inventory: [],
    _newNames: [],
    _egoPositioned: false,
    _objectRoomTable: [],
    _objectOwnerTable: [],
    _objectStateTable: [],
    _classData: [],
    _bootParam: 0,
    _scummVars: [],
    _scummStackPos: 0,
    _bitVars: [],
    _vm: null,
    _vmstack: [],
    _currentScript: 0xFF,
    _currentRoom: 0,
    _numObjectsInRoom: 0,
    _scriptPointer: null,
    _scriptOrgPointer: null,
    _lastCodePointer: null,
    _res: null,
    _vars: {},
    _verbs: [],
    _opcodes: {},
    _scriptFile: null,
    _dumpScripts: false,
    _completeScreenRedraw: true,
    _shouldQuit: false,
    _timer: 0,
    _virtscreens: [],
    _resultVarNumber: 0,
    _string: [],
    _textLayer: [],
    _actorToPrintStrFor: 0,
    _roomPalette: [],
    _currentPalette: [],
    _palDirtyMin: 0,
    _palDirtyMax: 0,
    _haveMsg: 0,
    _haveActorSpeechMsg: false,
    _talkDelay: 0,
    _useTalkAnims: false,
    _defaultTalkDelay: 0,
    _curPalIndex: 0,
    _resourceHeaderSize: 8,
    _resourceLastSearchSize: 0,
    _resourceLastSearchBuf: null,
    _gdi: null,
    _gfx: {ENCD: 0, EXCD:0, EPAL:0, CLUT:0, PALS:0},
    _drawObjectQue: [],
    _debugMode: 0,
    _debug: false,
    _screenStartStrip: 0,
    _screenEndStrip: 0,
    _localScriptOffsets: [],
    _skipDrawObject: false,
    _texts: [],
    _charsetData: [],
    _charsetColorMap: [],
    _charset: null,
    _curCharset: 1,
    _actors: [],
    _sortedActors: [],
    _keyHit: null,
    _paused: false,
    // input.cpp: _mouse is in screen coords, _virtualMouse is offset by the
    // main virtual screen's scroll and topline. msDown/msClicked mirror
    // ScummVM's left/right button state machine.
    _mouse: {x: 0, y: 0},
    _virtualMouse: {x: 0, y: 0},
    _leftBtnPressed: 0,
    _rightBtnPressed: 0,
    _mouseAndKeyboardStat: 0,
    _userPut: 0,
    // sentence queue (script.cpp). doSentence pushes, checkAndRunSentenceScript
    // pops one per frame and hands it to VAR_SENTENCE_SCRIPT.
    _sentence: [],
    _sentenceNum: 0,
    _cursorState: 0,
    _cursorAnimate: 1,
    _cursorAnimateIndex: 0,
    _currentCursor: 0,
    _camera: {cur: Point(0,0), dest: Point(0,0), accel: Point(0,0), last: Point(0,0), follows: 0, mode: "normal", movingToActor:false, leftTrigger: 10, rightTrigger: 30},
    init: function(game) {
      this._game = game;
      this.initGraphics();
    },
    setFile: function(file_no, filename, data) {
      stream = new ScummVM.Stream(data, filename);
      stream.encByte = 0x69;
      this._files[file_no] = stream;
      this._filenames[filename] = file_no;
    },
    go: function() {
      var t = this;
      _system.loadGameFiles(this._game, [0, 1], function() {
          t.launch();
      });
    },
    launch: function() {
      var t = this;
      if(t._files.length > 1) {
        var diff = 0, delta = 0;

        t._file = t.indexFile();
        t._engineStartTime = _system.getMillis() / 1000;
        t._res = new t.ResourceManager(t);

        t.setupScumm();
        t.readIndexFile();
        t.resetScumm();
        t.resetScummVars();
        t.runBootscript();

        // scumm.cpp's main loop: wait VAR_TIMER_NEXT jiffies (1/60 s), run
        // a frame, repeat. The script sets the pace -- this used to run a
        // fixed 12 frames a second whatever it asked for, so delays, walking
        // and talk timing were all off unless it happened to ask for 5.
        // Waits are measured from when the last one was due, not from now,
        // so a slow frame does not make the game drift (_lastWaitTime).
        t._lastWaitTime = _system.getMillis();
        var tick = function() {
          var delta = t.scummVar("timer_next"), target;
          if(!(delta >= 1)) delta = 1;
          target = t._lastWaitTime + delta * 1000 / 60;
          t._timer = window.setTimeout(function() {
            var now = _system.getMillis();
            if(t._shouldQuit) return;
            // fell far behind (a background tab): start counting afresh
            t._lastWaitTime = now > target + 100 ? now : target;
            try {
              t.loop(delta);
            } finally {
              if(!t._shouldQuit) tick();
            }
          }, Math.max(0, target - _system.getMillis()));
        };
        tick();
      }
    },
    waitForTimer: function(ticks, callback) {
      window.setTimeout(callback, ticks);
    },
    loop: function(delta) {
      var t = ScummVM.engines.SCUMM;

      // Paused: only watch for the key that ends it
      if(t._paused) {
        t.processInput();
        return;
      }

      t.scummVar("timer", delta);
      t.scummVar("timer_total", t.scummVar("timer_total") + delta);

      t.scummVar("tmr_1", t.scummVar("tmr_1") + delta);
      t.scummVar("tmr_2", t.scummVar("tmr_2") + delta);
      t.scummVar("tmr_3", t.scummVar("tmr_3") + delta);

      // VAR_MUSIC_TIMER is the CD timer: frames since the current CD track
      // started, whether or not there is audio for it
      t.updateMusicTimer(delta);

      if(delta > 15)
        delta = 15;

      t.decreaseScriptDelay(delta);

      // Speech runs on game time; displayDialog moves on to the next part of
      // the message, or ends it, once this reaches 0
      t._talkDelay -= delta;
      if(t._talkDelay < 0) t._talkDelay = 0;

      this.processInput();
      t.updateScummVars();
      if(t._completeScreenRedraw) {
        // Draw Verbs
        t._completeScreenRedraw = false;
        t._fullRedraw = true;
      }

      t.runAllScripts();
      t.checkExecVerbs();
      t.checkAndRunSentenceScript();

      if(t.shouldQuit()) {
        window.clearTimeout(t._timer);
        return;
      }

      if(t._currentRoom == 0) {
        t.displayDialog();
        t.drawDirtyScreenParts();
      } else {
        t.walkActors();
        t.moveCamera();
        t.updateObjectStates();
        t.displayDialog();
        if(t._bgNeedsRedraw || t._fullRedraw)
          t.redrawBGAreas();
        t.processDrawQueue();

        t.resetActorBgs();
        t.processActors();

        t._fullRedraw = false;

        if(t.scummVar("main_script")) {
          t.runScript(t.scummVar("main_script"), 0, 0, 0);
        }

        t.updatePalette();
        t.drawDirtyScreenParts();

        // scumm.cpp: v5 plays costume sounds after drawing
        t.playActorSounds();
      }

      // scummLoop_handleSound: the sounds the scripts started this frame
      t.processSound();

      // scumm.cpp sets this at the very end of the frame; everything that
      // asks "did the camera move?" during the frame compares against it
      t._camera.last.x = t._camera.cur.x;
    },
    updateScummVars: function() {
      var t = this;
      t.scummVar("have_msg", t._haveMsg);
      t.scummVar("virt_mouse_x", t._virtualMouse.x);
      t.scummVar("virt_mouse_y", t._virtualMouse.y);
      t.scummVar("mouse_x", t._mouse.x);
      t.scummVar("mouse_y", t._mouse.y);
      t.scummVar("camera_pos_x", t._camera.cur.x);
    },
    shouldQuit: function() {
      var t = ScummVM.engines.SCUMM;
      if(t._shouldQuit) return true;
      return false;
    },
    processInput: function() {
      var t = this, vs, key = t._keyHit;
      t._keyHit = null;

      // clip the pointer, then derive the virtual (room-space) position
      if(t._mouse.x < 0) t._mouse.x = 0;
      if(t._mouse.x > t._screenWidth - 1) t._mouse.x = t._screenWidth - 1;
      if(t._mouse.y < 0) t._mouse.y = 0;
      if(t._mouse.y > t._screenHeight - 1) t._mouse.y = t._screenHeight - 1;

      vs = t._virtscreens[0];
      t._virtualMouse.x = t._mouse.x + (vs ? vs.xstart : 0);
      t._virtualMouse.y = t._mouse.y - (vs ? vs.topline : 0);
      if(vs && (t._virtualMouse.y < 0 || t._virtualMouse.y >= vs.h))
        t._virtualMouse.y = -1;

      // input.cpp: button state for this frame. Both buttons at once is the
      // cutscene exit key, as in the original.
      t._mouseAndKeyboardStat = 0;
      if((t._leftBtnPressed & MS_CLICKED) && (t._rightBtnPressed & MS_CLICKED))
        key = {code: "Escape", ascii: 27};
      else if(t._leftBtnPressed & MS_CLICKED) t._mouseAndKeyboardStat = MBS_LEFT_CLICK;
      else if(t._rightBtnPressed & MS_CLICKED) t._mouseAndKeyboardStat = MBS_RIGHT_CLICK;
      t._leftBtnPressed  &= ~MS_CLICKED;
      t._rightBtnPressed &= ~MS_CLICKED;

      if(key) t.processKeyboard(key);
    },
    // input.cpp processKeyboard, without ScummVM's own menus
    processKeyboard: function(key) {
      var t = this, f;
      if(key.code == "Space" && t.scummVar("pause_key") != 0) {
        t._paused = !t._paused;
      } else if(key.ascii == 46 && t.scummVar("talkstop_key") != 0) {   // '.'
        t._talkDelay = 0;
      } else if(key.code == "Escape" && t.scummVar("cutsceneexit_key") != 0) {
        t.abortCutscene();
        t._mouseAndKeyboardStat = t.scummVar("cutsceneexit_key");
      } else {
        f = /^F([1-9])$/.exec(key.code);
        if(f) t._mouseAndKeyboardStat = 315 + (+f[1] - 1);
        else if(key.ctrl && /^Key[A-Z]$/.test(key.code))
          t._mouseAndKeyboardStat = key.code.charCodeAt(3) & 0x1F;
        else
          t._mouseAndKeyboardStat = key.ascii;
        // Enter and Tab click, while the cursor is on
        if(t._mouseAndKeyboardStat == 13 && t._cursorState > 0)
          t._mouseAndKeyboardStat = MBS_LEFT_CLICK;
        else if(t._mouseAndKeyboardStat == 9 && t._cursorState > 0)
          t._mouseAndKeyboardStat = MBS_RIGHT_CLICK;
      }
    },
    setupScumm: function() {
      var t = this, res = t._res;

      res.allocResTypeData("buffer", 0, 10, "buffer", 0);
      t.setupScummVars();
      t._vm = new t.VirtualMachineState();
    },
    resetScumm: function() {
      var t = this, i;
      t.initStrings();
      t.initSound();
      t.initScreens(16, 144);
      t._currentRoom = 0;
      for(i = 0; i < 256; i++)
        t._roomPalette[i] = i;
      t.resetPalette();
      t.initCharset(1);
      t.initVerbs();
      // t._cursor.animate = 1;
      for(i = 0; i < t._nums['actors']; i++)
        t._actors[i] =  new t.Actor(i);
      t._vm.numNestedScripts = 0;
      // verbs
      // camera triggers
      // camera._follows = 0;
      t._virtscreens[0].xstart = 0;
      t._currentScript = 0xFF;
      t._currentRoom = 0;
      t._numObjectsInRoom = 0;
      t._actorToPrintStrFor = 0;
      t._fullRedraw = true;

      t.clearDrawObjectQueue();
    }
  };
}());
