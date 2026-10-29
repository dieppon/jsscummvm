/*
 * The save/load menu: F5 during the game, as in the original interpreter.
 * Nine slots kept in the browser (engines/saveload.js); the game is held
 * while the menu is open.
 */
(function(){
  var SLOTS = 9, menu = null;

  function engine() {
    var e = ScummVM.engine;
    return e && e._timer ? e : null;
  }

  function describe(d) {
    if (!d) return "- empty -";
    var when = new Date(d.date);
    return d.name + "  " + when.toLocaleDateString() + " " +
           when.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
  }

  function close() {
    var e = ScummVM.engine;
    if (menu) { menu.remove(); menu = null; }
    if (e) e._menuOpen = false;
  }

  function open() {
    var e = engine(), view, slots, i, row, label, save, load;
    if (!e || menu) return;
    e._menuOpen = true;
    slots = e.listSlots(SLOTS);

    view = document.querySelector(".screen-view");
    menu = document.createElement("div");
    menu.className = "savemenu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Save or load a game");
    menu.innerHTML = '<div class="savemenu-title">SAVE / LOAD GAME</div>';

    for (i = 1; i <= SLOTS; i++) {
      row = document.createElement("div");
      row.className = "savemenu-row";
      label = document.createElement("span");
      label.className = "savemenu-label";
      label.textContent = i + ". " + describe(slots[i - 1]);
      save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.onclick = (function(n) {
        return function() {
          var g = ScummVM.engine;
          if (g.saveToSlot(n, "Room " + g._currentRoom)) close();
        };
      })(i);
      load = document.createElement("button");
      load.type = "button";
      load.textContent = "Load";
      load.disabled = !slots[i - 1];
      load.onclick = (function(n) {
        return function() {
          if (ScummVM.engine.loadFromSlot(n)) close();
        };
      })(i);
      row.appendChild(label);
      row.appendChild(save);
      row.appendChild(load);
      menu.appendChild(row);
    }
    var foot = document.createElement("div");
    foot.className = "savemenu-foot";
    foot.textContent = "F5 or Esc to return to the game";
    menu.appendChild(foot);
    view.appendChild(menu);
    var first = menu.querySelector("button");
    if (first) first.focus();
  }

  // F5 opens and closes it; Esc closes it. Capture phase, so the game never
  // sees those two; other keys reach the menu's buttons, and the game's own
  // handler ignores them while the menu is up.
  window.addEventListener("keydown", function(ev) {
    if (ev.key == "F5" && engine()) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (menu) close(); else open();
    } else if (menu && ev.key == "Escape") {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      close();
    }
  }, true);

  // A line of text over the game for a moment, like the original's banners
  var banner = null, bannerTimer = null;
  function showBanner(text) {
    var view = document.querySelector(".screen-view");
    if (!view) return;
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "banner";
      banner.setAttribute("role", "status");
    }
    banner.textContent = text;
    view.appendChild(banner);
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(function() { banner.remove(); }, 1500);
  }

  ScummVM.openSaveMenu = open;
  ScummVM.closeSaveMenu = close;
  ScummVM.showBanner = showBanner;
}());
