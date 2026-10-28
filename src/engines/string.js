/*
 * Text output, ported from ScummVM's engines/scumm/string.cpp: the string
 * slots the print opcodes fill in, actor speech (actorTalk / displayDialog)
 * and drawString.
 *
 * ScummVM draws text into the virtual screens and erases it again with
 * restoreCharsetBg. Our screen is repainted from the room every frame, so
 * the text that would be on it is kept as a list of glyph runs in
 * _textLayer instead, painted on top by renderTexts. restoreCharsetBg empties
 * the part of it over the room.
 */
(function(){
  var s = ScummVM.engines.SCUMM;

  var SLOT_FIELDS = ["x", "y", "right", "height", "color", "charset",
                     "center", "overhead", "no_talk_anim", "wrapping"];

  // scumm.h StringTab: a slot's settings, plus the defaults each print starts
  // from. A print without a text only changes the defaults -- Monkey Island
  // sets colours and positions that way and prints the text later, so
  // resetting a slot to zeroes each time turned all of that text black.
  s.StringTab = function() {
    var t = this, i;
    t._default = {};
    for(i = 0; i < SLOT_FIELDS.length; i++)
      t[SLOT_FIELDS[i]] = t._default[SLOT_FIELDS[i]] = 0;
  };
  s.StringTab.prototype = {
    saveDefault: function() {
      for(var i = 0; i < SLOT_FIELDS.length; i++)
        this._default[SLOT_FIELDS[i]] = this[SLOT_FIELDS[i]];
    },
    loadDefault: function() {
      for(var i = 0; i < SLOT_FIELDS.length; i++)
        this[SLOT_FIELDS[i]] = this._default[SLOT_FIELDS[i]];
    }
  };

  // scumm.cpp resetScumm
  s.initStrings = function() {
    var t = this, i, d;
    t._string = [];
    for(i = 0; i < 6; i++) {
      t._string[i] = new s.StringTab();
      d = t._string[i]._default;
      d.x = 2;
      d.y = 5;
      d.right = t._screenWidth - 1;
      d.height = 0;
      d.color = 0xF;
      d.center = false;
      d.charset = 0;
    }
    t._textLayer = [];
    t._charsetHasMask = false;
    t._charsetBuffer = [];
    t._charsetBufPos = 0;
    t._charsetColor = 0;
    t._nextLeft = 0;
    t._nextTop = 0;
  };

  // script_v5.cpp decodeParseString
  s.decodeParseString = function() {
    var t = this, textSlot, str, len;

    switch(t._actorToPrintStrFor) {
      case 252: textSlot = 3; break;
      case 253: textSlot = 2; break;
      case 254: textSlot = 1; break;
      default:  textSlot = 0;
    }

    str = t._string[textSlot];
    str.loadDefault();

    while((t._opcode = t.fetchScriptByte()) != 0xFF) {
      switch(t._opcode & 0x0F) {
        case 0: // at
          str.x = t.getVarOrDirectWord(PARAM_1);
          str.y = t.getVarOrDirectWord(PARAM_2);
          str.overhead = false;
        break;
        case 1: // color
          str.color = t.getVarOrDirectByte(PARAM_1);
        break;
        case 2: // clipped
          str.right = t.getVarOrDirectWord(PARAM_1);
        break;
        case 3: // erase -- ScummVM errors out on this one too
          t.getVarOrDirectWord(PARAM_1);
          t.getVarOrDirectWord(PARAM_2);
          error("decodeParseString: unhandled erase");
        break;
        case 4: // center
          str.center = true;
          str.overhead = false;
        break;
        case 6: // left
          str.center = false;
          str.overhead = false;
        break;
        case 7: // overhead
          str.overhead = true;
        break;
        case 15: // textstring
          len = t.resStrLen();
          t.printString(textSlot, t.readMessage(t._scriptPointer, len));
          t._scriptPointer.seek(len + 1);
        return;
        default:
          error("decodeParseString: unhandled case " + (t._opcode & 0x0F));
        return;
      }
    }

    str.saveDefault();
  };

  s.printString = function(slot, msg) {
    var t = this;
    switch(slot) {
      case 0: t.actorTalk(msg); break;
      case 1: t.drawString(1, msg); break;
      case 2: log("debug message: " + t.convertMessageToString(msg)); break;
      case 3: log("message dialog: " + t.convertMessageToString(msg)); break;
    }
  };

  s.getTalkingActor = function() {
    return this.scummVar("talk_actor");
  };

  s.setTalkingActor = function(i) {
    this.scummVar("talk_actor", i);
  };

  // actor.cpp actorTalk
  s.actorTalk = function(msg) {
    var t = this, a, oldact, conv = t.convertMessageToString(msg), i;

    t._charsetBuffer = [];
    for(i = 0; i < conv.length; i++) t._charsetBuffer.push(conv.charCodeAt(i) & 0xFF);
    t._charsetBuffer.push(0);

    if(t._actorToPrintStrFor == 0xFF) {
      if(!t._keepText) t.stopTalk();
      t.setTalkingActor(0xFF);
    } else {
      a = t.getActor(t._actorToPrintStrFor);
      if(!a || !a.isInCurrentRoom()) {
        oldact = 0xFF;
      } else {
        if(!t._keepText) t.stopTalk();
        t.setTalkingActor(a.number);
        if(!t._string[0].no_talk_anim) {
          a.runActorTalkScript(a.talkStartFrame);
          t._useTalkAnims = true;
        }
        oldact = t.getTalkingActor();
      }
      if(oldact >= 0x80) return;
    }

    if(t.getTalkingActor() > 0x7F) {
      t._charsetColor = t._string[0].color;
    } else {
      a = t.getActor(t.getTalkingActor());
      t._charsetColor = a ? a.talkColor : t._string[0].color;
    }
    t._charsetBufPos = 0;
    t._talkDelay = 0;
    t._haveMsg = 0xFF;
    t.scummVar("have_msg", 0xFF);
    t._haveActorSpeechMsg = true;
    t.displayDialog();
  };

  // actor.cpp stopTalk
  s.stopTalk = function() {
    var t = this, act, a;
    t._haveMsg = 0;
    t._talkDelay = 0;
    act = t.getTalkingActor();
    if(act && act < 0x80) {
      a = t.getActor(act);
      if(a && a.isInCurrentRoom() && t._useTalkAnims) {
        a.runActorTalkScript(a.talkStopFrame);
        t._useTalkAnims = false;
      }
      t.setTalkingActor(0xFF);
    }
    t._keepText = false;
    t.restoreCharsetBg();
  };

  // gfx.cpp restoreCharsetBg: wipe the text over the room. Text in the verb
  // area stays; ScummVM only tracks (and erases) the main screen's.
  s.restoreCharsetBg = function() {
    var t = this, i, keep = [];
    t._nextLeft = t._string[0].x;
    t._nextTop = t._string[0].y;
    if(t._charsetHasMask) {
      t._charsetHasMask = false;
      for(i = 0; i < t._textLayer.length; i++)
        if(!t._textLayer[i].main) keep.push(t._textLayer[i]);
      t._textLayer = keep;
    }
  };

  // All text, wherever it is: a room change starts from a clean screen
  s.clearTextSurface = function() {
    this._textLayer = [];
    this._charsetHasMask = false;
  };

  s.getCharsetRenderer = function(id) {
    var t = this, cs = t._charset || (t._charset = new t.CharsetRenderer(t));
    if(!cs.setCurID(id) && !cs.setCurID(t._curCharset) && !cs.setCurID(1)) return null;
    return cs;
  };

  // Width of the text from `pos` up to the next line break, as
  // CharsetRenderer::getStringWidth measures it
  s.textWidth = function(cs, buf, pos) {
    var t = this, w = 1, chr;
    while((chr = buf[pos++]) && chr !== 0) {
      if(chr == 13) break;
      if(chr == 0x40) continue;
      if(chr == 0xFF || chr == 0xFE) {
        chr = buf[pos++];
        if(chr == 3) break;
        if(chr == 8) { while(buf[pos++] == 32) {} continue; }
        if(chr == 10 || chr == 21 || chr == 12 || chr == 13) { pos += 2; continue; }
        if(chr == 9 || chr == 1 || chr == 2) break;
        if(chr == 14) { pos += 2; continue; }
      }
      w += cs.getCharWidth(chr);
    }
    return w;
  };

  // charset.cpp addLinebreaks: turn the last space before the line gets too
  // wide into a 13, which displayDialog treats as a newline
  s.addLinebreaks = function(cs, buf, pos, maxWidth) {
    var lastspace = -1, curw = 1, chr;
    while((chr = buf[pos++]) && chr !== 0) {
      if(chr == 0x40) continue;
      if(chr == 0xFF || chr == 0xFE) {
        chr = buf[pos++];
        if(chr == 3) break;
        if(chr == 8) { while(buf[pos] == 32) buf[pos++] = 0x40; continue; }
        if(chr == 10 || chr == 21 || chr == 12 || chr == 13) { pos += 2; continue; }
        if(chr == 1) { curw = 1; continue; }
        if(chr == 2) break;
        if(chr == 14) { pos += 2; continue; }
      }
      if(chr == 32) lastspace = pos - 1;
      curw += cs.getCharWidth(chr);
      if(lastspace == -1) continue;
      if(curw > maxWidth) {
        buf[lastspace] = 13;
        curw = 1;
        pos = lastspace + 1;
        lastspace = -1;
      }
    }
  };

  // string.cpp handleNextCharsetCode. Returns the next character to print,
  // having acted on any escape codes before it; `stop` is set when a code
  // ends this stretch of the message (2 keep text, 3 wait).
  s.handleNextCharsetCode = function(a, st) {
    var t = this, buf = t._charsetBuffer, pos = t._charsetBufPos, c = 0, endLoop = false, v;
    st.stop = false;
    while(!endLoop) {
      c = buf[pos++] || 0;
      if(c != 0xFF && c != 0xFE) break;
      c = buf[pos++] || 0;
      switch(c) {
        case 1: c = 13; endLoop = true; break;
        case 2: t._haveMsg = 0; t._keepText = true; endLoop = true; break;
        case 3: t._haveMsg = 0xFF; t._keepText = false; endLoop = true; break;
        case 8: break;
        case 9:
          v = buf[pos] | (buf[pos + 1] << 8); pos += 2;
          if(a) a.startAnimActor(v);
        break;
        case 10: pos += 14; break;
        case 12:
          v = buf[pos] | (buf[pos + 1] << 8); pos += 2;
          st.color = v == 0xFF ? t._charsetColor : v;
        break;
        case 13: pos += 2; break;
        case 14: st.charset = buf[pos]; pos += 2; break;
        default:
          error("handleNextCharsetCode: invalid code " + c);
      }
    }
    t._charsetBufPos = pos;
    if(c == 2 || c == 3) st.stop = true;
    return c;
  };

  // Put one glyph on the text layer, extending the current run if it carries
  // straight on from it
  s.layText = function(cs, c, x, y, color) {
    var t = this, runs = t._textLayer, last = runs[runs.length - 1], vs = t._virtscreens[0],
        main = !vs || (y >= vs.topline && y < vs.topline + vs.h);
    if(last && last.y == y && last.end == x && last.color == color && last.cs == cs.curId) {
      last.codes.push(c);
    } else {
      last = {x: x, y: y, codes: [c], color: color, cs: cs.curId, main: main, end: x};
      runs.push(last);
    }
    last.end = x + cs.getCharWidth(c);
    if(main) t._charsetHasMask = true;
    return last.end;
  };

  // string.cpp newLine
  s.newLine = function(cs) {
    var t = this;
    t._nextLeft = t._string[0].x;
    if(t._charsetCenter) {
      t._nextLeft -= Math.floor(t.textWidth(cs, t._charsetBuffer, t._charsetBufPos) / 2);
      if(t._nextLeft < 0) t._nextLeft = 0;
    }
    t._nextTop += t._string[0].height ? t._string[0].height : cs.fontHeight;
  };

  // string.cpp displayDialog (CHARSET_1): called every frame while there is
  // a message; prints the next stretch of it each time the talk delay
  // runs out, and stops the talking once it has all been shown.
  s.displayDialog = function() {
    var t = this, a = null, str = t._string[0], camera = t._camera, vs = t._virtscreens[0],
        talkY, sc, cs, maxWidth, c, st, color;

    if(!t._haveMsg) return;

    if((camera.dest.x >> 3) != (camera.cur.x >> 3) || camera.cur.x != camera.last.x)
      return;

    if(t.getTalkingActor() != 0xFF)
      a = t.getActor(t.getTalkingActor());

    if(a && str.overhead) {
      str.x = a.pos.x - (vs ? vs.xstart : 0);
      str.y = a.pos.y - a.elevation;
      talkY = t.scummVar("talk_string_y");
      if(talkY >= 0x8000) talkY -= 0x10000;
      if(talkY < 0) {
        sc = Math.trunc(a.scaley * talkY / 0xFF);
        str.y += Math.trunc((talkY - sc) / 2) + sc;
      } else {
        str.y = talkY;
      }
      if(str.y < 1) str.y = 1;
      if(str.x < 80) str.x = 80;
      if(str.x > t._screenWidth - 80) str.x = t._screenWidth - 80;
    }

    t._charsetCenter = str.center;
    cs = t.getCharsetRenderer(a && a.charset ? a.charset : str.charset);
    if(!cs) return;

    if(t._talkDelay) return;

    if(t._haveMsg == 1) {
      t.stopTalk();
      return;
    }

    if(a && !str.no_talk_anim) {
      a.runActorTalkScript(a.talkStartFrame);
      t._useTalkAnims = true;
    }

    t._talkDelay = 60;

    if(!t._keepText) {
      t.restoreCharsetBg();
      t._msgCount = 0;
    }

    maxWidth = str.right - str.x - 1;
    if(str.center) {
      if(maxWidth > t._nextLeft) maxWidth = t._nextLeft;
      maxWidth *= 2;
    }
    t.addLinebreaks(cs, t._charsetBuffer, t._charsetBufPos, maxWidth);

    if(str.center) {
      t._nextLeft -= Math.floor(t.textWidth(cs, t._charsetBuffer, t._charsetBufPos) / 2);
      if(t._nextLeft < 0) t._nextLeft = 0;
    }

    st = {color: t._charsetColor};
    for(;;) {
      c = t.handleNextCharsetCode(a, st);
      if(st.charset) { cs = t.getCharsetRenderer(st.charset) || cs; st.charset = 0; }
      if(st.stop) break;
      if(c == 0) {
        t._haveMsg = 1;
        t._keepText = false;
        t._msgCount = 0;
        break;
      }
      if(c == 13) {
        t.newLine(cs);
        continue;
      }
      t._nextLeft = t.layText(cs, c, t._nextLeft, t._nextTop, st.color);
      t._talkDelay += t.scummVar("charinc");
    }
  };

  // string.cpp drawString: text the print opcodes put straight on screen
  s.drawString = function(slot, msg) {
    var t = this, str = t._string[slot], buf = t.convertMessageToString(msg),
        codes = [], cs, i, c, left, top, startLeft, color;

    for(i = 0; i < buf.length; i++) codes.push(buf.charCodeAt(i) & 0xFF);
    codes.push(0);

    cs = t.getCharsetRenderer(str.charset);
    if(!cs) return;

    top = str.y;
    startLeft = left = str.x;
    color = str.color;

    if(str.center)
      left -= Math.floor(t.textWidth(cs, codes, 0) / 2);
    // ScummVM draws a single space for an empty string, which erases nothing
    if(codes[0] === 0) return;

    for(i = 0; (c = codes[i++]) !== 0;) {
      if(c == 0xFF || c == 0xFE) {
        c = codes[i++];
        switch(c) {
          case 9: case 10: case 13: case 14:
            i += 2;
          break;
          case 1: case 8:
            if(str.center) left = startLeft - Math.floor(t.textWidth(cs, codes, i) / 2);
            else left = startLeft;
            top += str.height ? str.height : cs.fontHeight;
          break;
          case 12:
            c = codes[i] | (codes[i + 1] << 8);
            i += 2;
            color = c == 0xFF ? str.color : c;
          break;
        }
      } else {
        left = t.layText(cs, c, left, top, color);
      }
    }

    if(slot == 0) {
      t._nextLeft = left;
      t._nextTop = top;
    }
    str.x = left;
  };

  // Paint the text layer over the frame
  s.renderTexts = function() {
    var t = this, runs = t._textLayer, ctx = ScummVM.context,
        width = ScummVM.width, height = ScummVM.height, img, i, run, cs, data, j;

    if(!runs || !runs.length) return;

    img = ctx.getImageData(0, 0, width, height);
    for(i = 0; i < runs.length; i++) {
      run = runs[i];
      cs = t.getCharsetRenderer(run.cs);
      if(!cs) continue;
      // The charset's own colour table, then colour 1 replaced by the
      // text's colour -- displayDialog's memcpy plus setColor
      data = t._charsetData[cs.curId];
      for(j = 0; j < 4; j++) t._charsetColorMap[j] = data ? (data[j] || 0) : 0;
      t._charsetColorMap[1] = run.color;
      cs.drawLine(img.data, width, height, run.codes, run.x, run.y, run.color);
    }
    ctx.putImageData(img, 0, 0);
  };
}());
