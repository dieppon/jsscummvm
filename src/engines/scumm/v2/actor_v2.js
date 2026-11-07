/*
 * Actors of SCUMM v1/v2, ported from ScummVM's actor.cpp (Actor_v2 and
 * the parts of Actor_v3 it inherits).
 *
 * A v2 actor's position is in coarse units: x in 8-pixel columns, y in
 * 2-pixel rows, as the walk boxes are; getPos() gives pixels. It walks a
 * step of one unit at a time, along the box matrix, and turns before it
 * sets off.
 */
(function() {
  "use strict";

  var s = ScummVM.engines.SCUMM, _system = ScummVM.system;

  var kBoxPlayerOnly = 0x20, kBoxLocked = 0x40, kBoxInvisible = 0x80;
  // actor.h MoveFlags, as costume.js has them
  var MF_NEW_LEG = 1, MF_IN_LEG = 2, MF_TURN = 4, MF_LAST_LEG = 8;

  // actor.cpp checkXYInBoxBounds (the v2 one): the point in the box nearest
  // (x, y), found the way the original did, and a rough distance to it
  function boxDistance(boxnum, x, y) {
    var box = s.getBoxCoordinates(boxnum), xmin, xmax, destX = x, destY, ul, ll, ur, lr, top, bottom, cury,
        xDist, yDist, guard = 0;
    if (!box) return {dist: 0xFFFF, x: x, y: y};
    if (y < box.ul.y) {
      destY = box.ul.y;
      xmin = box.ul.x;
      xmax = box.ur.x;
    } else if (y >= box.ll.y) {
      destY = box.ll.y;
      xmin = box.ll.x;
      xmax = box.lr.x;
    } else if (x >= box.ul.x && x >= box.ll.x && x < box.ur.x && x < box.lr.x) {
      destX = x;
      destY = y;
      xmin = xmax = x;
    } else {
      destY = y;
      ul = box.ul.x; ll = box.ll.x; ur = box.ur.x; lr = box.lr.x;
      top = box.ul.y; bottom = box.ll.y;
      do {
        xmin = (ul + ll) >> 1;
        xmax = (ur + lr) >> 1;
        cury = (top + bottom) >> 1;
        if (cury < y) {
          top = cury; ul = xmin; ur = xmax;
        } else if (cury > y) {
          bottom = cury; ll = xmin; lr = xmax;
        }
      } while (cury != y && ++guard < 64);
    }
    if (x < xmin) destX = xmin;
    else if (x > xmax) destX = xmax;
    else destX = x;
    xDist = Math.abs(x - destX);
    yDist = Math.floor(Math.abs(y - destY) / 4);
    return {dist: xDist < yDist ? (xDist >> 1) + yDist : (yDist >> 1) + xDist, x: destX, y: destY};
  }

  var remapTable1 = [
    0x04, 0x01, 0x02, 0x00, 0x01, 0x02, 0x03, 0x00, 0x06, 0x01, 0x03, 0x00, 0x01, 0x02, 0x03, 0x00,
    0x07, 0x00, 0x03, 0x00, 0x01, 0x02, 0x03, 0x00, 0x05, 0x00, 0x02, 0x00, 0x01, 0x02, 0x03, 0x00];
  var remapTable2 = [
    0x00, 0x01, 0x03, 0x02, 0x03, 0x00, 0x02, 0x00, 0x00, 0x01, 0x03, 0x02, 0x01, 0x03, 0x01, 0x02,
    0x00, 0x01, 0x03, 0x02, 0x01, 0x00, 0x02, 0x02, 0x00, 0x01, 0x03, 0x02, 0x03, 0x03, 0x01, 0x01];
  var remapTable3 = [
    0x00, 0x00, 0x02, 0x00, 0x01, 0x03, 0x02, 0x00, 0x01, 0x01, 0x02, 0x00, 0x01, 0x03, 0x02, 0x00,
    0x02, 0x01, 0x02, 0x00, 0x01, 0x03, 0x02, 0x00, 0x03, 0x00, 0x03, 0x00, 0x01, 0x03, 0x02, 0x00];

  s.defineVersion("2", {
    // called on each new actor (costume.js): v2's walking in place of v5's
    versionActor: function(t) {
      var baseInit = t.initActor;

      t.initActor = function(mode) {
        baseInit(mode);
        if (mode == -1) {
          t.stepX = 1;
          t.stepThreshold = 0;
        }
        t.speedx = 1;
        t.speedy = 1;
        t.initFrame = 2;
        t.walkFrame = 0;
        t.standFrame = 1;
        t.talkStartFrame = 5;
        t.talkStopFrame = 4;
      };

      t.getPos = function() {
        return {x: t.pos.x * 8, y: t.pos.y * 2};
      };

      t.isPlayer = function() {
        return s._scummVars[42] <= t.number && t.number <= s._scummVars[43];
      };

      // the box nearest the point; a box only the player may use, or an
      // invisible one, is skipped for others
      t.adjustXYToBeInBox = function(dstX, dstY) {
        var abr = {x: dstX, y: dstY, box: s.kInvalidBox}, n = s.getNumBoxes() - 1, best = 0xFF,
            i, box, flags, r;
        for (i = 0; i <= n; i++) {
          box = n - i;
          flags = s.getBoxFlags(box);
          if ((flags & kBoxInvisible) && !((flags & kBoxPlayerOnly) && !t.isPlayer())) continue;
          r = boxDistance(box, dstX, dstY);
          if (r.dist == 0) {
            abr.x = r.x; abr.y = r.y; abr.box = box;
            break;
          }
          if (r.dist < best) {
            best = r.dist;
            abr.x = r.x; abr.y = r.y; abr.box = box;
          }
        }
        return abr;
      };

      t.startWalkActor = function(destX, destY, dir) {
        var abr;
        if (!t.isInCurrentRoom()) {
          t.pos.x = destX;
          t.pos.y = destY;
          if (!t.ignoreTurns && dir != -1) t.facing = dir;
          return;
        }
        abr = t.adjustXYToBeInBox(destX, destY);
        if (t.pos.x == abr.x && t.pos.y == abr.y && (dir == -1 || t.facing == dir)) return;
        t.walkdata.dest = _system.Point(abr.x, abr.y);
        t.walkdata.destbox = abr.box;
        t.walkdata.destdir = dir;
        t.walkdata.point3 = _system.Point(32000, 0);
        t.walkdata.curbox = t.walkbox;
        t.moving = (t.moving & ~MF_LAST_LEG) | MF_IN_LEG | MF_NEW_LEG;
      };

      // Actor_v3::calcMovementFactor, as v2 has it
      t.calcMovementFactor = function(next) {
        var diffX, diffY, dx, dy, wd = t.walkdata;
        if (t.pos.x == next.x && t.pos.y == next.y) {
          t.moving |= MF_IN_LEG;
          return 0;
        }
        diffX = next.x - t.pos.x;
        diffY = next.y - t.pos.y;
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
        t.targetFacing = _system.oldDirToNewDir(Math.abs(diffY) > Math.abs(diffX) ?
          3 - (diffY >= 0 ? 1 : 0) : (diffX >= 0 ? 1 : 0));
        t.moving &= ~MF_IN_LEG;
        if (t.facing != t.targetFacing) t.moving |= MF_TURN;
        if (t.walkFrame != t.frame || t.facing != t.targetFacing) t.startWalkAnim(1, t.facing);
        return (t.moving & MF_TURN) ? 0 : t.actorWalkStep();
      };

      t.actorWalkStep = function() {
        var wd = t.walkdata;
        t.needRedraw = true;
        if ((wd.xfrac += wd.xAdd) >= t.stepThreshold) {
          if (t.pos.x != wd.next.x) t.pos.x += wd.deltaXFactor;
          wd.xfrac -= t.stepThreshold;
        }
        if ((wd.yfrac += wd.yAdd) >= t.stepThreshold) {
          if (t.pos.y != wd.next.y) t.pos.y += wd.deltaYFactor;
          wd.yfrac -= t.stepThreshold;
        }
        if (t.pos.x == wd.next.x && t.pos.y == wd.next.y) t.moving |= MF_IN_LEG;
        return 0;
      };

      t.walkActor = function() {
        var newDir, nextBox, flags, found, tmp, wd = t.walkdata, cur;
        if (t.moving & MF_TURN) {
          newDir = t.updateActorDirection(false);
          if (t.targetFacing == newDir) t.moving &= ~MF_TURN;
          t.setDirection(newDir);
          return;
        }
        if (!(t.moving & MF_NEW_LEG)) return;
        if (!(t.moving & MF_IN_LEG)) {
          t.actorWalkStep();
          return;
        }
        if (t.moving & MF_LAST_LEG) {
          t.moving = MF_TURN;
          t.startAnimActor(t.standFrame);
          if (wd.destdir != -1) t.turnToDirection(wd.destdir);
          return;
        }
        t.setBox(wd.curbox);
        if (t.walkbox == wd.destbox) {
          found = _system.Point(wd.dest.x, wd.dest.y);
          t.moving |= MF_LAST_LEG;
        } else {
          nextBox = s.getNextBox(t.walkbox, wd.destbox);
          if (nextBox < 0) {
            t.moving |= MF_LAST_LEG;
            return;
          }
          flags = s.getBoxFlags(nextBox);
          if ((flags & kBoxLocked) && !((flags & kBoxPlayerOnly) && !t.isPlayer())) {
            t.moving |= MF_LAST_LEG;
            wd.destdir = -1;
          }
          wd.curbox = nextBox;
          cur = s.getClosestPtOnBox(s.getBoxCoordinates(wd.curbox), t.pos.x, t.pos.y);
          tmp = s.getClosestPtOnBox(s.getBoxCoordinates(t.walkbox), cur.x, cur.y);
          found = _system.Point(tmp.x, tmp.y);
        }
        t.calcMovementFactor(found);
      };

      // Actor_v2::remapDirection: how the box's flags bend the way an actor
      // faces
      t.remapDirection = function(dir) {
        var old = _system.newDirToOldDir(dir), boxFlags = s.getBoxFlags(t.walkbox) & 7;
        if (t.moving & ~MF_TURN)
          t.targetFacing = _system.oldDirToNewDir(remapTable2[old * 8 + remapTable1[(t.walkdata.facing || 0) * 8 + boxFlags]]);
        else
          t.targetFacing = _system.oldDirToNewDir(remapTable3[old * 8 + boxFlags]);
        return t.targetFacing | 0x400;
      };

      // v1/v2 have no scaling
      t.setupActorScale = function() {
        t.scalex = t.scaley = 0xFF;
      };
    }
  });
}());
