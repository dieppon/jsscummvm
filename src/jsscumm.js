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
    t.engine.init(game, t.source && t.source.version);
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
  // A key for the game, as processKeyboard takes it, from the keyboard
  // (below) or from a touch screen's keys. False if the game does not take
  // it: not running, the save menu up, or not a key it uses.
  ScummVM.pressKey = function(key, code, ctrl) {
    var eng = ScummVM.engine, ascii;
    if (!eng || !eng._timer || eng._menuOpen) return false;
    if (key.length == 1) ascii = key.charCodeAt(0) & 0xFF;
    else ascii = {Enter: 13, Tab: 9, Escape: 27, Backspace: 8}[key] || 0;
    if (!ascii && !/^F[1-9]$/.test(code)) return false;
    // queued, one taken a frame: keys typed faster than the game's frames
    // (a copy protection answer, say) would otherwise overwrite each other
    if (eng._keyQueue.length < 16) eng._keyQueue.push({code: code, ascii: ascii, ctrl: !!ctrl});
    return true;
  };

  window.document.addEventListener("keydown", function(e) {
    if (e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    // nor while a box (the feed's, the shelf's) is up
    if (document.querySelector("dialog[open]")) return;
    // Enter or Space on a focused control is for the control
    if (e.target && /^(speaker-knob|sound-switch|info-switch)$/.test(e.target.id) && /^(Enter| )$/.test(e.key)) return;
    if (e.target && e.target.classList && e.target.classList.contains("vkey") && /^(Enter| )$/.test(e.key)) return;
    if (ScummVM.pressKey(e.key, e.code, e.ctrlKey)) e.preventDefault();
  });

  // --- the speakers' light and knob --------------------------------------
  // Browsers hold sound back until the first click or key press on the
  // page. Until then the light on the speaker is red; once sound may play
  // (and the game's AudioContext, if it has one yet, is running) it turns
  // green. The knob mutes the game (sound.js), and so does the sound button
  // on the monitor that stands in for it when the speakers are hidden; the
  // light is red while the sound is off.
  var desk = document.querySelector(".desk"),
      soundControls = [document.getElementById("speaker-knob"), document.getElementById("sound-switch")],
      activated = false, watched = null;

  // The controls show the choice -- sound on or off -- which the session
  // keeps (sound.js); that the browser is still holding it back after a
  // reload is the light's to say
  function updateSoundControls() {
    var on = !ScummVM.muted;
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
      if (ScummVM.setMuted) ScummVM.setMuted(!ScummVM.muted);
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
    // (suspended by the save menu is still sound that may play)
    if (ctx && ctx.state != "running" && !ScummVM.soundSuspended) ok = false;
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
      activated = true;
      updateSpeakerLight();
      // the AudioContext resumes asynchronously; statechange covers it once
      // it exists, this covers the one created by this same gesture
      window.setTimeout(updateSpeakerLight, 200);
    }, true);
  });
  updateSpeakerLight();
  // sound.js, which reads whether the sound was left on, loads after this
  document.addEventListener("DOMContentLoaded", updateSpeakerLight);

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

  // --- the shelf ----------------------------------------------------------
  // A box on the shelf for each game in the feed, showing the spine picture
  // the feed gives it (made as wide as that picture is for its height), or
  // just its name if it has none. Clicking one loads that game, after
  // asking first; not the game already in the machine.
  function stockShelf(games) {
    var shelf = document.querySelector(".room-shelf");
    if (!shelf) return;
    shelf.textContent = "";
    games.forEach(function(game) {
      var box = document.createElement("button"),
          spine = game.item && game.item.spine,
          name = document.createElement("b");
      box.type = "button";
      box.title = game.title;
      box.setAttribute("aria-label", game.title);
      box.dataset.game = game.id;
      if (!game.supported) box.classList.add("unsupported");
      box.addEventListener("click", function() { askToLoad(game); });
      // a click leaves the focus where it was (the DOS prompt, say), for the
      // box to give back when it closes
      box.addEventListener("mousedown", function(e) { e.preventDefault(); });
      shelf.appendChild(box);
      function plain() {
        box.classList.add("no-spine");
        box.style.backgroundImage = "";
        name.textContent = game.title;
        box.appendChild(name);
        queueFit();
      }
      if (typeof spine != "string" || !/^https?:\/\//i.test(spine)) { plain(); return; }
      var img = new Image();
      img.onload = function() {
        if (!img.naturalWidth || !img.naturalHeight) { plain(); return; }
        box.style.setProperty("--aspect", (img.naturalWidth / img.naturalHeight).toFixed(4));
        box.style.backgroundImage = "url(\"" + spine.replace(/["\\\n]/g, encodeURIComponent) + "\")";
        queueFit();
      };
      img.onerror = plain;
      img.src = spine;
    });
    markCurrentGame();
    queueFit();
  }

  // The game in the machine (dos-shell.js says, as it starts one and as the
  // machine goes off): its box is not one to load.
  ScummVM.currentGame = null;
  ScummVM.setCurrentGame = function(id) {
    ScummVM.currentGame = id || null;
    markCurrentGame();
  };
  function markCurrentGame() {
    document.querySelectorAll(".room-shelf > button").forEach(function(box) {
      var current = box.dataset.game === ScummVM.currentGame;
      box.classList.toggle("is-current", current);
      box.setAttribute("aria-disabled", current ? "true" : "false");
    });
  }

  // Ask, then load: the address is given the game (?game=, as a link to it
  // would be) and the page loads again, so the new game starts as cleanly as
  // any other. While the box is up the game, and its sound, wait.
  var shelfDialog = document.getElementById("shelf-dialog"), heldGame = null;

  function askToLoad(game) {
    var e = ScummVM.engine, text = document.getElementById("shelf-dialog-text"),
        load = document.getElementById("shelf-load"), title = game.title;
    if (!shelfDialog || game.id === ScummVM.currentGame || shelfDialog.open) return;
    shelfDialog.dataset.game = game.id;
    if (!game.supported) {
      text.textContent = title + " does not run in JS ScummVM yet.";
      load.hidden = true;
      document.getElementById("shelf-cancel").textContent = "OK";
    } else {
      text.textContent = "Load " + title + "?" + (ScummVM.currentGame
        ? " The game that is running now will be closed, and anything not saved will be lost."
        : "");
      load.hidden = false;
      document.getElementById("shelf-cancel").textContent = "Cancel";
    }
    if (e && !e._menuOpen) {
      heldGame = e;
      e._menuOpen = true;
      if (e.pauseSound) e.pauseSound(true);
    }
    shelfDialog.returnValue = "";
    shelfDialog.showModal();
    (load.hidden ? document.getElementById("shelf-cancel") : load).focus();
  }

  if (shelfDialog) shelfDialog.addEventListener("close", function() {
    var url;
    if (heldGame) {
      heldGame._menuOpen = false;
      if (heldGame.pauseSound) heldGame.pauseSound(false);
      heldGame = null;
    }
    if (shelfDialog.returnValue !== "load") return;
    url = new URL(window.location.href);
    url.searchParams.set("game", shelfDialog.dataset.game);
    window.location.assign(url.href);
  });

  document.addEventListener("DOMContentLoaded", function() {
    if (ScummVM.feedLoaded) ScummVM.feedLoaded.then(stockShelf);
  });

  // --- keys on a touch screen ---------------------------------------------
  // Phones and tablets have no Esc or F5, so buttons stand in for the keys
  // the game needs (index.html shows them while a game runs). Each does
  // what that key does: F5 opens and closes the save menu, Esc also closes
  // it, and the rest go to the game. They call the menu and the game
  // directly rather than faking a key event, which mobile Safari need not
  // deliver as a real one.
  document.querySelectorAll(".vkey").forEach(function(el) {
    el.addEventListener("click", function(e) {
      var key = el.getAttribute("data-key"), eng = ScummVM.engine,
          menuOpen = !!(eng && eng._menuOpen);
      if (key == "F5") {
        if (menuOpen) ScummVM.closeSaveMenu();
        else if (ScummVM.openSaveMenu) ScummVM.openSaveMenu();
      } else if (key == "Escape" && menuOpen) {
        ScummVM.closeSaveMenu();
      } else {
        ScummVM.pressKey(key, el.getAttribute("data-code"));
      }
      // give the keyboard, if there is one, back to the game
      if (e.detail) el.blur();
    });
  });

}());
