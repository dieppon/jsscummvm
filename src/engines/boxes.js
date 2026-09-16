/*
 * Walk boxes, ported from ScummVM's engines/scumm/boxes.cpp.
 *
 * A room's walkable area is a set of convex quadrangles ("boxes") stored in
 * its BOXD block, plus a precomputed routing table in BOXM that says, for any
 * pair of boxes, which box to step into next. Everything an actor does when
 * walking -- clamping a destination into the walkable area, picking a route,
 * scaling with distance -- is built on these.
 *
 * ScummVM keeps the boxes as raw bytes in a resource and pokes at them in
 * place. We parse them into objects instead: setBoxFlags/setBoxScale need to
 * write, and our streams are read-only views over a string buffer. For v5 the
 * layout is fixed (20 bytes a box) so the two are equivalent.
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  // boxes.h
  var kBoxXFlip = 0x08, kBoxYFlip = 0x10, kBoxIgnoreScale = 0x20,
      kBoxPlayerOnly = 0x20, kBoxLocked = 0x40, kBoxInvisible = 0x80;

  var SIZEOF_BOX = 20;
  var BOX_MATRIX_SIZE = 16384;

  // Actor::kInvalidBox. v5 uses 0xFF; the engine elsewhere spells the same
  // idea "invalid", so accept both when comparing.
  var kInvalidBox = 0xFF;
  s.kInvalidBox = kInvalidBox;

  s.isInvalidBox = function(box) {
    return box === kInvalidBox || box === "invalid" || box === null || box === undefined;
  };

  /* --- loading ---------------------------------------------------------- */

  s.loadBoxes = function(roomptr) {
    var t = this, ptr, i, n, size, s1, y1, s2, y2,
        MKID_BE = _system.MKID_BE;

    t._boxes = [];
    t._boxMatrix = [];
    t._scaleSlots = [];

    ptr = t.findResourceData(MKID_BE("BOXD"), roomptr);
    if(ptr) {
      n = ptr.readUI16();
      for(i = 0; i < n; i++) {
        t._boxes[i] = {
          ulx: ptr.readSI16(), uly: ptr.readSI16(),
          urx: ptr.readSI16(), ury: ptr.readSI16(),
          lrx: ptr.readSI16(), lry: ptr.readSI16(),
          llx: ptr.readSI16(), lly: ptr.readSI16(),
          mask: ptr.readUI8(), flags: ptr.readUI8(),
          scale: ptr.readUI16()
        };
      }
    }

    ptr = t.findResourceData(MKID_BE("BOXM"), roomptr);
    if(ptr) {
      size = t.getResourceDataSize(t.findResource(MKID_BE("BOXM"), roomptr));
      for(i = 0; i < size; i++)
        t._boxMatrix[i] = ptr.readUI8();
    }

    ptr = t.findResourceData(MKID_BE("SCAL"), roomptr);
    if(ptr) {
      for(i = 1; i < 6; i++) {
        s1 = ptr.readUI16(); y1 = ptr.readUI16();
        s2 = ptr.readUI16(); y2 = ptr.readUI16();
        if(s1 || y1 || s2 || y2)
          t.setScaleSlot(i, 0, y1, s1, 0, y2, s2);
      }
    }
  };

  /* --- box accessors ---------------------------------------------------- */

  s.getNumBoxes = function() {
    return this._boxes ? this._boxes.length : 0;
  };

  s.getBoxBaseAddr = function(box) {
    var t = this;
    if(!t._boxes || t.isInvalidBox(box)) return null;
    // ScummVM tolerates a script asking for one box past the end by using the
    // last box; several games' scripts rely on it.
    if(box == t._boxes.length) box--;
    if(box < 0 || box >= t._boxes.length) return null;
    return t._boxes[box];
  };

  s.getBoxFlags = function(box) {
    var b = this.getBoxBaseAddr(box);
    return b ? b.flags : 0;
  };

  s.setBoxFlags = function(box, val) {
    var t = this, b;
    // SCUMM7+ stores flags above 0xC000 out of band; v5 never does.
    if(val & 0xC000) return;
    b = t.getBoxBaseAddr(box);
    if(b) b.flags = val & 0xFF;
  };

  s.getBoxScale = function(box) {
    var b = this.getBoxBaseAddr(box);
    return b ? b.scale : 255;
  };

  s.setBoxScale = function(box, scale) {
    var b = this.getBoxBaseAddr(box);
    if(b) b.scale = scale;
  };

  s.getMaskFromBox = function(box) {
    var b = this.getBoxBaseAddr(box);
    return b ? b.mask : 0;
  };

  s.setScaleSlot = function(slot, x1, y1, scale1, x2, y2, scale2) {
    this._scaleSlots[slot - 1] = {x1: x1, y1: y1, scale1: scale1,
                                  x2: x2, y2: y2, scale2: scale2};
  };

  s.getScaleFromSlot = function(slot, x, y) {
    var sl = this._scaleSlots[slot - 1], scale, scaleX = 0, scaleY = 0;
    if(!sl) return 255;
    if(sl.y1 == sl.y2 && sl.x1 == sl.x2) return 255;

    if(sl.y1 != sl.y2) {
      if(y < 0) y = 0;
      scaleY = ((sl.scale2 - sl.scale1) * (y - sl.y1) / (sl.y2 - sl.y1) + sl.scale1) | 0;
    }
    if(sl.x1 == sl.x2) {
      scale = scaleY;
    } else {
      scaleX = ((sl.scale2 - sl.scale1) * (x - sl.x1) / (sl.x2 - sl.x1) + sl.scale1) | 0;
      scale = (sl.y1 == sl.y2) ? scaleX : ((scaleX + scaleY) / 2) | 0;
    }

    if(scale < 1) scale = 1;
    else if(scale > 255) scale = 255;
    return scale;
  };

  s.getScale = function(box, x, y) {
    var t = this, b = t.getBoxBaseAddr(box), scale, slot = 0;
    if(!b) return 255;

    scale = b.scale;
    if(scale & 0x8000) slot = (scale & 0x7FFF) + 1;
    if(slot) scale = t.getScaleFromSlot(slot, x, y);

    return scale;
  };

  s.getBoxCoordinates = function(boxnum) {
    var b = this.getBoxBaseAddr(boxnum);
    if(!b) return null;
    return {
      ul: {x: b.ulx, y: b.uly},
      ur: {x: b.urx, y: b.ury},
      lr: {x: b.lrx, y: b.lry},
      ll: {x: b.llx, y: b.lly}
    };
  };

  /* --- geometry --------------------------------------------------------- */

  var sqrDist = function(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  var compareSlope = function(p1, p2, p3) {
    return (p2.y - p1.y) * (p3.x - p1.x) <= (p3.y - p1.y) * (p2.x - p1.x);
  };

  // Integer division truncating toward zero, matching C's /.
  var idiv = function(a, b) {
    return (a / b) | 0;
  };

  // The point on a line segment closest to p.
  var closestPtOnLine = function(lineStart, lineEnd, p) {
    var result = {x: 0, y: 0},
        lxdiff = lineEnd.x - lineStart.x,
        lydiff = lineEnd.y - lineStart.y,
        dist, a, b, c;

    if(lineEnd.x == lineStart.x) {            // vertical
      result.x = lineStart.x;
      result.y = p.y;
    } else if(lineEnd.y == lineStart.y) {     // horizontal
      result.x = p.x;
      result.y = lineStart.y;
    } else {
      dist = lxdiff * lxdiff + lydiff * lydiff;
      if(Math.abs(lxdiff) > Math.abs(lydiff)) {
        a = idiv(lineStart.x * lydiff, lxdiff);
        b = idiv(p.x * lxdiff, lydiff);
        c = idiv((a + b - lineStart.y + p.y) * lydiff * lxdiff, dist);
        result.x = c;
        result.y = idiv(c * lydiff, lxdiff) - a + lineStart.y;
      } else {
        a = idiv(lineStart.y * lxdiff, lydiff);
        b = idiv(p.y * lydiff, lxdiff);
        c = idiv((a + b - lineStart.x + p.x) * lydiff * lxdiff, dist);
        result.x = idiv(c * lxdiff, lydiff) - a + lineStart.x;
        result.y = c;
      }
    }

    // Clamp to the segment.
    if(Math.abs(lydiff) < Math.abs(lxdiff)) {
      if(lxdiff > 0) {
        if(result.x < lineStart.x) result = {x: lineStart.x, y: lineStart.y};
        else if(result.x > lineEnd.x) result = {x: lineEnd.x, y: lineEnd.y};
      } else {
        if(result.x > lineStart.x) result = {x: lineStart.x, y: lineStart.y};
        else if(result.x < lineEnd.x) result = {x: lineEnd.x, y: lineEnd.y};
      }
    } else {
      if(lydiff > 0) {
        if(result.y < lineStart.y) result = {x: lineStart.x, y: lineStart.y};
        else if(result.y > lineEnd.y) result = {x: lineEnd.x, y: lineEnd.y};
      } else {
        if(result.y > lineStart.y) result = {x: lineStart.x, y: lineStart.y};
        else if(result.y < lineEnd.y) result = {x: lineEnd.x, y: lineEnd.y};
      }
    }

    return result;
  };
  s.closestPtOnLine = closestPtOnLine;

  s.getClosestPtOnBox = function(box, x, y) {
    var p = {x: x, y: y}, tmp, dist,
        best = {dist: 0xFFFFFF, x: 0, y: 0},
        sides = [[box.ul, box.ur], [box.ur, box.lr],
                 [box.lr, box.ll], [box.ll, box.ul]], i;

    for(i = 0; i < 4; i++) {
      tmp = closestPtOnLine(sides[i][0], sides[i][1], p);
      dist = sqrDist(p, tmp);
      if(dist < best.dist) { best.dist = dist; best.x = tmp.x; best.y = tmp.y; }
    }
    return best;
  };

  s.inBoxQuickReject = function(box, x, y, threshold) {
    var v;

    v = x - threshold;
    if(v > box.ul.x && v > box.ur.x && v > box.lr.x && v > box.ll.x) return true;
    v = x + threshold;
    if(v < box.ul.x && v < box.ur.x && v < box.lr.x && v < box.ll.x) return true;
    v = y - threshold;
    if(v > box.ul.y && v > box.ur.y && v > box.lr.y && v > box.ll.y) return true;
    v = y + threshold;
    if(v < box.ul.y && v < box.ur.y && v < box.lr.y && v < box.ll.y) return true;

    return false;
  };

  var samePoint = function(a, b) { return a.x == b.x && a.y == b.y; };

  s.checkXYInBoxBounds = function(boxnum, x, y) {
    var t = this, box, p = {x: x, y: y}, tmp;

    if(t.isInvalidBox(boxnum) || boxnum < 0) return false;

    box = t.getBoxCoordinates(boxnum);
    if(!box) return false;

    // Cheap rejection: outside the bounding box of all four corners.
    if(x < box.ul.x && x < box.ur.x && x < box.lr.x && x < box.ll.x) return false;
    if(x > box.ul.x && x > box.ur.x && x > box.lr.x && x > box.ll.x) return false;
    if(y < box.ul.y && y < box.ur.y && y < box.lr.y && y < box.ll.y) return false;
    if(y > box.ul.y && y > box.ur.y && y > box.lr.y && y > box.ll.y) return false;

    // A degenerate box is a line segment; count points lying close to it as
    // inside. (Present from SCUMM5 on, which is what we are.)
    if((samePoint(box.ul, box.ur) && samePoint(box.lr, box.ll)) ||
       (samePoint(box.ul, box.ll) && samePoint(box.ur, box.lr))) {
      tmp = closestPtOnLine(box.ul, box.lr, p);
      if(sqrDist(p, tmp) <= 4) return true;
    }

    // Convex polygon containment: p must be on the same side of every edge.
    if(!compareSlope(box.ul, box.ur, p)) return false;
    if(!compareSlope(box.ur, box.lr, p)) return false;
    if(!compareSlope(box.lr, box.ll, p)) return false;
    if(!compareSlope(box.ll, box.ul, p)) return false;

    return true;
  };

  /* --- routing ---------------------------------------------------------- */

  s.getBoxMatrixBaseAddr = function() {
    var t = this, i = 0;
    if(!t._boxMatrix || !t._boxMatrix.length) return -1;
    if(t._boxMatrix[0] == 0xFF) i++;
    return i;
  };

  /*
   * Which box to step into to get from 'from' towards 'to'. Returns -1 when
   * there is no route. The matrix is a run-length table: for each box, triples
   * of (rangeStart, rangeEnd, viaBox) terminated by 0xFF.
   */
  s.getNextBox = function(from, to) {
    var t = this, boxm, i, dest = -1, end, numOfBoxes = t.getNumBoxes();

    if(from == to) return to;
    if(t.isInvalidBox(to)) return -1;
    if(t.isInvalidBox(from)) return to;
    if(from >= numOfBoxes || to >= numOfBoxes) return -1;

    boxm = t.getBoxMatrixBaseAddr();
    if(boxm < 0) return -1;
    end = t._boxMatrix.length;

    // Skip to the row for 'from'.
    for(i = 0; i < from && boxm < end; i++) {
      while(boxm < end && t._boxMatrix[boxm] != 0xFF) boxm += 3;
      boxm++;
    }

    while(boxm < end && t._boxMatrix[boxm] != 0xFF) {
      if(t._boxMatrix[boxm] <= to && to <= t._boxMatrix[boxm + 1])
        dest = t._boxMatrix[boxm + 2];
      boxm += 3;
    }

    return dest;
  };

  s.areBoxesNeighbors = function(box1nr, box2nr) {
    var t = this, box, box2, tmp, j, k, swapped1, swapped2, v;

    if((t.getBoxFlags(box1nr) & kBoxInvisible) ||
       (t.getBoxFlags(box2nr) & kBoxInvisible))
      return false;

    box2 = t.getBoxCoordinates(box1nr);
    box  = t.getBoxCoordinates(box2nr);
    if(!box || !box2) return false;

    // Look for touching sides. Only the "upper" side is compared, so the
    // coordinates are rotated four times each for all 16 combinations.
    for(j = 0; j < 4; j++) {
      for(k = 0; k < 4; k++) {
        // Upper sides on a common vertical line?
        if(box2.ur.x == box2.ul.x && box.ul.x == box2.ul.x && box.ur.x == box2.ul.x) {
          swapped1 = swapped2 = false;
          if(box2.ur.y < box2.ul.y) { swapped2 = true; v = box2.ur.y; box2.ur.y = box2.ul.y; box2.ul.y = v; }
          if(box.ur.y < box.ul.y)   { swapped1 = true; v = box.ur.y;  box.ur.y  = box.ul.y;  box.ul.y  = v; }

          if(!(box.ur.y < box2.ul.y || box.ul.y > box2.ur.y ||
               ((box.ul.y == box2.ur.y || box.ur.y == box2.ul.y) &&
                box2.ur.y != box2.ul.y && box.ul.y != box.ur.y)))
            return true;

          if(swapped2) { v = box2.ur.y; box2.ur.y = box2.ul.y; box2.ul.y = v; }
          if(swapped1) { v = box.ur.y;  box.ur.y  = box.ul.y;  box.ul.y  = v; }
        }

        // Upper sides on a common horizontal line?
        if(box2.ur.y == box2.ul.y && box.ul.y == box2.ul.y && box.ur.y == box2.ul.y) {
          swapped1 = swapped2 = false;
          if(box2.ur.x < box2.ul.x) { swapped2 = true; v = box2.ur.x; box2.ur.x = box2.ul.x; box2.ul.x = v; }
          if(box.ur.x < box.ul.x)   { swapped1 = true; v = box.ur.x;  box.ur.x  = box.ul.x;  box.ul.x  = v; }

          if(!(box.ur.x < box2.ul.x || box.ul.x > box2.ur.x ||
               ((box.ul.x == box2.ur.x || box.ur.x == box2.ul.x) &&
                box2.ur.x != box2.ul.x && box.ul.x != box.ur.x)))
            return true;

          if(swapped2) { v = box2.ur.x; box2.ur.x = box2.ul.x; box2.ul.x = v; }
          if(swapped1) { v = box.ur.x;  box.ur.x  = box.ul.x;  box.ul.x  = v; }
        }

        tmp = box2.ul; box2.ul = box2.ur; box2.ur = box2.lr; box2.lr = box2.ll; box2.ll = tmp;
      }
      tmp = box.ul; box.ul = box.ur; box.ur = box.lr; box.lr = box.ll; box.ll = tmp;
    }

    return false;
  };

  // Shortest route between every pair of boxes (Kleene / Floyd-Warshall).
  s.calcItineraryMatrix = function(num) {
    var t = this, boxSize = 64, adjacent = [], itinerary = [],
        i, j, k, distIK, distKJ;

    for(i = 0; i < num; i++) {
      for(j = 0; j < num; j++) {
        if(i == j) {
          adjacent[i * boxSize + j] = 0;
          itinerary[i * boxSize + j] = j;
        } else if(t.areBoxesNeighbors(i, j)) {
          adjacent[i * boxSize + j] = 1;
          itinerary[i * boxSize + j] = j;
        } else {
          adjacent[i * boxSize + j] = 255;
          itinerary[i * boxSize + j] = kInvalidBox;
        }
      }
    }

    for(k = 0; k < num; k++) {
      for(i = 0; i < num; i++) {
        for(j = 0; j < num; j++) {
          if(i == j) continue;
          distIK = adjacent[boxSize * i + k];
          distKJ = adjacent[boxSize * k + j];
          if(adjacent[boxSize * i + j] > distIK + distKJ) {
            adjacent[boxSize * i + j] = Math.min(255, distIK + distKJ);
            itinerary[boxSize * i + j] = itinerary[boxSize * i + k];
          }
        }
      }
    }

    return itinerary;
  };

  // Recompute BOXM from the current box flags. Scripts call this (via
  // matrixOps) after opening a door or otherwise changing what is walkable.
  s.createBoxMatrix = function() {
    var t = this, num = t.getNumBoxes(), boxSize = 64,
        itinerary = t.calcItineraryMatrix(num),
        matrix = [], i, j, itin;

    for(i = 0; i < num; i++) {
      matrix.push(0xFF);
      for(j = 0; j < num; j++) {
        itin = itinerary[boxSize * i + j];
        if(itin != kInvalidBox) {
          matrix.push(j);
          while(j < num - 1 && itin == itinerary[boxSize * i + (j + 1)]) j++;
          matrix.push(j);
          matrix.push(itin);
        }
      }
    }
    matrix.push(0xFF);

    t._boxMatrix = matrix;
  };

}());
