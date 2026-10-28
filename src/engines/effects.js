/*
 * Palette effects and screen transitions, ported from ScummVM's
 * engines/scumm/palette.cpp and gfx.cpp.
 *
 * Colour cycling (the CYCL block of a room) is what makes water shimmer
 * and fires flicker: ranges of palette entries rotate on a timer, and the
 * screen -- redrawn from palette indices every frame -- follows. Scripts
 * also darken or tint the palette (roomOps intensity), fade it towards
 * colours held in strings (palManipulate), and set the shadow table actors
 * use for colour 13.
 *
 * Room transitions (iris, box wipes, dissolves, scrolls) run between the
 * old picture and the new. ScummVM performs them synchronously, holding the
 * game until they finish; here the game loop is held instead while the
 * transition plays on its own timer, revealing the new frame in the same
 * 8x8 blocks and order.
 */
(function(){
  var s = ScummVM.engines.SCUMM;

  // --- colour cycling (palette.cpp) ------------------------------------------

  s.initEffects = function() {
    var t = this, i;
    t._colorCycle = [];
    for (i = 0; i < 16; i++) t._colorCycle[i] = {delay: 0, counter: 0, flags: 0, start: 0, end: 0};
    t._shadowPalette = [];
    for (i = 0; i < 256; i++) t._shadowPalette[i] = i;
    t._palManipCounter = 0;
    t._screenEffectFlag = true;
    t._switchRoomEffect = t._switchRoomEffect2 = t._newEffect = 0;
    t._doEffect = false;
    t._effectQueue = [];
    t._effectBusy = false;
    t._pendingFadeIn = null;
    t._shakeEnabled = false;
    t._shakeFrame = 0;
  };

  // initCycl: the room's CYCL block -- index, 2 unused bytes, rate, flags,
  // first and last colour, until a 0 index
  s.initCycl = function(ptr) {
    var t = this, j, c, rate;
    for (j = 0; j < 16; j++) {
      c = t._colorCycle[j];
      c.delay = c.counter = c.flags = c.start = c.end = 0;
    }
    if (!ptr) return;
    ptr = ptr.newRelativeStream(0);
    while ((j = ptr.readUI8()) != 0) {
      if (j < 1 || j > 16) { error("Invalid color cycle index " + j); return; }
      c = t._colorCycle[j - 1];
      ptr.seek(2);
      c.counter = 0;
      rate = ptr.readUI16(true);
      c.delay = rate ? Math.floor(16384 / rate) : 0;
      c.flags = ptr.readUI16(true);
      c.start = ptr.readUI8();
      c.end = ptr.readUI8();
    }
  };

  s.stopCycle = function(i) {
    var t = this;
    if (i != 0) {
      t._colorCycle[i - 1].delay = 0;
      return;
    }
    for (i = 0; i < 16; i++) t._colorCycle[i].delay = 0;
  };

  // Rotate entries start..end of a palette one place
  function doCyclePalette(pal, start, end, forward) {
    var tmp;
    if (forward) {
      tmp = pal[end];
      for (var i = end; i > start; i--) pal[i] = pal[i - 1];
      pal[start] = tmp;
    } else {
      tmp = pal[start];
      for (var j = start; j < end; j++) pal[j] = pal[j + 1];
      pal[end] = tmp;
    }
  }

  // An index table pointing into a cycled palette has to follow it
  function doCycleIndirectPalette(pal, start, end, forward) {
    var num = end - start + 1, offset = forward ? 1 : num - 1, i;
    for (i = 0; i < 256; i++)
      if (start <= pal[i] && pal[i] <= end)
        pal[i] = (pal[i] - start + offset) % num + start;
    doCyclePalette(pal, start, end, forward);
  }

  s.cyclePalette = function() {
    var t = this, i, c, valueToAdd, forward;
    valueToAdd = t.scummVar("timer");
    if (valueToAdd < t.scummVar("timer_next")) valueToAdd = t.scummVar("timer_next");
    for (i = 0; i < 16; i++) {
      c = t._colorCycle[i];
      if (!c.delay || c.start > c.end) continue;
      c.counter += valueToAdd;
      if (c.counter >= c.delay) {
        c.counter %= c.delay;
        forward = !(c.flags & 2);
        t.moveMemInPalRes(c.start, c.end, c.flags & 2);
        doCyclePalette(t._currentPalette, c.start, c.end, forward);
        doCycleIndirectPalette(t._shadowPalette, c.start, c.end, forward);
      }
    }
  };

  // Cycle the palManipulate target too, or the fade would undo the cycling
  s.moveMemInPalRes = function(start, end, direction) {
    var t = this;
    if (!t._palManipCounter) return;
    doCyclePalette(t._palManipPalette, start, end, !direction);
    doCyclePalette(t._palManipIntermediatePal, start, end, !direction);
  };

  // --- intensity, shadow and palette fades ------------------------------------

  // The room's own palette, as loaded, entry i
  s.roomPaletteEntry = function(i) {
    var clut = this._gfx && this._gfx["CLUT"];
    if (!clut) return [0, 0, 0];
    return [clut.readByteAt(8 + i * 3), clut.readByteAt(8 + i * 3 + 1), clut.readByteAt(8 + i * 3 + 2)];
  };

  // darkenPalette: entries scaled from the room's palette; SCUMM 5 keeps
  // them below 252, the values that mean "keep" in a room palette
  s.darkenPalette = function(redScale, greenScale, blueScale, startColor, endColor) {
    var t = this, max = 252, j, c, scale = [redScale, greenScale, blueScale], k, v;
    if (startColor > endColor) return;
    for (j = startColor; j <= endColor && j < 256; j++) {
      c = t.roomPaletteEntry(j);
      for (k = 0; k < 3; k++) {
        v = Math.floor(c[k] * scale[k] / 0xFF);
        if (v > max) v = max;
        c[k] = v;
      }
      t._currentPalette[j] = c;
    }
  };

  // setShadowPalette (the v5 form): for each colour, the nearest colour in
  // startColor..endColor to its scaled-down self -- what an actor's shadow
  // pixel (costume colour 13) turns the colour under it into
  s.setShadowPalette = function(redScale, greenScale, blueScale, startColor, endColor, start, end) {
    var t = this, i, j, p, q, r, g, b, best, bestsum, sum;
    for (i = start; i < end; i++) {
      p = t.roomPaletteEntry(i);
      r = ((p[0] >> 2) * redScale) >> 8;
      g = ((p[1] >> 2) * greenScale) >> 8;
      b = ((p[2] >> 2) * blueScale) >> 8;
      best = 0;
      bestsum = 32000;
      for (j = startColor; j <= endColor; j++) {
        q = t.roomPaletteEntry(j);
        sum = Math.abs((q[0] >> 2) - r) + Math.abs((q[1] >> 2) - g) + Math.abs((q[2] >> 2) - b);
        if (sum < bestsum) {
          bestsum = sum;
          best = j;
        }
      }
      t._shadowPalette[i] = best;
    }
  };

  // palManipulateInit: fade entries start..end towards the colours held in
  // string resources resID (red), resID+1 (green), resID+2 (blue) over
  // `time` frames
  s.palManipulateInit = function(resID, start, end, time) {
    var t = this, s1 = t.getResourceMessage("string", resID), s2 = t.getResourceMessage("string", resID + 1),
        s3 = t.getResourceMessage("string", resID + 2), i;
    if (s1 == null || s2 == null || s3 == null) {
      error("palManipulateInit: missing string resources " + resID + "-" + (resID + 2));
      return;
    }
    t._palManipStart = start;
    t._palManipEnd = end;
    t._palManipCounter = 0;
    t._palManipPalette = [];
    t._palManipIntermediatePal = [];
    for (i = start; i < end; i++) {
      t._palManipPalette[i] = [s1.charCodeAt(i) & 0xFF, s2.charCodeAt(i) & 0xFF, s3.charCodeAt(i) & 0xFF];
      t._palManipIntermediatePal[i] = [t._currentPalette[i][0] << 8, t._currentPalette[i][1] << 8,
                                       t._currentPalette[i][2] << 8];
    }
    t._palManipCounter = time;
  };

  s.palManipulate = function() {
    var t = this, i, k, between, target, out;
    if (!t._palManipCounter || !t._palManipPalette) return;
    for (i = t._palManipStart; i < t._palManipEnd; i++) {
      target = t._palManipPalette[i];
      between = t._palManipIntermediatePal[i];
      out = [];
      for (k = 0; k < 3; k++) {
        between[k] = (between[k] + Math.trunc(((target[k] << 8) - between[k]) / t._palManipCounter)) & 0xFFFF;
        out[k] = between[k] >> 8;
      }
      t._currentPalette[i] = out;
    }
    t._palManipCounter--;
  };

  // --- shake (gfx.cpp) ---------------------------------------------------------

  var SHAKE_POSITIONS = [0, 2, 4, 2, 0, 4, 6, 2];

  s.setShake = function(mode) {
    this._shakeEnabled = mode != 0;
    this._shakeFrame = 0;
  };

  // How far down the picture is drawn this frame
  s.shakeOffset = function() {
    var t = this;
    if (!t._shakeEnabled) return 0;
    t._shakeFrame = (t._shakeFrame + 1) % SHAKE_POSITIONS.length;
    return SHAKE_POSITIONS[t._shakeFrame];
  };

  // --- the per-frame step: scummLoop_handleEffects ----------------------------

  s.handleEffects = function() {
    var t = this;
    t.cyclePalette();
    t.palManipulate();
    if (t._doEffect) {
      t._doEffect = false;
      t.fadeIn(t._newEffect);
      t.clearClickedStatus();
    }
  };

  // --- transitions -------------------------------------------------------------

  // gfx.cpp transitionEffects: iterations, then per iteration the change to
  // the 16 strip/row numbers that make up four rectangles
  var TRANSITIONS = [
    // iris
    [13, [1, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, 1, 1, 1, -1],
         [0, 0, 39, 0, 39, 0, 39, 24, 0, 24, 39, 24, 0, 0, 0, 24]],
    // box wipe from the top left
    [25, [0, 1, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 0, 0, 0, 0],
         [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 255, 0, 0, 0]],
    // box wipe from the bottom right
    [25, [-2, -1, 0, -1, -2, -1, -2, 0, -2, -1, -2, 0, 0, 0, 0, 0],
         [39, 24, 39, 24, 39, 24, 39, 24, 38, 24, 38, 24, 255, 0, 0, 0]],
    // inverse box wipe
    [25, [0, -1, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, 0, 0, 0, 0],
         [0, 24, 39, 24, 39, 0, 39, 24, 38, 0, 38, 24, 255, 0, 0, 0]]
    // effects 5 and 6 are for v1/v2 games only; they are shown as a cut
  ];

  // The current picture, as shown
  function grab() {
    return ScummVM.context.getImageData(0, 0, ScummVM.width, ScummVM.height);
  }

  function copyRect(dst, src, x, y, w, h) {
    var W = ScummVM.width, H = ScummVM.height, row, i, o, n;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    if (w <= 0 || h <= 0) return;
    for (row = 0; row < h; row++) {
      o = ((y + row) * W + x) * 4;
      n = w * 4;
      for (i = 0; i < n; i++) dst.data[o + i] = src.data[o + i];
    }
  }

  // Each transition becomes a list of steps; each step is the rectangles of
  // `to` to copy over what is shown, then the wait (ms) before the next
  s.transitionSteps = function(effect) {
    var t = this, vs = t._virtscreens[0], top = vs.topline, steps = [], delay;
    var fadeDelay = t.scummVar("fade_delay"), qf = 1000 / 240;
    delay = fadeDelay * qf;

    if (effect >= 1 && effect <= 4) {
      var tr = TRANSITIONS[effect - 1], height = Math.min(vs.h, t._screenHeight),
          bottom = Math.floor(height / 8), tab = [], i, j, l, tt, r, b, rects;
      for (i = 0; i < 16; i++) tab[i] = tr[2][i] == 24 ? Math.floor(height / 8) - 1 : tr[2][i];
      for (j = 0; j < tr[0]; j++) {
        rects = [];
        for (i = 0; i < 4; i++) {
          l = tab[i * 4]; tt = tab[i * 4 + 1]; r = tab[i * 4 + 2]; b = tab[i * 4 + 3];
          if (tt == b) {
            for (; l <= r; l++)
              if (l >= 0 && l < 40 && tt < bottom) rects.push([l * 8, top + tt * 8, 8, 8]);
          } else {
            if (l < 0 || l >= 40 || b <= tt) continue;
            if (b > bottom) b = bottom;
            if (tt < 0) tt = 0;
            rects.push([l * 8, top + tt * 8, 8, (b + 1 - tt) * 8]);
          }
        }
        // updateDirtyScreen never goes past the room
        for (i = 0; i < rects.length; i++)
          rects[i][3] = Math.min(rects[i][3], top + vs.h - rects[i][1]);
        steps.push({rects: rects, wait: delay});
        for (i = 0; i < 16; i++) tab[i] += tr[1][i];
      }
    } else if (effect == 128 || effect == 134 || effect == 135) {
      // dissolveEffect: blocks in random order, refreshing every so often
      var bw = effect == 128 ? 8 : 1, bh = effect == 128 ? 4 : effect == 134 ? 1 : vs.h,
          w = Math.ceil(vs.w / bw), h = Math.ceil(vs.h / bh), offs = [], x, y, k, tmp, cur = [],
          is1x1 = bw == 1 && bh == 1, freeze = Math.floor(h / 8),
          before = Math.floor((w * h) / (freeze == 0 ? 18 : freeze)), blits = 0;
      for (x = 0; x < vs.w; x += bw)
        for (y = 0; y < vs.h; y += bh)
          offs.push([x, y]);
      for (k = 1; k < offs.length; k++) {
        j = Math.floor(Math.random() * k);
        tmp = offs[k]; offs[k] = offs[j]; offs[j] = tmp;
      }
      for (k = 0; k < offs.length; k++) {
        cur.push([offs[k][0], top + offs[k][1], bw, bh]);
        if ((is1x1 && ++blits >= before) || (!is1x1 && offs[k][1] * vs.w + offs[k][0] < vs.h)) {
          blits = 0;
          steps.push({rects: cur, wait: qf});
          cur = [];
        }
      }
      if (cur.length) steps.push({rects: cur, wait: 0});
    } else if (effect >= 130 && effect <= 133) {
      steps.scroll = 133 - effect;
      for (var p = 8; p <= (steps.scroll < 2 ? vs.h : vs.w); p += 8)
        steps.push({scroll: p, wait: delay});
    }
    return steps;
  };

  // gfx.cpp fadeOut: the room goes to black through the effect
  s.fadeOut = function(effect) {
    var t = this, vs = t._virtscreens[0], from, to, i, top, bottom;
    t._camera.last.x = t._camera.cur.x;
    if (t._screenEffectFlag && effect != 0) {
      from = t._effectQueue.length ? t._effectQueue[t._effectQueue.length - 1].to : grab();
      to = new ImageData(new Uint8ClampedArray(from.data), from.width, from.height);
      top = vs.topline; bottom = vs.topline + vs.h;
      for (i = top * ScummVM.width * 4; i < Math.min(bottom, ScummVM.height) * ScummVM.width * 4; i += 4) {
        to.data[i] = to.data[i + 1] = to.data[i + 2] = 0;
        to.data[i + 3] = 255;
      }
      t._effectQueue.push({effect: effect == 129 ? 0 : effect, from: from, to: to});
    }
    t._screenEffectFlag = false;
  };

  // gfx.cpp fadeIn: the new room appears through the effect. The picture to
  // reveal is only complete once this frame has been drawn, so it is taken
  // then (finishFrameEffects).
  s.fadeIn = function(effect) {
    this._pendingFadeIn = effect;
    this._screenEffectFlag = true;
  };

  // Called by drawDirtyScreenParts with the frame drawn but not yet shown.
  // Returns true when the transitions take over showing it.
  s.finishFrameEffects = function() {
    var t = this, frame;
    if (t._pendingFadeIn !== null) {
      var effect = t._pendingFadeIn;
      t._pendingFadeIn = null;
      if (t._effectQueue.length || (effect != 0 && effect != 129)) {
        frame = grab();
        t._effectQueue.push({effect: (effect == 129) ? 0 : effect, from: null, to: frame, fadeIn: true});
      }
    }
    if (!t._effectQueue.length) return false;
    if (!t._effectBusy) t.runEffects();
    return true;
  };

  // Play the queued transitions one after the other, holding the game
  s.runEffects = function() {
    var t = this, shown = null, item, steps, n;
    t._effectBusy = true;

    function show(img) {
      ScummVM.context.putImageData(img, 0, 0);
      ScummVM.present();
    }

    function nextItem() {
      item = t._effectQueue.shift();
      if (!item) {
        t._effectBusy = false;
        return;
      }
      if (!shown) shown = item.from || grab();
      if (!item.from) item.from = shown;
      shown = new ImageData(new Uint8ClampedArray(item.from.data), item.from.width, item.from.height);
      // outside the room area the new picture shows straight away
      var vs = t._virtscreens[0];
      copyRect(shown, item.to, 0, 0, ScummVM.width, vs.topline);
      copyRect(shown, item.to, 0, vs.topline + vs.h, ScummVM.width, ScummVM.height);
      steps = item.effect ? t.transitionSteps(item.effect) : [];
      n = 0;
      step();
    }

    function step() {
      var st, vs = t._virtscreens[0], i, p;
      if (n >= steps.length) {
        shown = item.to;
        show(shown);
        nextItem();
        return;
      }
      st = steps[n++];
      if (st.rects) {
        for (i = 0; i < st.rects.length; i++)
          copyRect(shown, item.to, st.rects[i][0], st.rects[i][1], st.rects[i][2], st.rects[i][3]);
      } else {
        // scroll: the new picture pushes the old one off screen
        p = st.scroll;
        var dir = steps.scroll, top = vs.topline, h = vs.h, w = vs.w, img = shown;
        var fromImg = item.from;
        var tmp = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var sx = x, sy = y, src;
            if (dir == 0) { sy = y + p; src = sy < h ? fromImg : item.to; if (sy >= h) sy -= h; }
            else if (dir == 1) { sy = y - p; src = sy >= 0 ? fromImg : item.to; if (sy < 0) sy += h; }
            else if (dir == 2) { sx = x + p; src = sx < w ? fromImg : item.to; if (sx >= w) sx -= w; }
            else { sx = x - p; src = sx >= 0 ? fromImg : item.to; if (sx < 0) sx += w; }
            var o = ((top + y) * img.width + x) * 4, so = ((top + sy) * img.width + sx) * 4;
            tmp.data[o] = src.data[so]; tmp.data[o + 1] = src.data[so + 1];
            tmp.data[o + 2] = src.data[so + 2]; tmp.data[o + 3] = 255;
          }
        }
        shown = tmp;
      }
      show(shown);
      window.setTimeout(step, st.wait);
    }

    nextItem();
  };
}());
