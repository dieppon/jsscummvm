/*
 * feed.js -- where a game's files come from: a webЯcade feed.
 *
 * A feed is a JSON list of categories of items, each with a title and, for
 * ScummVM games (type "scumm"), a zip archive of the game's files in its
 * props. Items carry no id that says which game they are, so each ScummVM
 * item is told by name: its title, its long title without the "(1990)
 * (LucasArts)" tags, and its archive's file name, all normalised, against
 * ScummVM's names for its games (scummvm-games.js) and a few more they go
 * by. Each comes out as the id ScummVM knows it by (ScummVM.feedGames),
 * which the DOS shell makes a folder of. Only SUPPORTED ones run.
 *
 * Out of the archive come the game's data files (whatever they are called
 * there, any folder) and, when the game asks for them, its CD tracks
 * (trackN or TrackN, in whichever format the browser plays). See zip.js.
 *
 * The feed is ?feed=<url>. Without one, or if it cannot be read, a box asks
 * for it on loading (index.html's #feed-dialog), filled in with the last
 * one used, and the page loads again with it in the address. The computer
 * stays off until it has been read (ScummVM.feedLoaded, dos-shell.js).
 */
(function () {
  "use strict";

  var LAST_FEED_KEY = "jsscummvm.feed";

  // The games that run here: their SCUMM version, which picks the engine's
  // opcodes, and the base name of the data files to pick when an archive
  // has more than one pair
  var SUPPORTED = {
    monkey: {title: "The Secret of Monkey Island", version: 5, files: /^(monkey1?|secret)$/},
    monkey2: {title: "Monkey Island 2: LeChuck's Revenge", version: 5, files: /^monkey2$/}
  };

  // Names games go by besides ScummVM's, normalised as norm() leaves them
  var MORE_NAMES = {
    monkey: ["monkey island", "monkey island 1", "monkey1", "mi1"],
    monkey2: ["monkey island 2", "lechucks revenge", "mi2"],
    comi: ["monkey island 3", "curse of monkey island"],
    tentacle: ["day of the tentacle", "dott"],
    samnmax: ["sam and max", "sam max", "sam and max hit the road"],
    atlantis: ["fate of atlantis", "indiana jones fate of atlantis", "indy4"],
    indy3: ["indiana jones and the last crusade", "last crusade", "indy3"],
    zak: ["zak mckracken"],
    ft: ["full throttle"]
  };

  // Packs of several games, taken only on their exact names
  var COMPILATIONS = ["pass", "indyzak", "indyloom", "zakloom"];

  // Tags that say nothing about which game it is: platform, media, version
  var NOISE = ["cd", "dos", "pc", "vga", "ega", "floppy", "talkie", "english",
               "eng", "en", "us", "usa", "eu", "europe", "version", "lucasarts",
               "lucasfilm", "games", "game", "scummvm"];

  // lower case, no accents or punctuation, no tags in brackets, no leading
  // "the", and none of the noise words
  function norm(s) {
    s = String(s || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/&/g, " and ")
         .replace(/[^a-z0-9]+/g, " ").trim();
    return s.split(" ").filter(function (w) {
      return w && NOISE.indexOf(w) < 0 && !/^v\d/.test(w) && !/^(19|20)\d\d$/.test(w);
    }).join(" ").replace(/^the /, "");
  }

  // An archive URL's file name, without the folders, query or extension
  function fileName(url) {
    var path = String(url || "").split(/[?#]/)[0], name = path.slice(path.lastIndexOf("/") + 1);
    try { name = decodeURIComponent(name); } catch (e) { /* leave it */ }
    return name.replace(/\.(zip|7z|rar|tar|gz)$/i, "");
  }

  function archiveOf(item) {
    var p = item.props || {};
    return p.archive || p.zip || p.rom || p.url || null;
  }

  // ScummVM's games with the names each goes by, normalised, made once
  var known = null;
  function knownGames() {
    if (!known) known = (ScummVM.SCUMM_GAMES || []).map(function (g) {
      return {id: g[0], title: g[1], names: [norm(g[1])].concat(MORE_NAMES[g[0]] || [])};
    });
    return known;
  }

  // the numbers in a name: "monkey island 2" is not "monkey island"
  function numbers(s) { return s.split(" ").filter(function (w) { return /^\d+$/.test(w); }).join(" "); }

  // Which of ScummVM's games an item is, or null. Its title or long title
  // being one of a game's names beats its file name being one, which beats
  // a name merely holding (or held in) another -- then the nearest in
  // length, with the same numbers in it, and never a compilation.
  function identify(item) {
    var names = [norm(item.title), norm(item.longTitle), norm(fileName(archiveOf(item)))],
        best = null, bestScore = 0, games = knownGames(), i, j, k, g, n, sc;
    for (i = 0; i < games.length; i++) {
      g = games[i];
      for (j = 0; j < g.names.length; j++) {
        n = g.names[j];
        if (!n) continue;
        sc = 0;
        if (n == names[0] || n == names[1]) sc = 300;
        else if (n == names[2]) sc = 200;
        else if (COMPILATIONS.indexOf(g.id) < 0) {
          for (k = 0; k < names.length; k++) {
            if (!names[k] || numbers(names[k]) != numbers(n)) continue;
            if (names[k].indexOf(n) >= 0 || n.indexOf(names[k]) >= 0)
              sc = Math.max(sc, 100 - Math.abs(names[k].length - n.length));
          }
        }
        if (sc > bestScore) { best = g; bestScore = sc; }
      }
    }
    return best;
  }

  // Every ScummVM game in the feed, by id: {id, title, item, url}. The first
  // item taken for a game is the one used.
  function gamesIn(feed) {
    var games = [], seen = {};
    (feed.categories || []).forEach(function (cat) {
      (cat.items || []).forEach(function (item) {
        var g;
        if (item.type != "scumm" || !archiveOf(item)) return;
        g = identify(item);
        if (!g || seen[g.id]) return;
        seen[g.id] = true;
        games.push({id: g.id, title: item.title || g.title, longTitle: item.longTitle || item.title || g.title,
                    item: item, url: directUrl(archiveOf(item)), supported: !!SUPPORTED[g.id]});
      });
    });
    return games;
  }

  function findGame(feed, id) {
    var games = gamesIn(feed), i;
    for (i = 0; i < games.length; i++) if (games[i].id == id) return games[i];
    return null;
  }

  // A game's archive, opened once (its directory read)
  var archives = {};
  function openArchive(game) {
    if (!archives[game.id]) {
      archives[game.id] = ScummVM.Zip.open(game.url);
      archives[game.id].catch(function () { delete archives[game.id]; });
    }
    return archives[game.id];
  }

  // The files a game's archive holds, for the DOS shell to list: {name,
  // size, dosDate, dosTime} for each, folders and macOS's leftovers
  // left out. Rejects if the archive cannot be read.
  ScummVM.gameFiles = function (game) {
    return openArchive(game).then(function (archive) {
      return archive.entries.filter(function (e) {
        return !junk(e.name) && !/\/$/.test(e.name);
      }).map(function (e) {
        return {name: base(e.name), size: e.size, dosDate: e.dosDate, dosTime: e.dosTime};
      });
    });
  };

  // A share link as a URL the browser can download from: Dropbox's pages
  // become its download host, which allows ranges and other sites
  function directUrl(url) {
    var u = new URL(url, window.location.href);
    if (/(^|\.)dropbox\.com$/.test(u.hostname)) {
      u.hostname = "dl.dropboxusercontent.com";
      u.searchParams.delete("dl");
      u.searchParams.delete("raw");
    }
    return u.href;
  }

  function feedUrl() {
    return new URL(window.location.href).searchParams.get("feed");
  }

  // The feed in the address, fetched once and remembered as the last used
  var feedRead = null;
  function readFeed() {
    if (!feedRead) {
      feedRead = fetch(feedUrl()).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (feed) {
        if (!feed || !feed.categories) throw new Error("not a feed");
        try { window.localStorage.setItem(LAST_FEED_KEY, feedUrl()); } catch (e) { /* not kept */ }
        return feed;
      });
      // a failure is not kept: the next try fetches again
      feedRead.catch(function () { feedRead = null; });
    }
    return feedRead;
  }

  // entries that are not the game's: macOS's resource forks and the like
  function junk(name) {
    return /(^|\/)(__MACOSX|\.)/.test(name);
  }

  function base(name) { return name.slice(name.lastIndexOf("/") + 1); }
  function dir(name) { return name.slice(0, name.lastIndexOf("/") + 1); }

  // The game's .000 and .001, from one folder: the pair whose name is the
  // game's if there is one, otherwise the first pair found
  function findDataFiles(archive, game) {
    var pairs = {}, key, best = null;
    archive.entries.forEach(function (e) {
      var m = /^(.*)\.00([01])$/i.exec(base(e.name));
      if (junk(e.name) || !m) return;
      key = dir(e.name) + m[1].toLowerCase();
      (pairs[key] = pairs[key] || {name: m[1].toLowerCase()})[m[2]] = e;
    });
    for (key in pairs) {
      if (!pairs[key][0] || !pairs[key][1]) continue;
      if (!best || (game.files.test(pairs[key].name) && !game.files.test(best.name))) best = pairs[key];
    }
    return best;
  }

  function binaryString(bytes) {
    var s = "", i, step = 0x8000;
    for (i = 0; i < bytes.length; i += step)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return s;
  }

  // The source of a game's files once it is ready: its data files, as the
  // binary strings the engine reads, and its CD tracks on demand
  function Source(gameId, item, archive, pair) {
    this.game = gameId;
    this.item = item;
    this.archive = archive;
    this.pair = pair;
    this.files = {};
    this.tracks = {};
  }

  // A CD track as a URL to play: the first of the formats given (in order
  // of preference) that the archive has, unzipped once, then remembered.
  // Resolves to null if there is none.
  Source.prototype.trackUrl = function (track, formats) {
    var t = this, found = null, i, j, m, e;
    if (track in t.tracks) return t.tracks[track];
    for (i = 0; i < formats.length && !found; i++) {
      for (j = 0; j < t.archive.entries.length; j++) {
        e = t.archive.entries[j];
        m = /^track0*(\d+)\.(\w+)$/i.exec(base(e.name));
        if (!junk(e.name) && m && +m[1] == track && m[2].toLowerCase() == formats[i].ext) {
          found = {entry: e, type: formats[i].type};
          break;
        }
      }
    }
    t.tracks[track] = !found ? Promise.resolve(null) : t.archive.read(found.entry).then(function (bytes) {
      return URL.createObjectURL(new Blob([bytes], found.type ? {type: found.type} : {}));
    }, function (err) {
      debug(1, "CD track " + track + ": " + err.message);
      return null;
    });
    return t.tracks[track];
  };

  // Find a game in the feed, open its archive and read its data files.
  // report(text, fraction) tells how it is going; fraction is for a bar,
  // undefined while there is none to draw. Resolves when the engine can
  // start, ScummVM.source set; rejects with an Error whose message says,
  // for the screen, what went wrong (with no feed given, after asking).
  ScummVM.prepareGame = function (gameId, report) {
    var support = SUPPORTED[gameId], url = feedUrl(), game, host;
    ScummVM.source = null;
    if (!url) {
      askForFeed();
      return Promise.reject(new Error("No game feed has been given."));
    }
    try { host = new URL(url, window.location.href).hostname || url; } catch (e) { host = url; }

    report("Reading the webRcade feed at " + host + "...");
    return readFeed().catch(function () {
      throw new Error("Cannot read the game feed at " + host + ".");
    }).then(function (feed) {
      game = findGame(feed, gameId);
      if (!game) throw new Error("There is no " + gameId.toUpperCase() + " in the feed.");
      if (!support) throw new Error(game.title + " does not run here yet.");
      report("Found " + game.longTitle + ".");
      report("Opening " + fileName(archiveOf(game.item)) + "...");
      return openArchive(game).catch(function (err) {
        debug(1, "archive: " + err.message);
        throw new Error("Cannot open the game's archive (" + err.message + ").");
      });
    }).then(function (archive) {
      var pair = findDataFiles(archive, support), source;
      if (!pair) throw new Error("The archive has no " + gameId.toUpperCase() + ".000 and .001.");
      source = new Source(gameId, game.item, archive, pair);
      source.version = support.version;
      // the index file is small; the bar is for the data file
      return archive.read(pair[0]).then(function (index) {
        source.files[0] = binaryString(index);
        var label = "Reading " + base(pair[1].name).toUpperCase();
        report(label, 0);
        return archive.read(pair[1], function (f) { report(label, f); });
      }).then(function (data) {
        source.files[1] = binaryString(data);
        ScummVM.source = source;
        return source;
      }, function (err) {
        throw new Error("Cannot read the game's files (" + err.message + ").");
      });
    });
  };

  /* --- asking for the feed ---------------------------------------------- */

  // The box that asks for the feed's address. It checks that a feed can be
  // read there, then loads the page again with it as ?feed=, so the address
  // is one that can be bookmarked or shared.
  var dialog = document.getElementById("feed-dialog");

  // message: why it is asking again, if it is
  function askForFeed(message) {
    var input = document.getElementById("feed-url"), err = document.getElementById("feed-error"), last = null;
    if (!dialog || dialog.open || !dialog.showModal) return;
    try { last = window.localStorage.getItem(LAST_FEED_KEY); } catch (e) { /* none */ }
    if (last && !input.value) input.value = last;
    err.textContent = message || "";
    err.hidden = !message;
    dialog.showModal();
    input.focus();
    input.select();
  }

  if (dialog) {
    // to info mode, where the page says how feeds work; the box comes back
    // on the next load, or on starting the game
    document.getElementById("feed-help-button").addEventListener("click", function () {
      var info = document.getElementById("info-switch");
      dialog.close();
      if (info && !document.documentElement.classList.contains("has-info")) info.click();
      var help = document.querySelector(".feed-help");
      if (help && help.scrollIntoView) help.scrollIntoView({block: "start", behavior: "smooth"});
    });
    dialog.querySelector("form").addEventListener("submit", function (e) {
      var input = document.getElementById("feed-url"), err = document.getElementById("feed-error"),
          button = dialog.querySelector("button[type=submit]"), url;
      e.preventDefault();
      err.hidden = true;
      try { url = new URL(input.value.trim()); } catch (x) { url = null; }
      if (!url || !/^https?:$/.test(url.protocol)) {
        err.textContent = "That is not a web address.";
        err.hidden = false;
        return;
      }
      button.disabled = true;
      fetch(url.href).then(function (res) {
        if (!res.ok) throw new Error();
        return res.json();
      }).then(function (feed) {
        if (!feed || !feed.categories) throw new Error();
        var here = new URL(window.location.href);
        here.searchParams.set("feed", url.href);
        window.location.href = here.href;
      }).catch(function () {
        err.textContent = "No webRcade feed could be read at that address.";
        err.hidden = false;
        button.disabled = false;
      });
    });
  }

  ScummVM.askForFeed = function () { askForFeed(); };

  // The feed in the address, read once: the box asks for it until then.
  // Resolves to the ScummVM games in it (see gamesIn).
  ScummVM.feedLoaded = new Promise(function (resolve) {
    function start() {
      var url = feedUrl();
      if (!url) { askForFeed(); return; }
      readFeed().then(function (feed) { resolve(gamesIn(feed)); }, function () {
        askForFeed("No webRcade feed could be read at that address.");
        document.getElementById("feed-url").value = url;
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  });
}());
