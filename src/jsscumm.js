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
      if(e.shutdownSound) e.shutdownSound();
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
    // a screen shake moves the picture down a few lines
    var shake = e && e._shakePos ? Math.round(e._shakePos * t.canvas.height / t.height) : 0;
    if (shake) {
      t.displayContext.fillStyle = "black";
      t.displayContext.fillRect(0, 0, t.canvas.width, shake);
    }
    t.displayContext.drawImage(t.buffer,
      0, 0, t.width, t.height,
      0, shake, t.canvas.width, t.canvas.height);

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
    if (!eng || !eng._timer || eng._menuOpen || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    // Enter or Space on a focused sound control is for the control
    if (e.target && /^(speaker-knob|sound-switch|info-switch)$/.test(e.target.id) && /^(Enter| )$/.test(e.key)) return;
    if (e.key.length == 1) ascii = e.key.charCodeAt(0) & 0xFF;
    else ascii = {Enter: 13, Tab: 9, Escape: 27, Backspace: 8}[e.key] || 0;
    if (!ascii && !/^F[1-9]$/.test(e.code)) return;
    eng._keyHit = {code: e.code, ascii: ascii, ctrl: e.ctrlKey};
    e.preventDefault();
  });

  // --- the speakers' light and knob --------------------------------------
  // Browsers hold sound back until the first click or key press on the
  // page. Until then the light on the speaker is red; once sound may play
  // (and the game's AudioContext, if it has one yet, is running) it turns
  // green. The knob mutes the game (sound.js), and so does the sound button
  // on the monitor that stands in for it when the speakers are hidden; the
  // light is out while the sound is off.
  var desk = document.querySelector(".desk"),
      soundControls = [document.getElementById("speaker-knob"), document.getElementById("sound-switch")],
      activated = false, watched = null, unblockedNow = false, unblockUsed = false;

  // The controls show whether sound is actually coming out: off while it
  // is muted, and also, on load, while the browser is holding it back
  function updateSoundControls() {
    var blocked = !!desk && desk.classList.contains("is-muted"), on = !ScummVM.muted && !blocked;
    if (desk) desk.classList.toggle("is-sound-off", !!ScummVM.muted);
    soundControls.forEach(function(el) {
      if (!el) return;
      el.setAttribute("aria-pressed", on ? "true" : "false");
      el.title = on ? "Sound on: click to mute the game" : "Sound off: click to turn it on";
    });
  }

  soundControls.forEach(function(el) {
    if (!el) return;
    el.addEventListener("click", function(e) {
      // The click that lets the page play sound at all is taken to be
      // asking for sound: it does not also turn it off
      if (unblockedNow && !ScummVM.muted) unblockUsed = true;
      else if (ScummVM.setMuted) ScummVM.setMuted(!ScummVM.muted);
      unblockedNow = false;
      updateSoundControls();
      // after a mouse click, give the keyboard back to the game
      if (e.detail) el.blur();
    });
  });
  updateSoundControls();

  function updateSpeakerLight() {
    var ctx = ScummVM.audioContext, ok;
    if (ctx && ctx !== watched) {
      watched = ctx;
      ctx.addEventListener("statechange", updateSpeakerLight);
    }
    ok = activated || !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
    if (ctx && ctx.state != "running") ok = false;
    if (!desk) return;
    desk.classList.toggle("is-muted", !ok);
    desk.querySelectorAll(".speaker").forEach(function(el) {
      if (ok) el.removeAttribute("title");
      else el.title = "Click the page to turn the sound on";
    });
    updateSoundControls();
  }

  ["mousedown", "keydown", "touchstart"].forEach(function(type) {
    window.addEventListener(type, function() {
      var wasBlocked = desk && desk.classList.contains("is-muted");
      activated = true;
      updateSpeakerLight();
      // (the AudioContext may take a moment to resume, so this goes by the
      // light having been red when the gesture came, once only)
      unblockedNow = wasBlocked && !unblockUsed;
      // the AudioContext resumes asynchronously; statechange covers it once
      // it exists, this covers the one created by this same gesture
      window.setTimeout(updateSpeakerLight, 200);
    }, true);
  });
  updateSpeakerLight();

  // --- the Info switch ----------------------------------------------------
  // At the top of the page: info mode shows the engine log, the
  // instructions and the credits on the plain page, in place of the 90s
  // desk around the computer (all CSS, in index.html). Kept in
  // localStorage; the head script applies it before the first paint.
  var root = document.documentElement, infoSwitch = document.getElementById("info-switch");
  if (infoSwitch) {
    infoSwitch.setAttribute("aria-pressed", root.classList.contains("has-info") ? "true" : "false");
    infoSwitch.addEventListener("click", function(e) {
      var on = root.classList.toggle("has-info");
      root.classList.toggle("has-room", !on);
      infoSwitch.setAttribute("aria-pressed", on ? "true" : "false");
      try { window.localStorage.setItem("jsscummvm.info", on ? "1" : "0"); } catch (err) { /* not kept */ }
      if (e.detail) infoSwitch.blur();
      queueFit();
    });
  }

  // --- the room's things at the window's edges ----------------------------
  // The desk runs off both sides of the window, but what stands on it and
  // hangs on the wall should not be cut in half: like the speakers, each
  // fades out once any part of it would be past an edge (.is-out, in
  // index.html). They are sized from the monitor, which CSS sizes from the
  // window, so they are measured again whenever the window changes.
  var roomThings = document.querySelectorAll(".room > :not(.room-wall):not(.room-desktop), .room-front > *"),
      fitQueued = false;

  function fitRoom() {
    var width = root.clientWidth;
    fitQueued = false;
    if (!root.classList.contains("has-room")) return;
    roomThings.forEach(function(el) {
      // the lamp is an empty box with its arms hanging out of it, so take
      // in everything inside each one
      var left = Infinity, right = -Infinity;
      [el].concat(Array.prototype.slice.call(el.querySelectorAll("*"))).forEach(function(part) {
        var r = part.getBoundingClientRect();
        if (!r.width && !r.height) return;
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      });
      el.classList.toggle("is-out", left < 0 || right > width);
    });
  }

  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    window.requestAnimationFrame(fitRoom);
  }

  window.addEventListener("resize", queueFit);
  fitRoom();

  // --- keys on a touch screen ---------------------------------------------
  // Phones and tablets have no Esc or F5, so buttons stand in for the keys
  // the game needs (index.html shows them while a game runs). Each one is
  // sent as that key pressed, so the save menu and the game take it just as
  // they would from a keyboard.
  document.querySelectorAll(".vkey").forEach(function(el) {
    el.addEventListener("click", function(e) {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: el.getAttribute("data-key"),
        code: el.getAttribute("data-code"),
        bubbles: true,
        cancelable: true
      }));
      // give the keyboard, if there is one, back to the game
      if (e.detail) el.blur();
    });
  });

}());
