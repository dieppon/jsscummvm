var ScummVM = {
  width: 320,
  height: 200,
  // The engine always renders at the logical 320x200 above; `scale` only
  // enlarges the visible canvas. Set it to 1 for the previous behaviour.
  scale: 2,
  // 320x200 was shown on 4:3 monitors, so its pixels were not square. This
  // stretches the picture back to the shape it was drawn for: 200 * 1.2 = 240
  // rows, i.e. a 640x480 canvas at scale 2. Set it to 1 for square pixels.
  pixelAspect: 1.2,
  engines: {},
  engine: null,
  canvas: null,
  context: null,
  debugLevel: 3
};

function log(message) {
  // window.console.log(message);
  var el = document.getElementById("console");
  if (!el) return;
  el.insertAdjacentHTML("afterbegin", message + "<br />");
  // keep the newest few hundred lines; it used to grow for the whole game
  if (el.childNodes.length > 1000)
    while (el.childNodes.length > 600) el.removeChild(el.lastChild);
}

function debug(level, message) {
  if(level <= ScummVM.debugLevel)
    log(message);
}

function error(message) {
  log("ERROR "+message);
}

function assert(condition) {
  if(!condition) {
    log("ASSERTION FAILED!");
  }
}

(function(){
  var canvas = document.getElementById("jsscummvm");
  ScummVM.load = function(game) {
    var t = ScummVM;
    t.canvas = canvas;
    t.init_graphics();
    t.engine = ScummVM.engines.SCUMM;
    // shutdown() leaves this set; clear it or the new run quits on its
    // first tick.
    t.engine._shouldQuit = false;
    t.engine.init(game);
    t.engine.go();
  };

  // Stop the engine and blank the screen. The main loop is a setInterval
  // that schedules a setTimeout per frame, so killing the interval can
  // still leave one frame pending -- _shouldQuit makes that frame bail out
  // before it draws, rather than painting over the blanked screen.
  ScummVM.shutdown = function() {
    var t = ScummVM, e = t.engine;
    if(e) {
      e._shouldQuit = true;
      if(e._timer) { window.clearTimeout(e._timer); e._timer = 0; }
    }
    t.engine = null;
    if(t.context) {
      t.context.fillStyle = "black";
      t.context.fillRect(0, 0, t.width, t.height);
      t.present();
    }
  };
  ScummVM.init_graphics = function() {
    var t = this;

    // Everything in the engine draws through t.context at 320x200. Point it
    // at an offscreen buffer of exactly that size and blow the buffer up to
    // the visible canvas in present(), so the canvas can be as large as we
    // like without the engine ever knowing about it.
    t.buffer = document.createElement("canvas");
    t.buffer.width = t.width;
    t.buffer.height = t.height;
    t.context = t.buffer.getContext('2d');

    t.canvas.width = t.width * t.scale;
    t.canvas.height = Math.round(t.height * t.scale * t.pixelAspect);
    t.displayContext = t.canvas.getContext('2d');
    // Nearest-neighbour, so upscaled pixel art stays crisp rather than blurry.
    t.displayContext.imageSmoothingEnabled = false;
    t.displayContext.mozImageSmoothingEnabled = false;
    t.displayContext.webkitImageSmoothingEnabled = false;
    t.displayContext.msImageSmoothingEnabled = false;

    t.context.fillRect(0,0,t.width,t.height);
    t.present();
  };

  ScummVM.present = function() {
    var t = this, e = t.engine;
    t.displayContext.drawImage(t.buffer,
      0, 0, t.width, t.height,
      0, 0, t.canvas.width, t.canvas.height);

    // The cursor goes on last, onto the visible canvas rather than the
    // buffer, so it can be moved by calling present() again without
    // smearing and without waiting for the next engine frame.
    if (e && e.drawCursorTo) {
      e.drawCursorTo(t.displayContext,
                     t.canvas.width / t.width,
                     t.canvas.height / t.height);
    }
  };

  // --- mouse ------------------------------------------------------------
  // The canvas is displayed at an arbitrary size; the engine thinks in
  // 320x200. Map through the element's rect rather than its backing store,
  // since CSS scales it to fit the window.
  function toScreen(e) {
    var t = ScummVM, r = t.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.floor((e.clientX - r.left) / r.width  * t.width),
      y: Math.floor((e.clientY - r.top)  / r.height * t.height)
    };
  }

  function track(e) {
    var p = toScreen(e), eng = ScummVM.engine;
    if (!p || !eng) return;
    eng._mouse.x = p.x;
    eng._mouse.y = p.y;
    // repaint immediately: the engine frame rate is far too low to move a
    // cursor at
    if (ScummVM.buffer) ScummVM.present();
  }

  canvas.addEventListener("mousemove", track);

  // Keep the cursor pulsing (and present) even when neither the pointer nor
  // the engine is moving -- the engine's own frame rate is far too low.
  window.setInterval(function () {
    if (ScummVM.buffer && ScummVM.engine) ScummVM.present();
  }, 60);

  canvas.addEventListener("mousedown", function(e) {
    var eng = ScummVM.engine;
    track(e);
    if (!eng) return;
    // MS_DOWN | MS_CLICKED: processInput consumes the CLICKED bit each frame
    if (e.button === 0) eng._leftBtnPressed  |= MS_DOWN | MS_CLICKED;
    if (e.button === 2) eng._rightBtnPressed |= MS_DOWN | MS_CLICKED;
    e.preventDefault();
  });

  canvas.addEventListener("mouseup", function(e) {
    var eng = ScummVM.engine;
    if (!eng) return;
    if (e.button === 0) eng._leftBtnPressed  &= ~MS_DOWN;
    if (e.button === 2) eng._rightBtnPressed &= ~MS_DOWN;
  });

  // right click is a verb action in SCUMM, not a context menu
  canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

  // Keys go to the engine as ScummVM's processKeyboard sees them: Esc skips
  // a cutscene, '.' a line of speech, space pauses, the rest reach the
  // game's input script (verb shortcuts and so on). keydown, because Esc
  // never fires keypress.
  window.document.addEventListener("keydown", function(e) {
    var eng = ScummVM.engine, ascii;
    if (!eng || !eng._timer || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key.length == 1) ascii = e.key.charCodeAt(0) & 0xFF;
    else ascii = {Enter: 13, Tab: 9, Escape: 27, Backspace: 8}[e.key] || 0;
    if (!ascii && !/^F[1-9]$/.test(e.code)) return;
    eng._keyHit = {code: e.code, ascii: ascii, ctrl: e.ctrlKey};
    e.preventDefault();
  });

}());
