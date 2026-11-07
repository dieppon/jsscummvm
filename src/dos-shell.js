/*
 * dos-shell.js -- a small MS-DOS impersonation that owns the CRT screen
 * until you launch the game.
 *
 * It is all smoke and mirrors: one fake C: drive, a handful of commands and
 * an 80x25 text mode faked with a monospace font. The real thing in it is
 * C:\GAMES, made from the game feed (feed.js): a folder for each ScummVM
 * game in it, named by ScummVM's id for the game, holding the files of its
 * archive (as they are there, bar any .EXE) and an <ID>.EXE.
 *
 * Running that .EXE fetches the game, showing how that goes, and hands the
 * screen to ScummVM -- for the games that run here; the rest say so.
 */
(function () {
  "use strict";

  var COLS = 80, ROWS = 25;

  var DIR = { dir: true };

  /* --- the fake drive ------------------------------------------------- */

  var DRIVE = {
    "C:\\": [
      ["IO",       "SYS", 33430,   "04-09-91", " 5:00a", "", "HSRA"],
      ["MSDOS",    "SYS", 37394,   "04-09-91", " 5:00a", "", "HSRA"],
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
    // a folder for each game in the feed: see addGames()
    "C:\\GAMES": [
      [".",        "",    DIR,     "08-02-91", " 3:14p"],
      ["..",       "",    DIR,     "08-02-91", " 3:14p"]
    ]
  };

  // the game whose folder each path in C:\GAMES is
  var GAME_DIRS = {};

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
  // off until the game feed has been read: see init()
  var booting = false, running = false, off = true, feedReady = false;
  // a command waiting on something (a game's archive, for DIR)
  var waiting = false;
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

  // where echo() writes: the screen, or a command's output being captured
  // for MORE (see run)
  var sink = null;
  function echo(s) {
    if (sink) { sink.push(s === undefined ? "" : s); return; }
    lines.push(s === undefined ? "" : s);
    if (lines.length > 400) lines = lines.slice(-400);
  }

  function render() {
    if (off) { out.innerHTML = ""; return; }
    var view = lines.slice(), showPrompt = !booting && !running && !waiting;
    if (showPrompt) view.push(cwd + ">" + current);
    view = view.slice(-ROWS);

    var html, pos, last, before;
    if (!showPrompt) { out.innerHTML = esc(view.join("\n")); return; }
    // the cursor where the typing goes: after the line, or under the
    // character it is on
    pos = Math.min(field.selectionStart == null ? current.length : field.selectionStart, current.length);
    last = view.pop();
    before = last.length - (current.length - pos);
    html = esc(view.concat([last.slice(0, before)]).join("\n"));
    if (pos < current.length)
      html += '<span class="dos-at">' + esc(last.charAt(before)) + '<span class="dos-cursor">_</span></span>' +
              esc(last.slice(before + 1));
    else
      html += '<span class="dos-cursor">_</span>';
    out.innerHTML = html;
  }

  /* --- the commands ---------------------------------------------------- */

  function resolve(arg) {
    var p = String(arg).trim().toUpperCase().replace(/\//g, "\\");
    if (!p) return cwd;
    if (p === "." ) return cwd;
    if (p === "\\" || p === "C:" || p === "C:\\") return "C:\\";
    if (p.indexOf("C:") === 0) p = p.slice(2);
    if (p.charAt(0) !== "\\") p = (cwd === "C:\\" ? "\\" : cwd.slice(2) + "\\") + p;
    // walk it, so ".." goes up a level and "." stays
    var parts = [];
    p.split("\\").forEach(function (part) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    });
    return parts.length ? "C:\\" + parts.join("\\") : "C:\\";
  }

  /* --- DIR ------------------------------------------------------------- */

  // DIR with the switches it grew up to have (Windows' dir, see
  // learn.microsoft.com/windows-server/administration/windows-commands/dir),
  // in MS-DOS 6.22's look. Each entry is [name, ext, size or DIR, date, time,
  // long name, attributes]: the last two only where they differ from the
  // 8.3 name and from plain "A" (files) or "D" (folders).
  var DIR_HELP = [
    "Displays a list of files and subdirectories in a directory.",
    "",
    "DIR [drive:][path][filename] [/P] [/Q] [/W] [/D] [/A[[:]attributes]]",
    "  [/O[[:]sortorder]] [/T[[:]timefield]] [/S] [/B] [/L] [/N] [/X] [/C] [/4]",
    "",
    "  [drive:][path][filename]",
    "              Specifies drive, directory, and/or files to list.",
    "  /P          Pauses after each screenful of information.",
    "  /Q          Displays the owner of each file.",
    "  /W          Uses wide list format.",
    "  /D          Same as wide but files are list sorted by column.",
    "  /A          Displays files with specified attributes.",
    "  attributes   D  Directories                R  Read-only files",
    "               H  Hidden files               A  Files ready for archiving",
    "               S  System files               -  Prefix meaning not",
    "  /O          List by files in sorted order.",
    "  sortorder    N  By name (alphabetic)       S  By size (smallest first)",
    "               E  By extension (alphabetic)  D  By date/time (oldest first)",
    "               G  Group directories first    -  Prefix to reverse order",
    "  /T          Controls which time field displayed or used for sorting",
    "  timefield    C  Creation  A  Last Access  W  Last Written",
    "  /S          Displays files in specified directory and all subdirectories.",
    "  /B          Uses bare format (no heading information or summary).",
    "  /L          Uses lowercase.",
    "  /N          New long list format where filenames are on the far right.",
    "  /X          Displays the short names generated for non-8dot3 file",
    "              names, before the long name.",
    "  /C          Displays the thousand separator in file sizes.",
    "  /4          Displays four-digit years.",
    ""
  ];

  function isDir(e) { return e[2] === DIR; }
  function shortOf(e) { return e[1] ? e[0] + "." + e[1] : e[0]; }
  function longOf(e) { return e[5] || shortOf(e); }
  function attrsOf(e) { return e[6] || (isDir(e) ? "D" : "A"); }

  function fullYear(date) { var y = +date.slice(6); return (y < 80 ? 2000 : 1900) + y; }
  function sortableTime(e) {
    var d = e[3], t = e[4], h = +t.slice(0, 2) % 12 + (t.slice(-1) === "p" ? 12 : 0);
    return fullYear(d) * 1e8 + +d.slice(0, 2) * 1e6 + +d.slice(3, 5) * 1e4 + h * 100 + +t.slice(3, 5);
  }

  function withCommas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // A DOS wildcard as a test of a name: * any run, ? any one (or none)
  function wildcard(pattern) {
    var re = pattern.toUpperCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".?");
    // "*.*" and "NAME.*" also take names with no extension
    re = re.replace(/\\\.\.\*$/, "(\\..*)?");
    return new RegExp("^" + re + "$");
  }

  // Split DIR's arguments into its switches and the paths it names
  function dirArgs(arg) {
    // 6.2 and later print sizes with commas unless told /-C
    var o = {paths: [], attrs: null, order: null, commas: true}, rest;
    rest = String(arg).replace(/\/(-?)([a-z0-9?])((?::?-?[a-z]+)*)/gi, function (m, not, sw, val) {
      sw = sw.toUpperCase();
      val = val.replace(/:/g, "").toUpperCase();
      if (sw === "A") o.attrs = val;
      else if (sw === "O") o.order = val || "GN";
      else if (sw === "C") o.commas = !not;
      else if (sw !== "T" && sw !== "R") o[sw] = !not;
      return " ";
    });
    rest.split(/[\s,;]+/).forEach(function (p) { if (p) o.paths.push(p); });
    return o;
  }

  // What a path names: a folder and the pattern of names in it
  function dirTarget(p) {
    var path, cut, last;
    if (!p) return {dir: cwd, pattern: "*.*"};
    path = resolve(p);
    if (DRIVE[path]) return {dir: path, pattern: "*.*"};
    cut = path.lastIndexOf("\\");
    last = path.slice(cut + 1);
    return {dir: cut <= 2 ? "C:\\" : path.slice(0, cut), pattern: last};
  }

  // The folders a listing takes in: the one named, and with /S all below it
  function dirsUnder(dir, all) {
    var out = [dir], key;
    if (all) for (key in DRIVE) if (key !== dir && key.indexOf(dir === "C:\\" ? dir : dir + "\\") === 0) out.push(key);
    return out.sort();
  }

  // the entries of a folder DIR shows: filtered, sorted
  function dirEntries(dir, pattern, o) {
    // a name with no extension given stands for any: DIR MONKEY is MONKEY.*
    if (pattern.indexOf(".") < 0) pattern += ".*";
    var test = wildcard(pattern), entries = (DRIVE[dir] || []).filter(function (e) {
      if (!test.test(shortOf(e)) && !test.test(longOf(e).toUpperCase())) return false;
      var a = attrsOf(e), want = o.attrs, i, not = false, c;
      // hidden and system files only show when asked for
      if (want === null) return a.indexOf("H") < 0 && a.indexOf("S") < 0;
      for (i = 0; i < want.length; i++) {
        c = want.charAt(i);
        if (c === "-") { not = true; continue; }
        if ((a.indexOf(c) >= 0) === not) return false;
        not = false;
      }
      return true;
    });
    if (o.order) entries.sort(function (x, y) {
      var spec = o.order, i, c, rev = false, r;
      for (i = 0; i < spec.length; i++) {
        c = spec.charAt(i);
        if (c === "-") { rev = true; continue; }
        if (c === "N") r = shortOf(x).localeCompare(shortOf(y));
        else if (c === "E") r = x[1].localeCompare(y[1]);
        else if (c === "S") r = (isDir(x) ? 0 : x[2]) - (isDir(y) ? 0 : y[2]);
        else if (c === "D") r = sortableTime(x) - sortableTime(y);
        else if (c === "G") r = (isDir(y) ? 1 : 0) - (isDir(x) ? 1 : 0);
        else r = 0;
        if (r) return rev ? -r : r;
        rev = false;
      }
      return 0;
    });
    return entries;
  }

  // One folder's listing, as lines, with its file and byte counts
  function dirListing(dir, entries, o, out) {
    var files = 0, bytes = 0, low = o.L ? function (s) { return s.toLowerCase(); } : function (s) { return s; },
        size = function (n) { return o.commas ? withCommas(n) : String(n); },
        date = function (e) { return o["4"] ? e[3].slice(0, 6) + fullYear(e[3]) : e[3]; },
        col, rows, per, r, c, i, line, name;
    entries.forEach(function (e) { if (!isDir(e)) { files++; bytes += e[2]; } });

    if (o.B) {
      entries.forEach(function (e) {
        if (e[0] === "." || e[0] === "..") return;
        out.push(low((o.S ? (dir === "C:\\" ? dir : dir + "\\") : "") + longOf(e)));
      });
      return {files: files, bytes: bytes};
    }

    out.push(" Directory of " + dir);
    out.push("");
    if (o.W || o.D) {
      // five to a line, folders in brackets; /D runs down the columns
      per = 5;
      rows = Math.ceil(entries.length / per);
      for (r = 0; r < (o.D ? rows : Math.ceil(entries.length / per)); r++) {
        line = "";
        for (c = 0; c < per; c++) {
          i = o.D ? c * rows + r : r * per + c;
          if (i >= entries.length) break;
          name = isDir(entries[i]) ? "[" + shortOf(entries[i]) + "]" : shortOf(entries[i]);
          line += padRight(low(name), 16);
        }
        out.push(line.replace(/\s+$/, ""));
      }
    } else if (o.N || o.X || o.Q) {
      // date, time, size, then the names on the right
      entries.forEach(function (e) {
        var s = e[1] ? e[0] + "." + e[1] : e[0], longName = longOf(e);
        line = date(e) + "  " + e[4] + "  " + (isDir(e) ? padRight("<DIR>", 14) : padLeft(size(e[2]), 14)) + " ";
        if (o.Q) line += padRight(isDir(e) ? "BUILTIN\\Admin" : "BUILTIN\\Users", 15) + " ";
        if (o.X) line += padRight(longName.toUpperCase() === s ? "" : s, 13);
        out.push(line + low(longName));
      });
    } else {
      entries.forEach(function (e) {
        out.push(low(padRight(e[0], 8) + " " + padRight(e[1], 3)) +
                 (isDir(e) ? padRight(" <DIR>", 10) : padLeft(size(e[2]), 10)) + " " + date(e) + "  " + e[4]);
      });
    }
    if (DRIVE[dir] && DRIVE[dir].unreadable) out.push(DRIVE[dir].unreadable);
    out.push(padLeft(entries.length, 9) + " file(s)" + padLeft(size(bytes), 11) + " bytes");
    return {files: entries.length, bytes: bytes};
  }

  // DIR: resolves to its lines, and whether to pause each screen (/P), once
  // any game folders it takes in have been read from their archives
  function doDir(arg) {
    var o = dirArgs(arg), targets, dirs = [], waits = [];
    if (o["?"]) return Promise.resolve({lines: DIR_HELP.slice()});
    targets = (o.paths.length ? o.paths : [""]).map(dirTarget);
    targets.forEach(function (t) {
      dirsUnder(t.dir, o.S).forEach(function (d) {
        dirs.push({dir: d, pattern: t.pattern});
        if (GAME_DIRS[d] && !DRIVE[d].read) waits.push(readGameDir(d));
      });
    });
    // /S takes in the game folders below too, once they are read
    return Promise.all(waits).then(function () {
      var out = [], files = 0, bytes = 0, dirCount = 0, shown = 0;
      if (!DRIVE[targets[0].dir]) return {lines: ["Invalid directory"]};
      if (!o.B) {
        out.push(" Volume in drive C has no label");
        out.push(" Volume Serial Number is 1A2B-3C4D");
      }
      dirs.forEach(function (d) {
        var entries = dirEntries(d.dir, d.pattern, o), r;
        // with /S, a folder with nothing matching in it is left out
        if (o.S && !entries.length) return;
        if (!o.B && shown) out.push("");
        r = dirListing(d.dir, entries, o, out);
        files += r.files; bytes += r.bytes; dirCount++; shown++;
      });
      if (!shown && !o.B) { out.push(""); out.push("File not found"); }
      if (!o.B && shown) {
        if (o.S && dirCount > 1) {
          out.push("");
          out.push("     Total files listed:");
          out.push(padLeft(files, 9) + " file(s)" + padLeft(o.commas ? withCommas(bytes) : bytes, 11) + " bytes");
        }
        out.push(padLeft(o.commas ? withCommas(FREE_BYTES) : FREE_BYTES, 28) + " bytes free");
        out.push("");
      }
      return {lines: out, pause: !!o.P};
    });
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
    echo("DIR      Displays a list of files and subdirectories. (DIR /? for more)");
    echo("ECHO     Displays messages.");
    echo("HELP     Provides Help information for MS-DOS commands.");
    echo("MEM      Displays the amount of used and free memory.");
    echo("MORE     Displays output one screen at a time.");
    echo("TYPE     Displays the contents of a text file.");
    echo("VER      Displays the MS-DOS version.");
    echo("");
  }

  function doExec(verb) {
    var name = verb.toUpperCase().replace(/\.EXE$/, ""), game = GAME_DIRS[cwd];
    // a game's .EXE, in its folder
    if (game && name === exeName(game)) { launch(game); return; }
    echo("Bad command or file name");
  }

  /* --- the games, from the feed ---------------------------------------- */

  // a game's folder and .EXE are its ScummVM id, cut to DOS's 8 letters
  function exeName(game) { return game.id.toUpperCase().slice(0, 8); }

  // MS-DOS dates and times as DIR shows them: 10-15-90, 12:00p
  function dosDate(d) {
    var y = ((d >> 9) & 0x7F) + 1980, m = (d >> 5) & 0x0F, day = d & 0x1F;
    return padLeft(m, 2).replace(" ", "0") + "-" + padLeft(day, 2).replace(" ", "0") + "-" +
           String(y % 100 + 100).slice(1);
  }
  function dosTime(t) {
    var h = (t >> 11) & 0x1F, min = (t >> 5) & 0x3F, p = h >= 12 ? "p" : "a";
    h = h % 12 || 12;
    return padLeft(h, 2) + ":" + String(min + 100).slice(1) + p;
  }

  // A file name in 8.3, as DOS would show a long one: TRACK17 FLA, and
  // MT32_C~1 ROM for MT32_CONTROL.ROM or ATLANT~1 SCU for atlantis.scummvm
  // (~2 and on if that is taken)
  function shortName(name, taken) {
    var dot = name.lastIndexOf("."), stem = (dot > 0 ? name.slice(0, dot) : name).toUpperCase(),
        ext = (dot > 0 ? name.slice(dot + 1) : "").toUpperCase(), n = 1, short, long = ext.length > 3;
    stem = stem.replace(/[^A-Z0-9_$~!#%&\-{}@^'`()]/g, "_");
    ext = ext.slice(0, 3);
    if (stem.length <= 8 && !long && !taken[stem + "." + ext]) short = stem;
    else do { short = stem.slice(0, 8 - 1 - String(n).length) + "~" + n; n++; } while (taken[short + "." + ext]);
    taken[short + "." + ext] = true;
    return [short, ext];
  }

  // A folder in C:\GAMES for each game in the feed, with its .EXE in it;
  // the rest of what is in it comes from its archive, read in the
  // background from here (readGameDir)
  function addGames(games) {
    games.forEach(function (game) {
      var name = exeName(game), path = "C:\\GAMES\\" + name;
      if (GAME_DIRS[path]) return;
      GAME_DIRS[path] = game;
      DRIVE["C:\\GAMES"].push([name, "", DIR, "11-06-26", "12:00p"]);
      DRIVE[path] = [
        [".",  "", DIR, "11-06-26", "12:00p"],
        ["..", "", DIR, "11-06-26", "12:00p"],
        [name, "EXE", 63488, "10-15-90", "12:00p"]
      ];
      readGameDir(path);
    });
  }

  // Fill in a game's folder from its archive, once: everything in it but
  // its own .EXEs (the folder's .EXE stands for the game); if it cannot be
  // read, the folder holds the .EXE alone and says why when listed
  var dirReads = {};
  function readGameDir(path) {
    if (!dirReads[path]) {
      dirReads[path] = ScummVM.gameFiles(GAME_DIRS[path]).then(function (files) {
        var taken = {}, entries = DRIVE[path];
        taken[entries[2][0] + ".EXE"] = true;
        files.forEach(function (f) {
          if (/\.exe$/i.test(f.name)) return;
          var n = shortName(f.name, taken);
          entries.push([n[0], n[1], f.size, dosDate(f.dosDate), dosTime(f.dosTime), f.name]);
        });
        entries.read = true;
      }, function (err) {
        DRIVE[path].read = true;
        DRIVE[path].unreadable = "The disk could not be read (" + err.message + ")";
      });
    }
    return dirReads[path];
  }

  // the output of a command that echoes, as lines
  function captured(fn) {
    var out = [];
    sink = out;
    try { fn(); } finally { sink = null; }
    return out;
  }

  var MORE_HELP = [
    "Displays output one screen at a time.",
    "",
    "MORE < [drive:][path]filename",
    "command-name | MORE",
    "",
    "  [drive:][path]filename  Specifies a file to display one screen at a time.",
    "  command-name            Specifies a command whose output will be displayed.",
    ""
  ];

  function run(cmd) {
    var pipe = cmd.split("|"), first = pipe[0].trim(), more = false, m, parts, verb, arg, r;
    // COMMAND | MORE: the only filter there is
    if (pipe.length > 1) {
      if (pipe.length > 2 || !/^more$/i.test(pipe[1].trim())) { echo("Bad command or file name"); return; }
      more = true;
    }
    // MORE < FILE, and MORE on its own
    if ((m = /^more\s*(<\s*(.*)|\/\?)?$/i.exec(first))) {
      if (m[0].indexOf("?") >= 0) { MORE_HELP.forEach(function (l) { echo(l); }); return; }
      if (m[2] !== undefined) show(captured(function () { doType(m[2]); }), "more");
      return;
    }

    parts = first.split(/\s+/);
    verb = parts[0].toUpperCase();
    arg = parts.slice(1).join(" ");
    if (verb === "DIR") {
      // a game's folder may still be being read from its archive: wait
      waiting = true;
      render();
      doDir(arg).then(function (out) {
        waiting = false;
        show(out.lines, more ? "more" : out.pause ? "pause" : "plain");
      });
      return;
    }
    if (more) { show(captured(function () { runCommand(verb, arg); }), "more"); return; }
    runCommand(verb, arg);
  }

  function runCommand(verb, arg) {
    switch (verb) {
      case "CD": case "CHDIR":   doCd(arg); break;
      case "CLS":                lines = []; break;
      case "VER":                echo(""); echo("MS-DOS Version 6.22"); echo(""); break;
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

  /* --- one screen at a time -------------------------------------------- */

  // Show lines: all at once, or a screen at a time -- DIR /P's way, "Press
  // any key to continue . . ." then "(continuing C:\...)", or MORE's,
  // "-- More --" -- waiting on a key (or a tap) between screens. Ctrl+C or
  // Esc stops it there.
  var pager = null;
  function show(out, mode) {
    if (mode === "plain" || out.length < ROWS - 1) {
      out.forEach(function (l) { echo(l); });
      render();
      return;
    }
    pager = {lines: out, pos: 0, mode: mode, dir: cwd, first: true};
    nextPage();
  }

  function nextPage() {
    var p = pager, n = ROWS - 1, end, m;
    // the first screen still shows the command that was typed
    if (p.first) { n--; p.first = false; }
    else if (p.mode === "pause") {
      m = /^ Directory of (.*)$/.exec(p.lines.slice(0, p.pos).reverse().filter(function (l) { return /^ Directory of /.test(l); })[0] || "");
      echo("(continuing " + (m ? m[1] : p.dir) + ")");
      n--;
    }
    end = Math.min(p.lines.length, p.pos + n);
    for (; p.pos < end; p.pos++) echo(p.lines[p.pos]);
    if (p.pos < p.lines.length) {
      echo(p.mode === "more" ? "-- More --" : "Press any key to continue . . .");
      waiting = true;
    } else {
      pager = null;
      waiting = false;
    }
    render();
  }

  // a key while paging: on to the next screen, or stop
  function pageKey(stop) {
    if (!pager) return false;
    // MORE's prompt goes when it is answered; DIR /P's stays
    if (pager.mode === "more") lines.pop();
    if (stop) {
      echo("^C");
      pager = null;
      waiting = false;
      render();
    } else nextPage();
    return true;
  }

  /* --- launching the game ---------------------------------------------- */

  function launch(game) {
    echo("");
    echo(game.title);
    if (!game.supported) { echo("This game does not run here yet."); echo(""); return; }
    if (game.id === "monkey") echo("Copyright (C) 1990 Lucasfilm Games");
    echo("");
    startGame(game.id);
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
  // the game that is running, named under the heading and in the tab
  function nameGame(gameId) {
    var dir, title = null, el = document.getElementById("sub-game");
    for (dir in GAME_DIRS) if (GAME_DIRS[dir].id === gameId) title = GAME_DIRS[dir].title;
    if (!title) return;
    if (el) el.textContent = title;
    document.title = "JS ScummVM \u2014 " + title;
  }

  function startGame(game) {
    var id = ++launchId, bar = -1;
    running = true;
    nameGame(game);
    ScummVM.setCurrentGame(game);
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
      ScummVM.setCurrentGame(null);
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
    ScummVM.setCurrentGame(null);
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
      document.title = "JS ScummVM";
      // whatever was on screen -- game or prompt -- is gone
      if (window.ScummVM && ScummVM.shutdown) ScummVM.shutdown();
      reset();
      render();
    }, OFF_MS);
  }

  // Switch on: a cold boot from the BIOS, or with a game to start (?game=)
  // straight into fetching it
  function powerOn(game) {
    if (!off) return;
    off = false;
    powerBtn.setAttribute("aria-pressed", "true");
    root.classList.remove("is-off");
    root.classList.add("is-powering-on");

    // a power cycle is a cold boot, so start from the BIOS again and let
    // the fade peel back over it
    reset();
    if (game) {
      booting = false;
      startGame(game);
    } else {
      render();
      boot();
      try { field.focus(); } catch (err) {}
    }

    setTimeout(function () {
      root.classList.remove("is-powering-on");
    }, ON_MS);
  }

  // ?game=monkey boots straight into the game, skipping the prompt. Handy
  // for linking to it, and for testing without walking the terminal every
  // time.
  var ALIASES = { mi: "monkey", mi1: "monkey" };

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
    [1400, "Microsoft(R) MS-DOS(R) Version 6.22"],
    [1460, "             (C)Copyright Microsoft Corp 1981-1994."],
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
    if (pager) {
      e.preventDefault();
      if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
      pageKey(e.key === "Escape" || (e.ctrlKey && /^c$/i.test(e.key)));
      return;
    }
    if (waiting) { e.preventDefault(); return; }

    if (booting) { e.preventDefault(); finishBoot(); return; }

    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // as COMMAND.COM: Tab is typed, to the next tab stop (every eight
      // columns) -- not a move to the next thing on the page
      e.preventDefault();
      typeTab();
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

  function typeTab() {
    var start = field.selectionStart == null ? current.length : field.selectionStart,
        end = field.selectionEnd == null ? start : field.selectionEnd,
        col = cwd.length + 1 + start, n = 8 - col % 8,
        max = COLS - (cwd.length + 1) - 1, value;
    value = current.slice(0, start) + "        ".slice(0, n) + current.slice(end);
    if (value.length > max) return;
    current = field.value = value;
    field.selectionStart = field.selectionEnd = start + n;
    render();
  }

  // the arrows, Home and End move the cursor along the line
  function caretMoved() {
    if (!booting && !running && !off && !waiting && !pager) render();
  }

  // `input` rather than keydown for the characters, so phone keyboards work
  function onInput() {
    // a phone's keyboard types rather than pressing keys: any of it pages on
    if (pager && field.value) { field.value = ""; pageKey(false); return; }
    if (booting || running || off || waiting) { field.value = ""; return; }
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
      // with no feed yet there is nothing to switch on for: ask for one
      if (off && !feedReady) { if (ScummVM.askForFeed) ScummVM.askForFeed(); return; }
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
    field.addEventListener("keyup", caretMoved);
    field.addEventListener("select", caretMoved);

    // clicking the screen puts the caret back -- in info mode, where its
    // text can be selected, only once a click has not selected anything
    screenEl.addEventListener("mousedown", function (e) {
      if (running || off || document.documentElement.classList.contains("has-info")) return;
      e.preventDefault();
      field.focus();
    });
    screenEl.addEventListener("mouseup", function () {
      if (running || off || !document.documentElement.classList.contains("has-info")) return;
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed) field.focus();
    });
    // A phone only brings its keyboard up for a tap, so while the prompt is
    // up a tap anywhere on the page raises it -- other than on a button or
    // a link, which are for themselves. (touchend rather than touchstart:
    // iOS will not open the keyboard for a focus made on touchstart.)
    document.addEventListener("touchend", function (e) {
      if (running || off) return;
      if (e.target.closest && e.target.closest("button, a, summary, input")) return;
      // a tap on the screen pages on, as a key would
      if (pager && e.target.closest && e.target.closest(".screen-container")) { pageKey(false); return; }
      field.focus();
    }, { passive: true });

    // The machine stays off until the game feed has been read (feed.js
    // asks for one if there is none, or it cannot be read), then switches
    // on: into the game if the address names one, else to the prompt.
    render();
    ScummVM.feedLoaded.then(function (games) {
      feedReady = true;
      addGames(games);
      powerOn(requestedGame());
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();
}());
