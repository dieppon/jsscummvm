(function(){
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  s.resetPalette = function() {
    s.setDirtyColors(0, 255);
  };

  s.setDirtyColors = function(min, max) {
    var t = this;
    if(t._palDirtyMin > min)
      t._palDirtyMin = min
    if(t._palDirtyMax > max)
      t._palDirtyMax = max
  };

  s.setCurrentPalette = function(palindex) {
    var t = this;
    t._curPalIndex = palindex;
    log("setCurrentPalette");
    pals = t.getPalettePtr(t._curPalIndex, t._roomResource);
    t.setPaletteFromPtr(pals);
  };

  s.getPalettePtr = function(palindex, room) {
    var t = this;
    if(t._gfx["CLUT"]) return t._gfx["CLUT"];
    else error("no clut");
    return null;
  };

  s.setPaletteFromPtr = function(ptr, numcolor) {
    var t = this, firstIndex = 0, i, dest, r, g, b;

    if(!numcolor || numcolor < 0) {
      numcolor = t.getResourceDataSize(ptr) / 3;
    }

    dest = t._currentPalette;
    for(i = firstIndex; i < numcolor; i++) {
      r = ptr.readUI8(); g = ptr.readUI8(); b = ptr.readUI8();
      // palette.cpp: in SCUMM 5 an all-near-white entry above 15 means
      // "keep what is there", so colours scripts set survive a room load
      if(i <= 15 || r < 252 || g < 252 || b < 252)
        t._currentPalette[i] = [r,g,b];
    }
  };

  // palette.cpp setPalColor: scripts recolour single entries this way --
  // Monkey Island picks its text colours with it
  s.setPalColor = function(idx, r, g, b) {
    var t = this;
    t._currentPalette[idx] = [r & 0xFF, g & 0xFF, b & 0xFF];
    t.setDirtyColors(idx, idx);
  };

  s.paletteColor = function(idx, palette) {
    var t = this, color = "#", i, c, pal_color = (palette ? palette[idx] : t._currentPalette[idx]);

    if(!pal_color) return "#000000";

    for(i = 0; i < 3; i++) {
      c = pal_color[i].toString(16)
      color += (c.length == 1 ? "0" + c : c)
    }
    return color;
  }

  s.updatePalette = function() {
  };
}());
