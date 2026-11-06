/*
 * zip.js -- reading single files out of a zip archive on a web server,
 * without downloading the rest of it.
 *
 * A zip keeps its table of contents (the central directory) at the end, and
 * every file it holds can be found from there by offset. So: one ranged
 * request for the tail of the archive, then one per file wanted -- a game's
 * two data files out of an archive of 140MB of CD audio come to a few MB.
 * Servers that ignore Range get the whole archive downloaded once and read
 * from memory instead.
 *
 * Files are either stored or deflated; deflate is undone by the browser's
 * DecompressionStream ("deflate-raw"). Encrypted entries and zip64 archives
 * (over 4GB, or over 65535 files) are not supported.
 *
 * What has been read is kept in IndexedDB, keyed by archive, name and CRC,
 * so a second visit does not download it again.
 */
(function () {
  "use strict";

  var EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
  // the end record is 22 bytes, plus a comment of up to 65535
  var TAIL = 22 + 65535;

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  // Read a response body, telling onProgress(bytes so far) as it arrives
  function readBody(res, onProgress) {
    if (!onProgress || !res.body || !res.body.getReader) {
      return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    var reader = res.body.getReader(), chunks = [], got = 0;
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var all = new Uint8Array(got), pos = 0;
          chunks.forEach(function (c) { all.set(c, pos); pos += c.length; });
          return all;
        }
        chunks.push(r.value);
        got += r.value.length;
        onProgress(got);
        return pump();
      });
    }());
  }

  function inflate(bytes) {
    if (!window.DecompressionStream) {
      return Promise.reject(new Error("This browser cannot unzip (no DecompressionStream)"));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /* --- the cache -------------------------------------------------------- */

  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve) {
        var req;
        try { req = window.indexedDB.open("jsscummvm-files", 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = req.onblocked = function () { resolve(null); };
      });
    }
    return dbPromise;
  }

  function cacheGet(key) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var req = d.transaction("files").objectStore("files").get(key);
          req.onsuccess = function () { resolve(req.result ? new Uint8Array(req.result) : null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function cachePut(key, bytes) {
    return db().then(function (d) {
      if (!d) return;
      try { d.transaction("files", "readwrite").objectStore("files").put(bytes.buffer, key); }
      catch (e) { /* full, or not allowed: read it again next time */ }
    });
  }

  /* --- the archive ------------------------------------------------------ */

  function Archive(url) {
    this.url = url;
    this.size = 0;
    this.whole = null;     // the archive itself, if the server sent all of it
    this.entries = [];
  }

  // Bytes [start, end) of the archive. A negative start counts from the end.
  Archive.prototype.range = function (start, end, onProgress) {
    var t = this, header;
    if (t.whole) {
      if (start < 0) start = Math.max(0, t.whole.length + start);
      return Promise.resolve(t.whole.subarray(start, end === undefined ? t.whole.length : end));
    }
    header = start < 0 ? "bytes=" + start : "bytes=" + start + "-" + (end - 1);
    return fetch(t.url, {headers: {Range: header}}).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var cr = res.headers.get("Content-Range"), m = cr && /\/(\d+)\s*$/.exec(cr);
      if (res.status == 206 && m) {
        t.size = +m[1];
        return readBody(res, onProgress);
      }
      // no ranges here: this is the whole archive, so keep it
      return readBody(res, onProgress).then(function (all) {
        t.whole = all;
        t.size = all.length;
        return t.range(start, end);
      });
    });
  };

  Archive.prototype.readDirectory = function () {
    var t = this;
    return t.range(-TAIL).then(function (tail) {
      var i, cdSize, cdOffset, count;
      for (i = tail.length - 22; i >= 0; i--) if (u32(tail, i) == EOCD_SIG) break;
      if (i < 0) throw new Error("not a zip archive");
      count = u16(tail, i + 10);
      cdSize = u32(tail, i + 12);
      cdOffset = u32(tail, i + 16);
      if (count == 0xFFFF || cdOffset == 0xFFFFFFFF) throw new Error("zip64 archives are not supported");
      // the directory usually falls within the tail already read
      var tailStart = t.size - tail.length;
      if (cdOffset >= tailStart) return tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize);
      return t.range(cdOffset, cdOffset + cdSize);
    }).then(function (cd) {
      var p = 0, nameLen, extraLen, commentLen, flags, name, utf8;
      while (p + 46 <= cd.length && u32(cd, p) == CEN_SIG) {
        flags = u16(cd, p + 8);
        nameLen = u16(cd, p + 28);
        extraLen = u16(cd, p + 30);
        commentLen = u16(cd, p + 32);
        utf8 = (flags & 0x800) != 0;
        name = new TextDecoder(utf8 ? "utf-8" : "latin1").decode(cd.subarray(p + 46, p + 46 + nameLen));
        t.entries.push({
          name: name,
          encrypted: (flags & 1) != 0,
          method: u16(cd, p + 10),
          crc: u32(cd, p + 16),
          compressedSize: u32(cd, p + 20),
          size: u32(cd, p + 24),
          offset: u32(cd, p + 42),
          extraLen: extraLen
        });
        p += 46 + nameLen + extraLen + commentLen;
      }
      return t;
    });
  };

  // An entry's contents, uncompressed. onProgress(fraction) as it downloads.
  Archive.prototype.read = function (entry, onProgress) {
    var t = this, key = t.url + "|" + entry.name + "|" + entry.crc;
    if (entry.encrypted) return Promise.reject(new Error(entry.name + " is encrypted"));
    if (entry.method != 0 && entry.method != 8) {
      return Promise.reject(new Error(entry.name + ": unsupported compression " + entry.method));
    }
    return cacheGet(key).then(function (cached) {
      if (cached && cached.length == entry.size) {
        if (onProgress) onProgress(1);
        return cached;
      }
      // the local header is 30 bytes and the name, then an extra field that
      // need not match the directory's; ask for some slack, and more if short
      var guess = 30 + entry.name.length + entry.extraLen + 64,
          want = entry.compressedSize;
      return t.range(entry.offset, entry.offset + guess + want, onProgress && function (got) {
        onProgress(Math.min(1, got / (guess + want)));
      }).then(function (buf) {
        if (u32(buf, 0) != LOC_SIG) throw new Error(entry.name + ": bad local header");
        var start = 30 + u16(buf, 26) + u16(buf, 28);
        if (start + want <= buf.length) return buf.subarray(start, start + want);
        return t.range(entry.offset + start, entry.offset + start + want);
      }).then(function (data) {
        return entry.method == 0 ? data.slice() : inflate(data);
      }).then(function (bytes) {
        if (bytes.length != entry.size) throw new Error(entry.name + ": unzipped to the wrong size");
        cachePut(key, bytes);
        return bytes;
      });
    });
  };

  ScummVM.Zip = {
    // Open an archive by URL: resolves to it, its entries read
    open: function (url) {
      return new Archive(url).readDirectory();
    }
  };
}());
