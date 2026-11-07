/*
 * How actors walk in SCUMM v3, ported from ScummVM's actor.cpp (Actor_v3:
 * walkActor, actorWalkStep, calcMovementFactor) and boxes.cpp
 * (findPathTowardsOld, getGates). From box to box an actor heads through
 * the "gate" between them -- the corridor two lines from corner to nearest
 * point make -- in steps of a whole pixel or so, not v5's fractions.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM, _system = ScummVM.system;
  var MF_NEW_LEG = 1, MF_IN_LEG = 2, MF_TURN = 4, MF_LAST_LEG = 8;

  function compareSlope(p1, p2, p3) {
    return (p2.y - p1.y) * (p3.x - p1.x) <= (p3.y - p1.y) * (p2.x - p1.x);
  }

  // boxes.cpp getGates
  function getGates(box1, box2) {
    var corner = [box1.ul, box1.ur, box1.lr, box1.ll, box2.ul, box2.ur, box2.lr, box2.ll],
        dist = [], closest = [], minDist = [], onBox2 = [], point = [], i, j, r, line1, line2, gateA, gateB;
    for (i = 0; i < 8; i++) {
      r = s.getClosestPtOnBox(i < 4 ? box2 : box1, corner[i].x, corner[i].y);
      dist[i] = r.dist;
      point[i] = {x: r.x, y: r.y};
    }
    for (j = 0; j < 3; j++) {
      minDist[j] = 0xFFFF;
      for (i = 0; i < 8; i++) {
        if (dist[i] < minDist[j]) {
          minDist[j] = dist[i];
          closest[j] = i;
        }
      }
      dist[closest[j]] = 0xFFFF;
      minDist[j] = Math.floor(Math.sqrt(minDist[j]));
      onBox2[j] = closest[j] > 3;
    }
    if (onBox2[0] == onBox2[1] && Math.abs(minDist[0] - minDist[1]) < 4) { line1 = closest[0]; line2 = closest[1]; }
    else if (onBox2[0] == onBox2[1] && minDist[0] == minDist[1]) { line1 = closest[0]; line2 = closest[1]; }
    else if (onBox2[0] == onBox2[2] && minDist[0] == minDist[2]) { line1 = closest[0]; line2 = closest[2]; }
    else if (onBox2[1] == onBox2[2] && minDist[1] == minDist[2]) { line1 = closest[1]; line2 = closest[2]; }
    else if (onBox2[0] == onBox2[2] && Math.abs(minDist[0] - minDist[2]) < 4) { line1 = closest[0]; line2 = closest[2]; }
    else if (Math.abs(minDist[0] - minDist[2]) < 4) { line1 = closest[1]; line2 = closest[2]; }
    else if (Math.abs(minDist[0] - minDist[1]) < 4) { line1 = closest[0]; line2 = closest[1]; }
    else { line1 = closest[0]; line2 = closest[0]; }
    gateA = line1 < 4 ? [corner[line1], point[line1]] : [point[line1], corner[line1]];
    gateB = line2 < 4 ? [corner[line2], point[line2]] : [point[line2], corner[line2]];
    return {a: gateA, b: gateB};
  }

  s.defineVersion("3", {
    versionActor: function(t) {
      var baseInit = t.initActor;
      t.initActor = function(mode) {
        baseInit(mode);
        if (mode == -1) {
          t.stepX = 1;
          t.stepThreshold = 0;
        }
      };

      // boxes.cpp findPathTowardsOld: where to aim -- p2 to get into the
      // gate, p3 through it; neither when the way to the end is clear
      t.findPathTowardsOld = function(box1, box2, finalBox) {
        var g = getGates(s.getBoxCoordinates(box1), s.getBoxCoordinates(box2)), pos = t.pos,
            dest = t.walkdata.dest, p2 = {x: 32000, y: 0}, p3 = {x: 32000, y: 0};
        if (box2 == finalBox &&
            compareSlope(pos, dest, g.a[0]) != compareSlope(pos, dest, g.b[0]) &&
            compareSlope(pos, dest, g.a[1]) != compareSlope(pos, dest, g.b[1]))
          return {p2: p2, p3: p3};
        p3 = s.closestPtOnLine(g.a[1], g.b[1], pos);
        if (compareSlope(pos, p3, g.a[0]) == compareSlope(pos, p3, g.b[0]))
          p2 = s.closestPtOnLine(g.a[0], g.b[0], pos);
        return {p2: p2, p3: p3};
      };

      t.calcMovementFactor = function(next) {
        var diffX, diffY, dx, dy, wd = t.walkdata;
        if (t.pos.x == next.x && t.pos.y == next.y) return 0;
        diffX = next.x - t.pos.x;
        diffY = next.y - t.pos.y;
        if (!(t.moving & MF_LAST_LEG) && t.speedx > Math.abs(diffX) && t.speedy > Math.abs(diffY)) return 0;
        t.stepX = (Math.trunc(Math.abs(diffY) / t.speedy) >> 1) > Math.trunc(Math.abs(diffX) / t.speedx) ?
          t.speedy + 1 : t.speedx;
        t.stepThreshold = Math.max(Math.trunc(Math.abs(diffY) / t.speedy), Math.trunc(Math.abs(diffX) / t.stepX));
        dx = diffX < 0 ? -t.stepX : t.stepX;
        dy = diffY < 0 ? -t.speedy : t.speedy;
        wd.xfrac = wd.xAdd = dx ? Math.trunc(diffX / dx) : 0;
        wd.yfrac = wd.yAdd = dy ? Math.trunc(diffY / dy) : 0;
        wd.cur = _system.Point(t.pos.x, t.pos.y);
        wd.next = _system.Point(next.x, next.y);
        wd.deltaXFactor = dx;
        wd.deltaYFactor = dy;
        wd.facing = diffX >= 0 ? (diffY >= 0 ? 1 : 0) : (diffY >= 0 ? 2 : 3);
        t.targetFacing = _system.oldDirToNewDir(Math.abs(diffY) * 3 > Math.abs(diffX) ?
          3 - (diffY >= 0 ? 1 : 0) : (diffX >= 0 ? 1 : 0));
        return t.actorWalkStep();
      };

      t.actorWalkStep = function() {
        var wd = t.walkdata, nextFacing;
        t.needRedraw = true;
        nextFacing = t.updateActorDirection(true);
        if (!(t.moving & MF_IN_LEG) || t.facing != nextFacing) {
          if (t.walkFrame != t.frame || t.facing != nextFacing) t.startWalkAnim(1, nextFacing);
          t.moving |= MF_IN_LEG;
          return 1;
        }
        if (wd.next.x - t.stepX <= t.pos.x && wd.next.x + t.stepX >= t.pos.x) t.pos.x = wd.next.x;
        if (wd.next.y - t.speedy <= t.pos.y && wd.next.y + t.speedy >= t.pos.y) t.pos.y = wd.next.y;
        if (t.walkbox != wd.curbox && s.checkXYInBoxBounds(wd.curbox, t.pos.x, t.pos.y)) t.setBox(wd.curbox);
        if (t.pos.x == wd.next.x && t.pos.y == wd.next.y) {
          t.moving &= ~MF_IN_LEG;
          return 0;
        }
        if ((wd.xfrac += wd.xAdd) >= t.stepThreshold) {
          if (t.pos.x != wd.next.x) t.pos.x += wd.deltaXFactor;
          wd.xfrac -= t.stepThreshold;
        }
        if ((wd.yfrac += wd.yAdd) >= t.stepThreshold) {
          if (t.pos.y != wd.next.y) t.pos.y += wd.deltaYFactor;
          wd.yfrac -= t.stepThreshold;
        }
        return 1;
      };

      t.walkActor = function() {
        var wd = t.walkdata, newDir, nextBox, path;
        if (!t.moving) return;
        if (!(t.moving & MF_NEW_LEG)) {
          if ((t.moving & MF_IN_LEG) && t.actorWalkStep()) return;
          if (t.moving & MF_LAST_LEG) {
            t.moving = 0;
            t.startAnimActor(t.standFrame);
            if (t.targetFacing != wd.destdir) t.turnToDirection(wd.destdir);
            return;
          }
          if (t.moving & MF_TURN) {
            newDir = t.updateActorDirection(false);
            if (t.facing != newDir) t.setDirection(newDir);
            else t.moving = 0;
            return;
          }
          if (wd.point3.x != 32000) {
            if (t.calcMovementFactor(wd.point3)) {
              wd.point3 = _system.Point(32000, 0);
              return;
            }
            wd.point3 = _system.Point(32000, 0);
          }
          t.setBox(wd.curbox);
          t.moving &= MF_IN_LEG;
        }
        t.moving &= ~MF_NEW_LEG;
        for (;;) {
          if (s.isInvalidBox(t.walkbox)) {
            t.setBox(wd.destbox);
            wd.curbox = wd.destbox;
            break;
          }
          if (t.walkbox == wd.destbox) break;
          nextBox = s.getNextBox(t.walkbox, wd.destbox);
          if (nextBox < 0) {
            t.moving |= MF_LAST_LEG;
            return;
          }
          wd.curbox = nextBox;
          path = t.findPathTowardsOld(t.walkbox, nextBox, wd.destbox);
          if (path.p2.x == 32000 && path.p3.x == 32000) break;
          if (path.p2.x != 32000 && t.calcMovementFactor(path.p2)) {
            wd.point3 = _system.Point(path.p3.x, path.p3.y);
            return;
          }
          if (t.calcMovementFactor(path.p3)) return;
          t.setBox(wd.curbox);
        }
        t.moving |= MF_LAST_LEG;
        t.calcMovementFactor(wd.dest);
      };
    }
  });
}());
