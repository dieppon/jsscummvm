/*
 * The text of the oldest SCUMM games (Maniac Mansion and Zak McKracken v2):
 * their font is in the interpreter, not the game files -- 8x8 glyphs, one
 * byte a row, the leftmost pixel the highest bit. Ported from ScummVM's
 * engines/scumm/charset-fontdata.cpp (englishCharsetDataV2) and the
 * CharsetRendererV2/V3 that draws it (charset.cpp), with the same interface
 * as gfx.js's CharsetRenderer.
 */
(function() {
  var s = ScummVM.engines.SCUMM;

  // englishCharsetDataV2, as hex: 8 bytes for each of its 128 glyphs
  var FONT_HEX = [
    "00000000000000000103060c183e030080c06030187cc00000033e180c06030100c07c183060c0800303030303030303",
    "03030307070f1f7fe0800000000080e007010000000001070000000103060c1800000080c0603018183060c080000000",
    "180c0603010000000000001f1f181818000000f8f8181818181818f8f80000001818181f1f00000000000003070c1818",
    "000000c0e0301818181830e0c000000018180c07030000001818181f1f181818181818f8f8181818181818ffff000000",
    "000000ffff181818181818ffff1818181818181818181818000000ffff000000183c66c3c3663c18183c7effff7e3c18",
    "1866c3dbdbc366180000000000ffffff0000000000000000181818180000180066666600000000006666ff66ff666600",
    "183e583c1a7c180000000000004949003c663c3867663f00060c1800000000000c18303030180c0030180c0c0c183000",
    "00663cff3c6600000018187e1818000000000000001818300000007e0000000000000000001818000003060c18306000",
    "3c66666666663c001818381818187e003c66060c30607e003c66061c06663c00060e1e667f0606007e607c0606663c00",
    "3c66607c66663c007e660c18181818003c66663c66663c003c66663e06663c0000001800001800000000180000181830",
    "0e18306030180e007c82baa2ba827c0070180c060c1870003c66060c18001800000000ffff000000183c667e66666600",
    "7c66667c66667c003c66606060663c00786c6666666c78007e60607860607e007e606078606060003c66606e66663c00",
    "6666667e666666003c18181818183c001e0c0c0c0c6c3800666c7870786c66006060606060607e0063777f6b63636300",
    "66767e7e6e6666003c66666666663c007c66667c606060003c666666663c0e007c66667c786c66003c66603c06663c00",
    "7e181818181818006666666666663c0066666666663c18006363636b7f77630066663c183c6666006666663c18181800",
    "7e060c1830607e003c30303030303c000c12307c3062fc003c0c0c0c0c0c3c000000000000dbdb000010307f7f301000",
    "666666000000000000003c063e663e000060607c66667c0000003c6060603c000006063e66663e0000003c667e603c00",
    "000e183e1818180000003e66663e067c0060607c666666000018003818183c00000600060606063c0060606c786c6600",
    "0038181818183c000000667f7f6b630000007c666666660000003c6666663c0000007c66667c606000003e66663e0606",
    "00007c666060600000003e603c067c0000187e1818180e000000666666663e0000006666663c18000000636b7f3e3600",
    "0000663c183c660000006666663e0c7800007e0c18307e000103066c78706000183c7eff1818181818181818ff7e3c18",
    "103070ffff703010080c0effff0e0c08"
  ].join("");
  var FONT = [];
  for (var i = 0; i < FONT_HEX.length; i += 2) FONT.push(parseInt(FONT_HEX.substr(i, 2), 16));
  var NUM_CHARS = FONT.length >> 3;

  s.CharsetRendererV2 = function(engine) {
    this.engine = engine;
    this.curId = 0;
    this.ptr = true;
    this.bitsPerPixel = 1;
    this.fontHeight = 8;
    this.numChars = NUM_CHARS;
  };

  s.CharsetRendererV2.prototype = {
    // one font, whatever the game asks for
    setCurID: function(id) { this.curId = id; return true; },
    getCharWidth: function(chr) { return chr >= 0 && chr < NUM_CHARS ? 8 : 0; },
    getStringWidth: function(codes) {
      var w = 0, i;
      for (i = 0; i < codes.length; i++) w += this.getCharWidth(codes[i]);
      return w;
    },
    lines: s.CharsetRenderer.prototype.lines,
    wrap: s.CharsetRenderer.prototype.wrap,
    glyphInfo: function(chr) {
      if (chr < 0 || chr >= NUM_CHARS) return null;
      return {w: 8, h: 8, xoff: 0, yoff: 0};
    },
    // CharsetRendererV3::drawBits1: solid pixels in the string's colour
    printChar: function(data, dw, dh, chr, x, y, color) {
      var engine = this.engine, rgb = engine._currentPalette[color], px, py, bits, sx, sy, idx;
      if (chr < 0 || chr >= NUM_CHARS) return 0;
      if (!rgb) return 8;
      for (py = 0; py < 8; py++) {
        bits = FONT[chr * 8 + py];
        sy = y + py;
        if (sy < 0 || sy >= dh) continue;
        for (px = 0; px < 8; px++) {
          if (!(bits & (0x80 >> px))) continue;
          sx = x + px;
          if (sx < 0 || sx >= dw) continue;
          idx = (sy * dw + sx) * 4;
          data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        }
      }
      return 8;
    },
    drawLine: function(data, dw, dh, codes, x, y, color) {
      for (var i = 0; i < codes.length; i++)
        x += this.printChar(data, dw, dh, codes[i], x, y, color);
    }
  };
}());
