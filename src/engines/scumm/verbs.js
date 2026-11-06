/*
 * Verbs, ported from ScummVM's engines/scumm/verbs.cpp: the verb slots,
 * finding and drawing them, and turning clicks and keys into input for
 * the game's scripts.
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  /* --- verbs, ported from ScummVM's verbs.cpp / o5_verbOps ---------------- */


  s.VerbSlot = function() {
    var t = this;
    t.curRect = {left: 0, top: 0, right: 0, bottom: 0};
    t.verbid = 0;
    t.color = 2; t.hicolor = 0; t.dimcolor = 8; t.bkcolor = 0;
    t.type = kTextVerbType;
    t.charset_nr = 1; t.curmode = 0;   // scumm.cpp resetScumm
    t.saveid = 0; t.key = 0; t.center = false;
    t.imgindex = 0; t.origLeft = 0;
    t.text = "";
  };

  s.initVerbs = function() {
    var t = this, i;
    t._verbs = [];
    for (i = 0; i < t._nums['verbs']; i++) t._verbs[i] = new t.VerbSlot();
  };

  s.getVerbSlot = function(verbid, mode) {
    var t = this, i;
    for (i = 1; i < t._nums['verbs']; i++) {
      if (t._verbs[i].verbid == verbid && t._verbs[i].saveid == mode) return i;
    }
    return 0;
  };

  s.killVerb = function(slot) {
    var t = this, vs;
    if (slot == 0) return;
    vs = t._verbs[slot];
    vs.verbid = 0;
    vs.curmode = 0;
    vs.text = "";
    t._res.nukeResource("verb", slot);
    vs.saveid = 0;
  };

  // verbs.cpp findVerbAtPos: walk the slots backwards, first hit wins
  s.findVerbAtPos = function(x, y) {
    var t = this, i, vs;
    for (i = t._nums['verbs'] - 1; i > 0; i--) {
      vs = t._verbs[i];
      if (vs.curmode != 1 || !vs.verbid || vs.saveid) continue;
      if (y < vs.curRect.top || y >= vs.curRect.bottom) continue;
      if (vs.center) {
        if (x < -(vs.curRect.right - 2 * vs.curRect.left) || x >= vs.curRect.right) continue;
      } else {
        if (x < vs.curRect.left || x >= vs.curRect.right) continue;
      }
      return i;
    }
    return 0;
  };

  // script.cpp runInputScript: hand the click to the game's verb script
  s.runInputScript = function(clickArea, val, mode) {
    var t = this, args = [], i, verbScript = t.scummVar("verb_script");
    for (i = 0; i < 16; i++) args[i] = 0;
    args[0] = clickArea;
    args[1] = val;
    args[2] = mode;
    if (verbScript) t.runScript(verbScript, 0, 0, args);
  };

  // script.cpp runInventoryScript: the game redraws its inventory panel here
  s.runInventoryScript = function(i) {
    var t = this, args = [], j, invScript = t.scummVar("inventory_script");
    if (!invScript) return;
    for (j = 0; j < 16; j++) args[j] = 0;
    args[0] = i;
    t.runScript(invScript, 0, 0, args);
  };

  // verbs.cpp checkExecVerbs, the mouse half -- keyboard verbs are not wired up
  s.checkExecVerbs = function() {
    var t = this, over, zone;

    if (t._userPut <= 0 || t._mouseAndKeyboardStat == 0) return;

    // verbs.cpp: a key press is a verb's shortcut, or goes to the input
    // script as a key click
    if (t._mouseAndKeyboardStat < MBS_MAX_KEY) {
      for (var i = 1; i < t._nums['verbs']; i++) {
        var v = t._verbs[i];
        if (v && v.verbid && v.saveid == 0 && v.curmode == 1 && t._mouseAndKeyboardStat == v.key) {
          t.runInputScript(kVerbClickArea, v.verbid, 1);
          return;
        }
      }
      t.runInputScript(kKeyClickArea, t._mouseAndKeyboardStat, 1);
      return;
    }

    if (t._mouseAndKeyboardStat & MBS_MOUSE_MASK) {
      var code = (t._mouseAndKeyboardStat & MBS_LEFT_CLICK) ? 1 : 2;
      zone = t.findVirtScreen(t._mouse.y);
      if (zone == null) return;

      over = t.findVerbAtPos(t._mouse.x, t._mouse.y);
      if (over != 0) {
        t.runInputScript(kVerbClickArea, t._verbs[over].verbid, code);
      } else {
        t.runInputScript(zone == 0 ? kSceneClickArea : kVerbClickArea, 0, code);
      }
    }
  };

  // which virtual screen a y coordinate falls in; 0 is the main picture
  s.findVirtScreen = function(y) {
    var t = this, i, vs;
    for (i = 0; i < t._virtscreens.length; i++) {
      vs = t._virtscreens[i];
      if (!vs) continue;
      if (y >= vs.topline && y < vs.topline + vs.h) return i;
    }
    return null;
  };


  /* Draw the verb panel and the sentence line, from ScummVM's redrawVerbs and
     drawVerb (verbs.cpp). ScummVM draws verbs into the virtual screen and uses
     restoreVerbBG to clear the previous text; our canvas is repainted from
     scratch every frame, so this just redraws them all each time.

     The sentence line above the panel ("Walk to door") is not special-cased --
     it is a centred verb like any other, which is why it appears as soon as
     verbs are drawn at all. */
  s.drawVerbs = function() {
    var t = this, ctx = ScummVM.context,
        width = ScummVM.width, height = ScummVM.height,
        charset, img, data, i, j, vs, color, codes, lw, x, over = 0, any = false;

    if(!t._verbs || !t._verbs.length) return;

    for(i = 1; i < t._verbs.length; i++) {
      vs = t._verbs[i];
      if(vs && vs.verbid && !vs.saveid && vs.curmode &&
         vs.type == kTextVerbType && vs.text) { any = true; break; }
    }
    if(!any) return;

    charset = t._charset || (t._charset = new t.CharsetRenderer(t));
    if(!charset.setCurID(t._curCharset) && !charset.setCurID(1)) return;
    var defaultCharset = charset.curId;

    // ScummVM only highlights the verb under the pointer while the cursor is on
    if(t._cursorState > 0)
      over = t.findVerbAtPos(t._mouse.x, t._mouse.y);

    img = ctx.getImageData(0, 0, width, height);
    data = img.data;

    for(i = 1; i < t._verbs.length; i++) {
      vs = t._verbs[i];
      if(!vs || !vs.verbid || vs.saveid || !vs.curmode) continue;
      if(vs.type != kTextVerbType || !vs.text) continue;

      if(vs.curmode == 2) color = vs.dimcolor;
      else if(i == over && vs.hicolor) color = vs.hicolor;
      else color = vs.color;

      // The name is expanded every time it is drawn, as ScummVM's drawVerb
      // does: the sentence line is one verb whose name is "\xFF\x05<var>
      // \xFF\x06<var>..." -- the verb and object names held in variables.
      // each verb in its own charset (verbs.cpp drawVerb)
      if(!charset.setCurID(vs.charset_nr || defaultCharset)) charset.setCurID(defaultCharset);
      codes = t.verbDisplayCodes(vs);
      // ScummVM records the rect as it draws, so a verb whose text changes
      // (the sentence line) is clickable where it now is
      t.setVerbRect(vs);
      if(!codes.length) continue;

      lw = charset.getStringWidth(codes);
      // A centred verb is positioned by its middle, the same convention
      // setVerbRect and findVerbAtPos use.
      x = vs.center ? vs.curRect.left - Math.floor(lw / 2) : vs.curRect.left;
      if(x + lw > width) x = width - lw;
      if(x < 0) x = 0;

      // Multi-bit glyphs look their pixels up in the colour map, so the
      // colour has to be published there too (ScummVM's setColor).
      t._charsetColorMap[1] = color;
      charset.drawLine(data, width, height, codes, x, vs.curRect.top, color);
    }

    ctx.putImageData(img, 0, 0);
    t._verbMouseOver = over;
  };

  // The verb's name is stored as a resource by loadPtrToResource; pull it back
  // out as the raw bytes the charset renderer wants.
  s.getVerbText = function(slot) {
    return this.getResourceMessage("verb", slot) || "";
  };

  // verbs.cpp setVerbObject: an image verb shows an object's picture, copied
  // out of `room` -- Monkey Island keeps its inventory icons in room 99
  s.setVerbObject = function(room, object, verb) {
    var t = this, MKID_BE = ScummVM.system.MKID_BE, roomptr, searchptr, abs, size;

    if (t.whereIsObject(object) == WIO_FLOBJECT) {
      error("Can't grab verb image from flobject");
      return;
    }
    roomptr = t.getResourceAddress("room", room);
    if (!roomptr) return;
    searchptr = roomptr.newAbsoluteStream(8);
    while (searchptr.findNext(MKID_BE('OBIM'))) {
      abs = searchptr.offset - 8;
      size = roomptr.newAbsoluteStream(abs + 4).readUI32(true);
      if (t.getObjectIdFromOBIM(searchptr) == object) {
        t._res.types["verb"].address[verb] = roomptr.newStream(abs, size);
        t._imageVerbsDirty = true;
        return;
      }
      searchptr.seek(abs + size, true);
    }
    error("setVerbObject: object " + object + " image not found in room " + room);
  };

  // verbs.cpp drawVerbBitmap: draw the object image into the verb screen and
  // size the verb's rect to it
  s.drawVerbBitmap = function(slot, x, y) {
    var t = this, v = t._verbs[slot], vsn = t.findVirtScreen(y), vs, obim, imhd, imgw, imgh,
        imptr, i, MKID_BE = ScummVM.system.MKID_BE;

    if (vsn == null) return;
    vs = t._virtscreens[vsn];
    obim = t.getResourceAddress("verb", slot);
    if (!obim) return;
    obim = obim.newRelativeStream(0).seek(0, true);
    imhd = new t.ImageHeader(t.findResourceData(MKID_BE('IMHD'), obim));
    imgw = Math.floor(imhd.width / 8);
    imgh = Math.floor(imhd.height / 8);
    imptr = t.getObjectImage(obim, 1);
    if (!imptr) return;

    t._gdi.zBufferDisabled = true;
    for (i = 0; i < imgw; i++)
      t._gdi.drawBitmap(imptr, vs, Math.floor(x / 8) + i, y - vs.topline, imgw * 8, imgh * 8, i, 1,
                        t._gdi.dbAllowMaskOr | t._gdi.dbObjectMode);
    t._gdi.zBufferDisabled = false;

    v.curRect.right = v.curRect.left + imgw * 8;
    v.curRect.bottom = v.curRect.top + imgh * 8;
  };

  // Image verbs are drawn into the verb screen rather than painted over each
  // frame like text, so redraw them -- on a cleared screen, which is what
  // ScummVM's restoreVerbBG amounts to -- whenever one changes.
  s.drawImageVerbs = function() {
    var t = this, vs = t._virtscreens[2], sig = "", i, v, buf;
    if (!vs || !t._verbs) return;
    for (i = 1; i < t._nums['verbs']; i++) {
      v = t._verbs[i];
      if (v && v.verbid && !v.saveid && v.curmode && v.type == kImageVerbType)
        sig += i + ":" + v.verbid + ":" + v.imgindex + "@" + v.curRect.left + "," + v.curRect.top + ";";
    }
    if (sig == t._imageVerbSig && !t._imageVerbsDirty) return;
    t._imageVerbSig = sig;
    t._imageVerbsDirty = false;

    buf = vs.pixels.buffer;
    for (i = 0; i < buf.length; i++) buf[i] = "\0";
    for (i = 1; i < t._nums['verbs']; i++) {
      v = t._verbs[i];
      if (v && v.verbid && !v.saveid && v.curmode && v.type == kImageVerbType)
        t.drawVerbBitmap(i, v.curRect.left, v.curRect.top);
    }
  };

  // A text verb's name, expanded, as the glyph codes to draw. Escape codes
  // that only steer text output are dropped.
  s.verbDisplayCodes = function(vs) {
    var t = this, msg = t.convertMessageToString(vs.text), codes = [], i, c;
    for (i = 0; i < msg.length; i++) {
      c = msg.charCodeAt(i) & 0xFF;
      if (c == 0xFF || c == 0xFE) {
        c = msg.charCodeAt(++i);
        if (c == 9 || c == 10 || c == 12 || c == 13 || c == 14) i += 2;
        continue;
      }
      codes.push(c);
    }
    return codes;
  };

  // verbs.cpp sizes a text verb's box from the string it draws
  s.setVerbRect = function(vs) {
    var t = this, cs, w = 0, h = 8, codes;
    if (!vs || vs.type != kTextVerbType) return;
    cs = t._charset || (t._charset = new t.CharsetRenderer(t));
    if (cs.setCurID(vs.charset_nr) || cs.setCurID(t._curCharset) || cs.setCurID(1)) {
      codes = t.verbDisplayCodes(vs);
      w = cs.getStringWidth(codes);
      h = cs.fontHeight;
    }
    // ScummVM draws a centred verb starting at left - width/2 and records
    // where it ended, so curRect.right comes out at left + width/2. That is
    // the convention findVerbAtPos decodes with its
    // "x < -(right - 2*left)" test, so the rect has to be built the same way
    // or every hit lands on the neighbouring column.
    vs.curRect.right = vs.curRect.left + (vs.center ? Math.floor(w / 2) : w);
    vs.curRect.bottom = vs.curRect.top + h;
  };

}());
