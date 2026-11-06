/*
 * dos-shell.js -- a small MS-DOS impersonation that owns the CRT screen
 * until you launch the game.
 *
 * It is all smoke and mirrors: one fake C: drive, a handful of commands and
 * an 80x25 text mode faked with a monospace font. The only real things in it
 * are the sizes of MONKEY1.000 and MONKEY1.001, which are the actual byte
 * counts of the game's files.
 *
 * Typing MONKEY1 (or MONKEY1.EXE) in C:\GAMES fetches the game (feed.js),
 * showing how that goes, and hands the screen to ScummVM.
 */
(function () {
  "use strict";

  var COLS = 80, ROWS = 25;

  var DIR = { dir: true };

  /* --- the fake drive ------------------------------------------------- */

  var DRIVE = {
    "C:\\": [
      ["DOS",      "",    DIR,     "05-15-91", "10:22a"],
      ["GAMES",    "",    DIR,     "08-02-91", " 3:14p"],
      ["AUTOEXEC", "BAT", 128,     "05-15-91", "10:20a"],
      ["COMMAND",  "COM", 47845,   "04-09-91", " 5:00a"],
      ["CONFIG",   "SYS", 94,      "05-15-91", "10:20a"]
    ],
    "C:\\DOS": [
      [".",        "",    DIR,     "05-15-91", "10:22a"],
      ["..",       "",    DIR,     "05-15-91", "10:22a"],
      ["HIMEM",    "SYS", 11304,   "04-09-91", " 5:00a"],
      ["EDIT",     "COM", 413,     "04-09-91", " 5:00a"],
      ["FORMAT",   "COM", 32911,   "04-09-91", " 5:00a"],
      ["MORE",     "COM", 2618,    "04-09-91", " 5:00a"]
    ],
    "C:\\GAMES": [
      [".",        "",    DIR,     "08-02-91", " 3:14p"],
      ["..",       "",    DIR,     "08-02-91", " 3:14p"],
      ["MONKEY1",  "EXE", 63488,   "10-15-90", "12:00p"],
      ["MONKEY1",  "000", 8955,    "10-15-90", "12:00p"],
      ["MONKEY1",  "001", 4779713, "10-15-90", "12:00p"]
    ]
  };

  var FILES = {
    "C:\\AUTOEXEC.BAT": [
      "@ECHO OFF",
      "PROMPT $P$G",
      "PATH C:\\DOS",
      "SET BLASTER=A220 I7 D1 T3",
      "ECHO Ready."
    ],
    "C:\\CONFIG.SYS": [
      "DEVICE=C:\\DOS\\HIMEM.SYS",
      "FILES=30",
      "BUFFERS=20",
      "DOS=HIGH,UMB"
    ]
  };

  var FREE_BYTES = 12582912;

  /* --- state ----------------------------------------------------------- */

  var root, screenEl, viewEl, out, field, powerBtn;
  var cwd = "C:\\";
  var lines = [];
  var current = "";
  var history = [], histPos = 0;
  var booting = true, running = false, off = false;
  var bootTimers = [];

  // how long the power fade lasts; must match the CSS animations
  var OFF_MS = 520, ON_MS = 320;

  /* --- little helpers -------------------------------------------------- */

  function padRight(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }

  function padLeft(s, n) {
    s = String(s);
    while (s.length < n) s = " " + s;
    return s;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function echo(s) {
    lines.push(s === undefined ? "" : s);
    if (lines.length > 400) lines = lines.slice(-400);
  }

  function render() {
    if (off) { out.innerHTML = ""; return; }
    var view = lines.slice(), showPrompt = !booting && !running;
    if (showPrompt) view.push(cwd + ">" + current);
    view = view.slice(-ROWS);

    var html = esc(view.join("\n"));
    if (showPrompt) html += '<span class="dos-cursor">_</span>';
    out.innerHTML = html;
  }

  /* --- the commands ---------------------------------------------------- */

  function resolve(arg) {
    var p = String(arg).trim().toUpperCase().replace(/\//g, "\\");
    if (!p) return cwd;
    if (p === "." ) return cwd;
    if (p === "\\" || p === "C:" || p === "C:\\") return "C:\\";
    // the drive is only ever one level deep, so ".." is always the root
    if (p === ".." || p === "..\\") return "C:\\";
    if (p.indexOf("C:") === 0) p = p.slice(2);
    if (p.charAt(0) !== "\\") p = (cwd === "C:\\" ? "\\" : cwd.slice(2) + "\\") + p;
    p = "C:" + p.replace(/\\+$/, "");
    return p === "C:" ? "C:\\" : p;
  }

  function entryLine(e) {
    var left = padRight(e[0], 8) + " " + padRight(e[1], 3);
    var size = e[2] === DIR ? padRight(" <DIR>", 10) : padLeft(e[2], 10);
    return left + size + " " + e[3] + "  " + e[4];
  }

  function doDir(arg) {
    var path = resolve(arg);
    var entries = DRIVE[path];
    if (!entries) { echo("Invalid directory"); return; }

    var bytes = 0, i;
    for (i = 0; i < entries.length; i++)
      if (entries[i][2] !== DIR) bytes += entries[i][2];

    echo(" Volume in drive C has no label");
    echo(" Volume Serial Number is 1A2B-3C4D");
    echo(" Directory of " + path);
    echo("");
    for (i = 0; i < entries.length; i++) echo(entryLine(entries[i]));
    echo(padLeft(entries.length, 9) + " file(s)" + padLeft(bytes, 11) + " bytes");
    echo(padLeft(FREE_BYTES, 28) + " bytes free");
    echo("");
  }

  function doCd(arg) {
    if (!String(arg).trim()) { echo(cwd); return; }
    var path = resolve(arg);
    if (DRIVE[path]) cwd = path;
    else echo("Invalid directory");
  }

  function doType(arg) {
    var name = String(arg).trim().toUpperCase();
    if (!name) { echo("Required parameter missing"); return; }
    if (name.indexOf("\\") === -1 && name.indexOf(":") === -1)
      name = (cwd === "C:\\" ? "C:\\" : cwd + "\\") + name;
    var body = FILES[name];
    if (!body) { echo("File not found - " + name); return; }
    for (var i = 0; i < body.length; i++) echo(body[i]);
  }

  function doMem() {
    echo("");
    echo("    655360 bytes total conventional memory");
    echo("    655360 bytes available to MS-DOS");
    echo("    604832 largest executable program size");
    echo("");
    echo("   7340032 bytes total EMS memory");
    echo("   6291456 bytes free EMS memory");
    echo("");
  }

  function doHelp() {
    echo("");
    echo("For more information on a specific command, type HELP command-name");
    echo("");
    echo("CD       Displays the name of or changes the current directory.");
    echo("CLS      Clears the screen.");
    echo("DIR      Displays a list of files and subdirectories.");
    echo("ECHO     Displays messages.");
    echo("HELP     Provides Help information for MS-DOS commands.");
    echo("MEM      Displays the amount of used and free memory.");
    echo("TYPE     Displays the contents of a text file.");
    echo("VER      Displays the MS-DOS version.");
    echo("");
  }

  function doExec(verb) {
    var name = verb.toUpperCase().replace(/\.EXE$/, "");
    var entries = DRIVE[cwd] || [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i][0] === name && entries[i][1] === "EXE") {
        if (name === "MONKEY1") { launch(); return; }
        break;
      }
    }
    echo("Bad command or file name");
  }

  function run(cmd) {
    var parts = cmd.split(/\s+/);
    var verb = parts[0].toUpperCase();
    var arg = parts.slice(1).join(" ");

    switch (verb) {
      case "DIR":                doDir(arg); break;
      case "CD": case "CHDIR":   doCd(arg); break;
      case "CLS":                lines = []; break;
      case "VER":                echo(""); echo("MS-DOS Version 5.00"); echo(""); break;
      case "HELP":               doHelp(); break;
      case "TYPE":               doType(arg); break;
      case "MEM":                doMem(); break;
      case "ECHO":               echo(arg || "ECHO is on"); break;
      case "DATE":               echo("Current date is Fri 10-15-1990"); break;
      case "TIME":               echo("Current time is 12:00:00.00p"); break;
      case "EXIT":               echo("Not right now. There is a game to play."); break;
      default:                   doExec(verb);
    }
  }

  /* --- launching the game ---------------------------------------------- */

  function launch() {
    echo("");
    echo("The Secret of Monkey Island");
    echo("Copyright (C) 1990 Lucasfilm Games");
    echo("");
    startGame("monkey1");
  }

  function repeat(c, n) { var s = ""; while (n-- > 0) s += c; return s; }

  function progressBar(f) {
    var n = Math.round(f * 30);
    return "[" + repeat("\u2588", n) + repeat("\u2591", 30 - n) + "] " + padLeft(Math.round(f * 100), 3) + "%";
  }

  // Fetch the game's files (feed.js), telling the screen how it goes, then
  // hand the screen to ScummVM. Switching off on the way stops it there
  // (reset() moves launchId on); a failure says why and goes back to the
  // prompt.
  var launchId = 0;
  function startGame(game) {
    var id = ++launchId, bar = -1;
    running = true;
    render();
    ScummVM.prepareGame(game, function (text, fraction) {
      if (id !== launchId) return;
      if (fraction === undefined) {
        echo(text);
        bar = -1;
      } else {
        if (bar < 0) { echo(""); bar = lines.length - 1; }
        lines[bar] = padRight(text, 22) + progressBar(fraction);
      }
      render();
    }).then(function () {
      if (id !== launchId) return;
      echo("Loading...");
      render();
      setTimeout(function () {
        if (id !== launchId) return;
        root.classList.add("is-running");
        document.documentElement.classList.add("has-game");
        ScummVM.load(game);
      }, 600);
    }, function (err) {
      if (id !== launchId) return;
      echo("");
      echo(err.message);
      echo("");
      running = false;
      document.documentElement.classList.remove("has-game");
      render();
    });
  }

  /* --- the power switch ------------------------------------------------ */

  function clearBootTimers() {
    for (var i = 0; i < bootTimers.length; i++) clearTimeout(bootTimers[i]);
    bootTimers = [];
  }

  // back to a cold machine: no scrollback, no history, root directory
  function reset() {
    clearBootTimers();
    launchId++;
    lines = [];
    current = "";
    cwd = "C:\\";
    history = [];
    histPos = 0;
    booting = true;
    running = false;
    if (field) field.value = "";
  }

  function powerOff() {
    if (off) return;
    off = true;
    powerBtn.setAttribute("aria-pressed", "false");
    root.classList.add("is-powering-off");

    setTimeout(function () {
      root.classList.remove("is-powering-off");
      root.classList.remove("is-running");
      root.classList.add("is-off");
      document.documentElement.classList.remove("has-game");
      // whatever was on screen -- game or prompt -- is gone
      if (window.ScummVM && ScummVM.shutdown) ScummVM.shutdown();
      reset();
      render();
    }, OFF_MS);
  }

  function powerOn() {
    if (!off) return;
    off = false;
    powerBtn.setAttribute("aria-pressed", "true");
    root.classList.remove("is-off");
    root.classList.add("is-powering-on");

    // a power cycle is a cold boot, so start from the BIOS again and let
    // the fade peel back over it
    reset();
    render();
    boot();
    try { field.focus(); } catch (err) {}

    setTimeout(function () {
      root.classList.remove("is-powering-on");
    }, ON_MS);
  }

  // ?game=monkey (or monkey1) boots straight into the game, skipping the
  // prompt. Handy for linking to it, and for testing without walking the
  // terminal every time.
  var ALIASES = { monkey: "monkey1", mi: "monkey1", mi1: "monkey1" };

  function requestedGame() {
    var m = /[?&]game=([A-Za-z0-9_-]+)/.exec(window.location.search);
    if (!m) return null;
    var name = m[1].toLowerCase();
    return ALIASES[name] || name;
  }

  /* --- boot ------------------------------------------------------------ */

  var BOOT = [
    [0,    "Phoenix 80386 ROM BIOS PLUS Version 1.10"],
    [60,   "Copyright (C) 1985-1990 Phoenix Technologies Ltd."],
    [120,  ""],
    [180,  "640K Base Memory, 7168K Extended"],
    [420,  "Detecting IDE drives ... C: WDC AC2340H"],
    [700,  ""],
    [760,  "Starting MS-DOS..."],
    [900,  ""],
    [1000, "HIMEM is testing extended memory...done."],
    [1350, ""],
    [1400, "Microsoft(R) MS-DOS(R) Version 5.00"],
    [1460, "             (C)Copyright Microsoft Corp 1981-1991."],
    [1520, ""],
    [1560, "Ready."],
    [1620, ""]
  ];

  function boot() {
    clearBootTimers();
    for (var i = 0; i < BOOT.length; i++) {
      bootTimers.push(setTimeout(function (text) {
        return function () { if (!off) { echo(text); render(); } };
      }(BOOT[i][1]), BOOT[i][0]));
    }
    bootTimers.push(setTimeout(finishBoot, BOOT[BOOT.length - 1][0] + 200));
  }

  function finishBoot() {
    if (!booting || off) return;
    clearBootTimers();
    lines = [];
    for (var i = 0; i < BOOT.length; i++) lines.push(BOOT[i][1]);
    booting = false;
    render();
  }

  /* --- input ----------------------------------------------------------- */

  function submit() {
    var cmd = current.trim();
    echo(cwd + ">" + current);
    current = "";
    field.value = "";
    if (cmd) {
      history.push(cmd);
      if (history.length > 50) history.shift();
      histPos = history.length;
      run(cmd);
    }
    render();
  }

  function onKeyDown(e) {
    if (running || off) return;

    if (booting) { e.preventDefault(); finishBoot(); return; }

    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!history.length) return;
      histPos += (e.key === "ArrowUp" ? -1 : 1);
      if (histPos < 0) histPos = 0;
      if (histPos > history.length) histPos = history.length;
      current = histPos === history.length ? "" : history[histPos];
      field.value = current;
      render();
    } else if (e.key === "Escape") {
      e.preventDefault();
      current = "";
      field.value = "";
      render();
    }
  }

  // `input` rather than keydown for the characters, so phone keyboards work
  function onInput() {
    if (booting || running || off) { field.value = ""; return; }
    var max = COLS - (cwd.length + 1) - 1;
    if (field.value.length > max) field.value = field.value.slice(0, max);
    current = field.value;
    render();
  }

  /* --- fitting 80x25 to the screen ------------------------------------- */

  function fit() {
    var box = (viewEl || screenEl).getBoundingClientRect();
    if (!box.width) return;

    var probe = document.createElement("span"), ruler = [], i;
    for (i = 0; i < COLS; i++) ruler.push("0");
    probe.textContent = ruler.join("");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;" +
      "font-size:100px;line-height:1;font-family:" + getComputedStyle(out).fontFamily;
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);

    if (w > 0) out.style.fontSize = (100 * box.width / w) + "px";
    out.style.lineHeight = (box.height / ROWS) + "px";
  }

  /* --- wiring ---------------------------------------------------------- */

  function init() {
    root = document.getElementById("crt");
    screenEl = document.querySelector(".screen-container");
    viewEl = document.querySelector(".screen-view");
    out = document.getElementById("dos-out");
    field = document.getElementById("dos-input");
    powerBtn = document.getElementById("crt-power");
    if (!root || !out || !field || !powerBtn) return;

    powerBtn.addEventListener("click", function () {
      if (off) powerOn(); else powerOff();
    });

    fit();
    // measure on the next frame: during a resize the box has not reflowed
    // yet, so fitting immediately sizes the grid to the old dimensions
    window.addEventListener("resize", function () {
      if (window.requestAnimationFrame) window.requestAnimationFrame(fit);
      else fit();
    });
    // fit() measures the resolved font, so it has to run again once the
    // webfont arrives -- otherwise the grid is sized to the fallback
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    field.addEventListener("keydown", onKeyDown);
    field.addEventListener("input", onInput);

    // clicking the screen puts the caret back
    screenEl.addEventListener("mousedown", function (e) {
      if (running || off) return;
      e.preventDefault();
      field.focus();
    });
    // A phone only brings its keyboard up for a tap, so while the prompt is
    // up a tap anywhere on the page raises it -- other than on a button or
    // a link, which are for themselves. (touchend rather than touchstart:
    // iOS will not open the keyboard for a focus made on touchstart.)
    document.addEventListener("touchend", function (e) {
      if (running || off) return;
      if (e.target.closest && e.target.closest("button, a, summary, input")) return;
      field.focus();
    }, { passive: true });

    var auto = requestedGame();
    if (auto) {
      booting = false;
      startGame(auto);
      return;
    }

    try { field.focus(); } catch (err) {}

    render();
    boot();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();
}());
