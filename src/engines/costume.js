(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  var MF_NEW_LEG = 1, MF_IN_LEG = 2, MF_TURN = 4, MF_LAST_LEG = 8, MF_FROZEN = 0x80;
  // boxes.h
  var kBoxXFlip = 0x08, kBoxYFlip = 0x10, kBoxIgnoreScale = 0x20,
      kBoxPlayerOnly = 0x20, kBoxLocked = 0x40, kBoxInvisible = 0x80;
  var actorTurnInterpolateTable = [0, 2, 2, 3, 2, 1, 2, 3, 0, 1, 2, 1, 0, 1, 0, 3];
  var kObjectClassNeverClip = 20, kObjectClassAlwaysClip = 21, kObjectClassIgoreBoxes = 22, kObjectClassYFlip = 29, kObjectClassXFlip = 30, kObjectClassPlayer = 31, kObjectClassUntoucable = 32;

  var scale_table = [
    0xFF, 0xFD, 0x7D, 0xBD, 0x3D, 0xDD, 0x5D, 0x9D,
    0x1D, 0xED, 0x6D, 0xAD, 0x2D, 0xCD, 0x4D, 0x8D,
    0x0D, 0xF5, 0x75, 0xB5, 0x35, 0xD5, 0x55, 0x95,
    0x15, 0xE5, 0x65, 0xA5, 0x25, 0xC5, 0x45, 0x85,
    0x05, 0xF9, 0x79, 0xB9, 0x39, 0xD9, 0x59, 0x99,
    0x19, 0xE9, 0x69, 0xA9, 0x29, 0xC9, 0x49, 0x89,
    0x09, 0xF1, 0x71, 0xB1, 0x31, 0xD1, 0x51, 0x91,
    0x11, 0xE1, 0x61, 0xA1, 0x21, 0xC1, 0x41, 0x81,
    0x01, 0xFB, 0x7B, 0xBB, 0x3B, 0xDB, 0x5B, 0x9B,
    0x1B, 0xEB, 0x6B, 0xAB, 0x2B, 0xCB, 0x4B, 0x8B,
    0x0B, 0xF3, 0x73, 0xB3, 0x33, 0xD3, 0x53, 0x93,
    0x13, 0xE3, 0x63, 0xA3, 0x23, 0xC3, 0x43, 0x83,
    0x03, 0xF7, 0x77, 0xB7, 0x37, 0xD7, 0x57, 0x97,
    0x17, 0xE7, 0x67, 0xA7, 0x27, 0xC7, 0x47, 0x87,
    0x07, 0xEF, 0x6F, 0xAF, 0x2F, 0xCF, 0x4F, 0x8F,
    0x0F, 0xDF, 0x5F, 0x9F, 0x1F, 0xBF, 0x3F, 0x7F,
    0x00, 0x80, 0x40, 0xC0, 0x20, 0xA0, 0x60, 0xE0,
    0x10, 0x90, 0x50, 0xD0, 0x30, 0xB0, 0x70, 0xF0,
    0x08, 0x88, 0x48, 0xC8, 0x28, 0xA8, 0x68, 0xE8,
    0x18, 0x98, 0x58, 0xD8, 0x38, 0xB8, 0x78, 0xF8,
    0x04, 0x84, 0x44, 0xC4, 0x24, 0xA4, 0x64, 0xE4,
    0x14, 0x94, 0x54, 0xD4, 0x34, 0xB4, 0x74, 0xF4,
    0x0C, 0x8C, 0x4C, 0xCC, 0x2C, 0xAC, 0x6C, 0xEC,
    0x1C, 0x9C, 0x5C, 0xDC, 0x3C, 0xBC, 0x7C, 0xFC,
    0x02, 0x82, 0x42, 0xC2, 0x22, 0xA2, 0x62, 0xE2,
    0x12, 0x92, 0x52, 0xD2, 0x32, 0xB2, 0x72, 0xF2,
    0x0A, 0x8A, 0x4A, 0xCA, 0x2A, 0xAA, 0x6A, 0xEA,
    0x1A, 0x9A, 0x5A, 0xDA, 0x3A, 0xBA, 0x7A, 0xFA,
    0x06, 0x86, 0x46, 0xC6, 0x26, 0xA6, 0x66, 0xE6,
    0x16, 0x96, 0x56, 0xD6, 0x36, 0xB6, 0x76, 0xF6,
    0x0E, 0x8E, 0x4E, 0xCE, 0x2E, 0xAE, 0x6E, 0xEE,
    0x1E, 0x9E, 0x5E, 0xDE, 0x3E, 0xBE, 0x7E, 0xFE
  ];
  var scaletableSize = 128;

  function revBitMask(x) {
    return (0x80 >> (x));
  }

  s.CostumeData = function() {
    var t = this;
    t.active = [];
    t.animCounter = 0;
    t.stopped = 0;
    t.curpos = [];
    t.start = [];
    t.end = [];
    t.frame = [];

    t.reset = function() {
      t.animCounter = 0;
      t.soundCounter = 0;
      t.soundPos = 0;
      t.stopped = 0;
      for(var i = 0; i < 16; i++ ) {
        t.active[i] = 0;
        t.curpos[i] = t.start[i] = t.end[i] = t.frame[i] = 0xFFFF;
      }
    };

    t.reset();
  };

  s.CostumeInfo = function(stream) {
    var t = this;
    t.width = stream.readUI16();
    t.height = stream.readUI16();
    t.rel_x = stream.readSI16();
    t.rel_y = stream.readSI16();
    t.move_x = stream.readSI16();
    t.move_y = stream.readSI16();
  };

  s.Actor = function(id) {
    var t = this;

    t.number = id;
    t.pos = _system.Point(0, 0);
    t.room = 0;
    t.top = t.bottom = 0;
    t.needRedraw = false;
    t.needBgReset = false;
    t.visible = false;
    t.moving = 0;
    t.speedx = 0;
    t.speedy = 0;
    t.frame = 0;
    t.costume = 0;
    t.facing = 180;
    t.elevation = 0;
    t.width = 24;
    t.talkColor = 15;
  t.talkPosX = 0;
    t.talkPosY = -80;
    t.boxscale = t.scaley = t.scalex = 0xFF;
    t.charset = 0;
    t.targetFacing = 0;
    t.layer = 0;
    t.animProgress = 0;
    t.animSpeed = 0;
    t.costumeNeedsInit = true;
    t.palette = [];
    t.forceClip = 0;
    for(var i = 0; i < 256; i++) {
      t.palette[i] = 0;
    }

    t.initFrame = 1;
    t.walkFrame = 2;
    t.standFrame = 3;
    t.talkStartFrame = 4;
    t.talkStopFrame = 5;

    t.walkScript = 0;
    t.talkScript = 0;

    t.cost = new s.CostumeData();

    t.initActor = function(mode) {
      if(mode == -1) { // Reset
        t.top = t.bottom = 0;
        t.needRedraw = false;
        t.needBgReset = false;
        t.costumeNeedsInit = false;
        t.visible = false;
        t.flip = false;
        t.speedx = 8;
        t.speedy = 2;
        t.frame = 0;
        t.walkbox = s.kInvalidBox;
        t.animProgress = 0;
        t.cost = new s.CostumeData();
        for(var i = 0; i < 256; i++) {
          t.palette[i] = 0;
        }
      }

      if(mode == 1 || mode == -1) {
        t.costume = 0;
        t.room = 0;
        t.pos = _system.Point(0, 0);
        t.facing = 180;
      } else if(mode == 2) {
        t.facing = 180;
      }

      t.elevation = 0;
      t.width = 24;
      t.talkColor = 15;
      t.talkPosX = 0;
      t.talkPosY = -80;
      t.boxscale = t.scaley = t.scalex = 0xFF;
      t.charset = 0;
      t.targetFacing = t.facing;
      t.layer = 0;

      t.stopActorMoving();
      t.setActorWalkSpeed(8, 2);

      t.animSpeed = 0;

      t.ignoreBoxes = false;
      t.forceClip = 0;
      t.ignoreTurns = false;

      t.talkFrequency = 256;
      t.talkPan = 64;
      t.talkVolume = 127;

      t.initFrame = 1;
      t.walkFrame = 2;
      t.standFrame = 3;
      t.talkStartFrame = 4;
      t.talkStopFrame = 5;

      t.walkScript = 0;
      t.talkScript = 0;
      t.shadow_mode = 0;
      // actor.cpp: an actor's classes are cleared with it
      s._classData[t.number] = 0;

      t.walkdata = {dest: _system.Point(0, 0), destbox: 0, destdir: 0, cur: _system.Point(0, 0), curbox: 0, next: _system.Point(0, 0), point3: _system.Point(32000, 0), deltaXFactor: 0, deltaYFactor: 0, xfrac: 0, yfrac: 0};
    };

    t.classChanged = function(cls, value) {
      if(cls == kObjectClassAlwaysClip)
        t.forceClip = value;
      if(cls == kObjectClassIgoreBoxes)
        t.ignoreBoxes = value;
    };
    // actor.cpp putActor. ScummVM overloads it: putActor() keeps position
    // and room, putActor(x, y) keeps the room. An omitted argument means
    // "keep" here -- this used `x || pos.x`, which ignored 0 and took -1
    // literally, so moving ego to another room with (-1, -1) put him at the
    // room's left edge.
    t.putActor = function(dstX, dstY, newRoom) {
      if(dstX === undefined) dstX = t.pos.x;
      if(dstY === undefined) dstY = t.pos.y;
      if(newRoom === undefined) newRoom = t.room;

      if(t.visible && s._currentRoom != newRoom && s.getTalkingActor() == t.number)
        s.stopTalk();

      t.pos.x = dstX;
      t.pos.y = dstY;
      t.room = newRoom;
      t.needRedraw = true;

      if(s.scummVar("ego") == t.number)
        s._egoPositioned = true;

      if(t.visible) {
        if(t.isInCurrentRoom()) {
          if(t.moving) {
            t.stopActorMoving();
            t.startAnimActor(t.standFrame);
          }
          t.adjustActorPos();
        } else {
          t.hideActor();
        }
      } else {
        if(t.isInCurrentRoom()) t.showActor();
      }
    };
    t.adjustActorPos = function() {
      var abr = t.adjustXYToBeInBox(t.pos.x, t.pos.y), flags;

      t.pos.x = abr.x;
      t.pos.y = abr.y;
      t.walkdata.destbox = abr.box;

      t.setBox(abr.box);

      t.walkdata.dest.x = -1;

      t.stopActorMoving();
      t.cost.soundCounter = 0;
      t.cost.soundPos = 0;

      if(!s.isInvalidBox(t.walkbox)) {
        flags = s.getBoxFlags(t.walkbox);
        if(flags & 7) t.turnToDirection(t.facing);
      }
    };
    t.isInCurrentRoom = function() {
      return t.room == s._currentRoom;
    };
    t.drawActorCostume = function(hitTestMode) {
      var bcr = s.costumeRenderer;
      if(t.costume == 0) return;
      if(!hitTestMode) {
        // TODO Don't draw actor for every frame
        // if(!t.needRedraw) return;
        t.needRedraw = false;
      }
      t.setupActorScale();
      t.prepareDrawActorCostume(bcr);
      if(bcr.drawCostume(s._virtscreens[0], s._gdi.numStrips, t, t.drawToBackBuf) & 1) {
        t.needRedraw = true;
      }
      if(!hitTestMode) {
        t.top = bcr.draw_top;
        t.bottom = bcr.draw_bottom;
        // Horizontal extent in room coordinates, for getActorFromPos -- the
        // stand-in for ScummVM's per-strip gfx usage bits. The renderer
        // draws offset by xstart & 7.
        var xs = s._virtscreens[0].xstart;
        t.drawLeft = bcr.draw_left + xs - (xs & 7);
        t.drawRight = bcr.draw_right + xs - (xs & 7);
      }
    };
    t.setupActorScale = function() {
      if(t.ignoreBoxes) return;

      t.boxscale = s.getBoxScale(t.walkbox);
      t.scalex = t.scaley = s.getScale(t.walkbox, t.pos.x, t.pos.y);
    };
    t.prepareDrawActorCostume = function(bcr) {
      bcr.actorId = t.number;
      bcr.actorX = t.pos.x - s._virtscreens[0].xstart;
      bcr.actorY = t.pos.y - t.elevation;
      bcr.scaleX = t.scalex;
      bcr.scaleY = t.scaley;
      bcr.shadow_mode = t.shadow_mode;
      bcr.setCostume(t.costume);
      bcr.setPalette(t.palette);
      bcr.setFacing(t);

      // log("drawing costume "+t.costume+" for actor "+t.number+" at "+t.pos.x+"/"+t.pos.y);

      // actor.cpp drawActorCostume: the walk box says which z-plane the actor
      // is behind. It used to be plane 1 everywhere, which hid actors
      // standing where only plane 0 applies.
      if(t.forceClip > 0)
        bcr.zbuf = t.forceClip;
      else if(s.getClass(t.number, kObjectClassNeverClip))
        bcr.zbuf = 0;
      else {
        bcr.zbuf = s.getMaskFromBox(t.walkbox);
        if(bcr.zbuf > s._gdi.numZBuffer - 1)
          bcr.zbuf = s._gdi.numZBuffer - 1;
      }

      bcr.draw_top = 0x7fffffff;
      bcr.draw_bottom = 0;
      bcr.draw_left = 0x7fffffff;
      bcr.draw_right = -0x7fffffff;
    };
    t.animateCostume = function() {
      if(t.costume == 0) return;
      t.animProgress++;
      if(t.animProgress >= t.animSpeed) {
        t.animProgress = 0;
        s.costumeLoader.loadCostume(t.costume);
        if(s.costumeLoader.increaseAnims(t)) {
          t.needRedraw = true;
        }
      }
    };
    t.animateActor = function(anim) {
      var cmd, dir;
      cmd = Math.floor(anim / 4);
      dir = _system.oldDirToNewDir(anim % 4);
      cmd = 0x3F - cmd + 2;
      switch(cmd) {
        case 2: // stop walking
          t.startAnimActor(t.standFrame);
          t.stopActorMoving();
          log("stop walking");
        break;
        case 3: // change direction immediatly
          t.moving &= ~MF_TURN;
          t.setDirection(dir);
        break;
        case 4:
          log("turn to direction");
          t.turnToDirection(dir);
        break;
        default:
          t.startAnimActor(anim);
      }
    };
    t.startAnimActor = function(f) {
      switch(f) {
        case 0x38:
          f = t.initFrame;
        break;
        case 0x39:
          f = t.walkFrame;
        break;
        case 0x3A:
          f = t.standFrame;
        break;
        case 0x3B:
          f = t.talkStartFrame;
        break;
        case 0x3C:
          f = t.talkStopFrame;
        break;
      };
      if(t.isInCurrentRoom() && t.costume != 0) {
        t.animProgress = 0;
        t.needRedraw = true;
        t.cost.animCounter = 0;
        if(f == t.initFrame) {
          t.cost.reset();
        }
        s.costumeLoader.costumeDecodeData(this, f, 0xFFFF);
        t.frame = f;
      }
    };
    // actor.cpp runActorTalkScript: v5 actors have no talk script, so this
    // just plays the talk start/stop frame -- which is what moves the mouth.
    // Without the else nobody's mouth ever moved.
    t.runActorTalkScript = function(f) {
      var args = [], i;
      if(t.talkScript) {
        for(i = 0; i < 16; i++) args[i] = 0;
        args[0] = t.number;
        args[1] = f;
        s.runScript(t.talkScript, 1, 0, args);
      } else if(t.frame != f) {
        t.startAnimActor(f);
      }
    };
    t.stopActorMoving = function() {
      t.moving = 0;
    };
    t.setActorWalkSpeed = function(newSpeedX, newSpeedY) {
      if(newSpeedX == t.speedx && newSpeedY == t.speedy) return;

      t.speedx = newSpeedX;
      t.speedy = newSpeedY;

      if(t.moving) {
        t.calcMovementFactor(t.walkdata.next);
      }
    };
    /* Ported from ScummVM's Actor::calcMovementFactor (actor.cpp). Movement
       is fixed point: deltaXFactor/deltaYFactor are 16.16 per-frame deltas,
       scaled down by the actor's own scale so distant actors step smaller. */
    t.calcMovementFactor = function(next) {
      var diffX, diffY, deltaXFactor, deltaYFactor;

      if(t.pos.x == next.x && t.pos.y == next.y) return 0;

      diffX = next.x - t.pos.x;
      diffY = next.y - t.pos.y;

      deltaYFactor = t.speedy * 65536;
      if(diffY < 0) deltaYFactor = -deltaYFactor;

      deltaXFactor = deltaYFactor * diffX;
      if(diffY != 0) deltaXFactor = (deltaXFactor / diffY) | 0;
      else deltaYFactor = 0;

      if(Math.abs((deltaXFactor / 65536) | 0) > t.speedx) {
        deltaXFactor = t.speedx * 65536;
        if(diffX < 0) deltaXFactor = -deltaXFactor;

        deltaYFactor = deltaXFactor * diffY;
        if(diffX != 0) deltaYFactor = (deltaYFactor / diffX) | 0;
        else deltaXFactor = 0;
      }

      t.walkdata.xfrac = 0;
      t.walkdata.yfrac = 0;
      t.walkdata.cur = _system.Point(t.pos.x, t.pos.y);
      t.walkdata.next = _system.Point(next.x, next.y);
      t.walkdata.deltaXFactor = deltaXFactor;
      t.walkdata.deltaYFactor = deltaYFactor;

      t.targetFacing = (Math.abs(diffY) * 3 > Math.abs(diffX))
        ? (deltaYFactor > 0 ? 180 : 0)
        : (deltaXFactor > 0 ? 90 : 270);

      return t.actorWalkStep();
    };

    t.actorWalkStep = function() {
      var nextFacing, distX, distY, tmpX, tmpY;

      t.needRedraw = true;

      nextFacing = t.updateActorDirection(true);
      if((t.walkFrame != t.frame && !(t.moving & MF_IN_LEG)) || t.facing != nextFacing)
        t.startWalkAnim(1, nextFacing);
      t.moving |= MF_IN_LEG;

      if(t.walkbox != t.walkdata.curbox &&
         s.checkXYInBoxBounds(t.walkdata.curbox, t.pos.x, t.pos.y))
        t.setBox(t.walkdata.curbox);

      distX = Math.abs(t.walkdata.next.x - t.walkdata.cur.x);
      distY = Math.abs(t.walkdata.next.y - t.walkdata.cur.y);

      if(Math.abs(t.pos.x - t.walkdata.cur.x) >= distX &&
         Math.abs(t.pos.y - t.walkdata.cur.y) >= distY) {
        t.moving &= ~MF_IN_LEG;
        return 0;
      }

      // >> 8 floors, as C's does on the negative steps
      tmpX = t.pos.x * 65536 + t.walkdata.xfrac + (t.walkdata.deltaXFactor >> 8) * t.scalex;
      t.walkdata.xfrac = tmpX & 0xFFFF;
      t.pos.x = Math.floor(tmpX / 65536);

      tmpY = t.pos.y * 65536 + t.walkdata.yfrac + (t.walkdata.deltaYFactor >> 8) * t.scaley;
      t.walkdata.yfrac = tmpY & 0xFFFF;
      t.pos.y = Math.floor(tmpY / 65536);

      if(Math.abs(t.pos.x - t.walkdata.cur.x) > distX) t.pos.x = t.walkdata.next.x;
      if(Math.abs(t.pos.y - t.walkdata.cur.y) > distY) t.pos.y = t.walkdata.next.y;

      if(t.pos.x == t.walkdata.next.x && t.pos.y == t.walkdata.next.y) {
        t.moving &= ~MF_IN_LEG;
        return 0;
      }

      return 1;
    };

    /* The next point to head for in a straight line, going from box1 to box3
       via box2. Returns true when box2 is already reachable directly.
       Ported from Actor::findPathTowards (boxes.cpp). */
    t.findPathTowards = function(box1nr, box2nr, box3nr, foundPath) {
      var box1 = s.getBoxCoordinates(box1nr),
          box2 = s.getBoxCoordinates(box2nr),
          tmp, i, j, flag, q, pos, diffX, diffY, boxDiffX, boxDiffY, v;

      if(!box1 || !box2) return false;

      for(i = 0; i < 4; i++) {
        for(j = 0; j < 4; j++) {
          // Both upper sides on one vertical line?
          if(box1.ul.x == box1.ur.x && box1.ul.x == box2.ul.x && box1.ul.x == box2.ur.x) {
            flag = 0;
            if(box1.ul.y > box1.ur.y) { v = box1.ul.y; box1.ul.y = box1.ur.y; box1.ur.y = v; flag |= 1; }
            if(box2.ul.y > box2.ur.y) { v = box2.ul.y; box2.ul.y = box2.ur.y; box2.ur.y = v; flag |= 2; }

            if(box1.ul.y > box2.ur.y || box2.ul.y > box1.ur.y ||
               ((box1.ur.y == box2.ul.y || box2.ur.y == box1.ul.y) &&
                box1.ul.y != box1.ur.y && box2.ul.y != box2.ur.y)) {
              if(flag & 1) { v = box1.ul.y; box1.ul.y = box1.ur.y; box1.ur.y = v; }
              if(flag & 2) { v = box2.ul.y; box2.ul.y = box2.ur.y; box2.ur.y = v; }
            } else {
              pos = t.pos.y;
              if(box2nr == box3nr) {
                diffX = t.walkdata.dest.x - t.pos.x;
                diffY = t.walkdata.dest.y - t.pos.y;
                boxDiffX = box1.ul.x - t.pos.x;

                if(diffX != 0) {
                  var n;
                  diffY *= boxDiffX;
                  n = (diffY / diffX) | 0;
                  if(n == 0 && (diffY <= 0 || diffX <= 0) && (diffY >= 0 || diffX >= 0))
                    n = -1;
                  pos = t.pos.y + n;
                }
              }

              q = pos;
              if(q < box2.ul.y) q = box2.ul.y;
              if(q > box2.ur.y) q = box2.ur.y;
              if(q < box1.ul.y) q = box1.ul.y;
              if(q > box1.ur.y) q = box1.ur.y;
              if(q == pos && box2nr == box3nr) return true;
              foundPath.y = q;
              foundPath.x = box1.ul.x;
              return false;
            }
          }

          // Both upper sides on one horizontal line?
          if(box1.ul.y == box1.ur.y && box1.ul.y == box2.ul.y && box1.ul.y == box2.ur.y) {
            flag = 0;
            if(box1.ul.x > box1.ur.x) { v = box1.ul.x; box1.ul.x = box1.ur.x; box1.ur.x = v; flag |= 1; }
            if(box2.ul.x > box2.ur.x) { v = box2.ul.x; box2.ul.x = box2.ur.x; box2.ur.x = v; flag |= 2; }

            if(box1.ul.x > box2.ur.x || box2.ul.x > box1.ur.x ||
               ((box1.ur.x == box2.ul.x || box2.ur.x == box1.ul.x) &&
                box1.ul.x != box1.ur.x && box2.ul.x != box2.ur.x)) {
              if(flag & 1) { v = box1.ul.x; box1.ul.x = box1.ur.x; box1.ur.x = v; }
              if(flag & 2) { v = box2.ul.x; box2.ul.x = box2.ur.x; box2.ur.x = v; }
            } else {
              if(box2nr == box3nr) {
                diffX = t.walkdata.dest.x - t.pos.x;
                diffY = t.walkdata.dest.y - t.pos.y;
                boxDiffY = box1.ul.y - t.pos.y;

                pos = t.pos.x;
                if(diffY != 0) pos += ((diffX * boxDiffY) / diffY) | 0;
              } else {
                pos = t.pos.x;
              }

              q = pos;
              if(q < box2.ul.x) q = box2.ul.x;
              if(q > box2.ur.x) q = box2.ur.x;
              if(q < box1.ul.x) q = box1.ul.x;
              if(q > box1.ur.x) q = box1.ur.x;
              if(q == pos && box2nr == box3nr) return true;
              foundPath.x = q;
              foundPath.y = box1.ul.y;
              return false;
            }
          }

          tmp = box1.ul; box1.ul = box1.ur; box1.ur = box1.lr; box1.lr = box1.ll; box1.ll = tmp;
        }
        tmp = box2.ul; box2.ul = box2.ur; box2.ur = box2.lr; box2.lr = box2.ll; box2.ll = tmp;
      }
      return false;
    };

    t.setBox = function(box) {
      t.walkbox = box;
      t.setupActorScale();
    };

    /* Ported from ScummVM's Actor::startWalkActor (actor.cpp). */
    t.startWalkActor = function(destX, destY, dir) {
      var abr = t.adjustXYToBeInBox(destX, destY);

      if(!t.isInCurrentRoom()) {
        t.pos.x = abr.x;
        t.pos.y = abr.y;
        if(!t.ignoreTurns && dir != -1) t.facing = dir;
        return;
      }

      if(t.ignoreBoxes) {
        abr.box = s.kInvalidBox;
        t.walkbox = s.kInvalidBox;
      } else {
        if(s.checkXYInBoxBounds(t.walkdata.destbox, abr.x, abr.y)) {
          abr.box = t.walkdata.destbox;
        } else {
          abr = t.adjustXYToBeInBox(abr.x, abr.y);
        }
        if(t.moving && t.walkdata.destdir == dir &&
           t.walkdata.dest.x == abr.x && t.walkdata.dest.y == abr.y)
          return;
      }

      if(t.pos.x == abr.x && t.pos.y == abr.y) {
        if(dir != t.facing) t.turnToDirection(dir);
        return;
      }

      t.walkdata.dest.x = abr.x;
      t.walkdata.dest.y = abr.y;
      t.walkdata.destbox = abr.box;
      t.walkdata.destdir = dir;
      t.walkdata.point3.x = 32000;
      t.walkdata.curbox = t.walkbox;

      t.moving = (t.moving & MF_IN_LEG) | MF_NEW_LEG;
    };

    t.startWalkAnim = function(cmd, angle) {
      if(angle == -1) angle = t.facing;

      if(t.walkScript) {
        s.runScript(t.walkScript, 1, 0, [t.number, cmd, angle]);
      } else {
        if(cmd == 3) t.turnToDirection(angle);
        else t.setDirection(angle);

        if(cmd == 1) t.startAnimActor(t.walkFrame);
        else if(cmd == 3) t.startAnimActor(t.standFrame);
      }
    };

    /* The walk state machine, ported from Actor::walkActor (actor.cpp). Each
       call advances one leg of the journey: step, or pick the next box on the
       route and start a new leg toward it. */
    t.walkActor = function() {
      var newDir, nextBox, foundPath = _system.Point(0, 0);

      if(!t.moving) return;

      if(!(t.moving & MF_NEW_LEG)) {
        if((t.moving & MF_IN_LEG) && t.actorWalkStep()) return;

        if(t.moving & MF_LAST_LEG) {
          t.moving = 0;
          t.setBox(t.walkdata.destbox);
          t.startAnimActor(t.standFrame);
          if(t.targetFacing != t.walkdata.destdir)
            t.turnToDirection(t.walkdata.destdir);
          return;
        }

        if(t.moving & MF_TURN) {
          newDir = t.updateActorDirection(false);
          if(t.facing != newDir) t.setDirection(newDir);
          else t.moving = 0;
          return;
        }

        t.setBox(t.walkdata.curbox);
        t.moving &= MF_IN_LEG;
      }

      t.moving &= ~MF_NEW_LEG;

      for(;;) {
        if(s.isInvalidBox(t.walkbox)) {
          t.setBox(t.walkdata.destbox);
          t.walkdata.curbox = t.walkdata.destbox;
          break;
        }

        if(t.walkbox == t.walkdata.destbox) break;

        nextBox = s.getNextBox(t.walkbox, t.walkdata.destbox);
        if(nextBox < 0) {
          t.walkdata.destbox = t.walkbox;
          t.moving |= MF_LAST_LEG;
          return;
        }

        t.walkdata.curbox = nextBox;

        if(t.findPathTowards(t.walkbox, nextBox, t.walkdata.destbox, foundPath)) break;
        if(t.calcMovementFactor(foundPath)) return;

        t.setBox(t.walkdata.curbox);
      }

      t.moving |= MF_LAST_LEG;
      t.calcMovementFactor(t.walkdata.dest);
    };

    t.setActorCostume = function(c) {
      var i;
      t.costumeNeedsInit = true;
      if(t.visible) {
        t.hideActor();
        t.cost.reset();
        t.costume = c;
        t.showActor();
      } else {
        t.costume = c;
        t.cost.reset();
      }

      for(i = 0; i < 32; i++) {
        t.palette[i] = 0xFF;
      }
    };
    t.setPalette = function(idx, val) {
      t.palette[idx] = val;
      t.needRedraw = true;
    };
    t.setScale = function(sx, sy) {
      if(sx != -1)
        t.scalex = sx;
      if(sy != -1)
        t.scaley = sy;
      t.needRedraw = true;
    };
    t.setDirection = function(dir) {
      var amask, i, vald;
      if(t.facing == dir) return;
      t.facing = _system.normalizeAngle(dir);
      if(t.costume == 0) return;

      amask = 0x8000;
      for(i = 0; i < 16; i++, amask >>= 1) {
        vald = t.cost.frame[i];
        if(vald == 0xFFFF) continue;
        s.costumeLoader.costumeDecodeData(this, vald, amask);
      }
      t.needRedraw = true;
    };
    t.faceToObject = function(obj) {
      var pos;

      if(!t.isInCurrentRoom()) return;
      // an actor or an inventory item is a valid thing to face too
      pos = s.getObjectOrActorXY(obj);
      if(!pos) return;
      // face whichever way the object lies, rather than always the same way
      t.turnToDirection(pos.x > t.pos.x ? 90 : 270);
    };
    t.turnToDirection = function(newdir) {
      if(newdir == -1 || t.ignoreTurns) return;

      t.targetFacing = newdir;
      // actor.cpp (v3-v6): a turn replaces whatever the actor was doing,
      // a walk included
      t.moving = MF_TURN;
    };

    /* Ported from Actor::remapDirection (actor.cpp). A box can force the
       direction an actor faces while standing on it -- that is how the game
       keeps Guybrush facing along a jetty or up a flight of stairs rather
       than straight at whatever he is walking towards. */
    t.remapDirection = function(dir, isWalking) {
      var flags, flipX, flipY;

      if(!t.ignoreBoxes) {
        flags = s.getBoxFlags(t.walkbox);

        flipX = (t.walkdata.deltaXFactor > 0);
        flipY = (t.walkdata.deltaYFactor > 0);

        if((flags & kBoxXFlip) || s.getClass(t.number, kObjectClassXFlip)) {
          dir = 360 - dir;
          flipX = !flipX;
        }
        if((flags & kBoxYFlip) || s.getClass(t.number, kObjectClassYFlip)) {
          dir = 180 - dir;
          flipY = !flipY;
        }

        switch(flags & 7) {
          case 1:
            return isWalking ? (flipX ? 90 : 270) : (dir == 90 ? 90 : 270);
          case 2:
            return isWalking ? (flipY ? 180 : 0) : (dir == 0 ? 0 : 180);
          case 3: return 270;
          case 4: return 90;
          case 5: return 0;
          case 6: return 180;
        }
      }

      dir = (dir + 360) % 360;
      // 0x400 asks updateActorDirection to interpolate rather than snap.
      return dir | 0x400;
    };

    // One step of the turn, taking the short way round, via ScummVM's
    // interpolation table (Actor::updateActorDirection).
    t.updateActorDirection = function(isWalking) {
      var dir = t.remapDirection(t.targetFacing, isWalking);

      if(dir & 0x400)
        dir = _system.oldDirToNewDir(
          actorTurnInterpolateTable[_system.newDirToOldDir(dir & 0x3FF) |
                                    (_system.newDirToOldDir(t.facing) << 2)]);

      return dir;
    };

    t.showActor = function() {
      if(s._currentRoom == 0 || t.visible) return;
      t.adjustActorPos();
      s.ensureResourceLoaded("costume", t.costume);
      if(t.costumeNeedsInit) {
        t.startAnimActor(t.initFrame);
        t.costumeNeedsInit = false;
      }
      t.stopActorMoving();
      t.visible = true;
      t.needRedraw = true;
    };
    t.hideActor = function() {
      if(!t.visible) return;
      if(t.moving) {
        t.stopActorMoving();
        t.startAnimActor(t.standFrame);
      }
      t.cost.soundCounter = 0;
      t.cost.soundPos = 0;
      t.visible = false;
      t.needRedraw = false;
      t.needBgReset = true;
    };
    /* Clamp a destination into the walkable area, and say which box it landed
       in. Ported from Actor::adjustXYToBeInBox (actor.cpp). The three passes
       widen the search: prefer a box within 30 pixels, then 80, then any.
       This is what stops actors walking through scenery. */
    t.adjustXYToBeInBox = function(dstX, dstY) {
      var thresholdTable = [30, 80, 0],
          abr = {x: dstX, y: dstY, box: s.kInvalidBox},
          tIdx, threshold, numBoxes, bestDist, bestBox, box, flags, closest,
          firstValidBox = 1;

      if(t.ignoreBoxes) return abr;

      for(tIdx = 0; tIdx < thresholdTable.length; tIdx++) {
        threshold = thresholdTable[tIdx];

        numBoxes = s.getNumBoxes() - 1;
        if(numBoxes < firstValidBox) return abr;

        bestDist = 0xFFFF;
        bestBox = s.kInvalidBox;

        for(box = numBoxes; box >= firstValidBox; box--) {
          flags = s.getBoxFlags(box);

          // Skip invisible boxes, unless they are player-only and we are one.
          if((flags & kBoxInvisible) &&
             !((flags & kBoxPlayerOnly) && !s.getClass(t.number, kObjectClassPlayer)))
            continue;

          if(threshold > 0 &&
             s.inBoxQuickReject(s.getBoxCoordinates(box), dstX, dstY, threshold))
            continue;

          if(s.checkXYInBoxBounds(box, dstX, dstY)) {
            abr.x = dstX; abr.y = dstY; abr.box = box;
            return abr;
          }

          closest = s.getClosestPtOnBox(s.getBoxCoordinates(box), dstX, dstY);

          if(closest.dist < bestDist) {
            abr.x = closest.x;
            abr.y = closest.y;

            if(closest.dist == 0) {
              abr.box = box;
              return abr;
            }
            bestDist = closest.dist;
            bestBox = box;
          }
        }

        if(threshold == 0 || threshold * threshold >= bestDist) {
          abr.box = bestBox;
          return abr;
        }
      }

      return abr;
    }

    t.initActor(-1);
  };

  s.CostumeLoader = function() {
    var t = this;
    t.baseptr = null;
    t.animCmds = [];
    t.dataOffsets = 0;
    t.palette = [];
    t.frameOffsets = 0;
    t.numColors = 0;
    t.numAnim = 0;
    t.format = 0;
    t.mirror = true;
    t.id = 0;

    t.loadCostume = function(id) {
      var ptr, i, tmp;

      t.id = id;
      ptr = s.getResourceAddress("costume", id).newRelativeStream();
      ptr.seek(2);
      t.baseptr = ptr.newRelativeStream();
      t.numAnim = ptr.seek(6).readUI8();
      tmp = ptr.readUI8();
      t.format = tmp & 0x7F;
      t.mirror = (tmp & 0x80) != 0;
      switch(t.format) {
        case 0x58:
          t.numColors = 16;
        break;
        case 0x59:
          t.numColors = 32;
        break;
        default:
          log("costume "+id+" with format 0x"+t.format.toString(16)+" is invalid");
      }

      for(i = 0; i < t.numColors; i++)
        t.palette[i] = ptr.readUI8();

      t.frameOffsets = ptr.offset;
      t.dataOffsets = ptr.offset + 32;
      t.animsOffsets = ptr.readUI16();
      t.animCmds = t.baseptr.newRelativeStream(t.animsOffsets);


      var frameOffs = t.baseptr.newRelativeStream(t.frameOffsets);
      for(i = 0; i < 16; i++) {
        var frame = t.baseptr.newRelativeStream(frameOffs.readUI16());
      }
      var animOffs = t.baseptr.newRelativeStream(t.animsOffsets);
      for(i = 0; i < t.numAnim+1; i++) {
        var offs = animOffs.readUI16();
      }
    };
    t.costumeDecodeData = function(actor, frame, usemask) {
      var baseptr, offset, anim, i = 0, j, r, tmp, mask, extra, cmd;

      t.loadCostume(actor.costume);
      anim = _system.newDirToOldDir(actor.facing) + frame * 4;

      if(anim > t.numAnim) {
        return;
      }

      baseptr = t.baseptr.newRelativeStream();
      tmp = baseptr.newRelativeStream(t.dataOffsets + anim * 2);
      offset = tmp.readUI16();
      if(offset == 0) return;
      r = baseptr.newRelativeStream(offset);

      mask = r.readUI16();
      do {
        if(mask & 0x8000) {
          j = r.readUI16();
          if(usemask & 0x8000) {
            if(j == 0xFFFF) {
              actor.cost.curpos[i] = 0xFFFF;
              actor.cost.start[i] = 0;
              actor.cost.frame[i] = frame;
            } else {
              extra = r.readUI8();
              cmd = t.animCmd(j);
              if(cmd == 0x7A) {
                actor.cost.stopped &= ~(1 << i);
              } else if(cmd == 0x79) {
                actor.cost.stopped |= (1 << i);
              } else {
                actor.cost.curpos[i] = actor.cost.start[i] = j;
                actor.cost.end[i] = j + (extra & 0x7F);
                if(extra & 0x80)
                  actor.cost.curpos[i] |= 0x8000;
                actor.cost.frame[i] = frame;
              }
            }
          } else {
            if(j != 0xFFFF)
              r.readUI8();
          }
        }
        i++;
        usemask <<= 1;
        mask <<= 1;
      } while (mask & 0xFFFF);
    };
    t.increaseAnims = function(a) {
      var i, r = 0;
      for(i = 0; i != 16; i++) {
        if(a.cost.curpos[i] != 0xFFFF)
          r += t.increaseAnim(a, i);
      }
      return r;
    };
    t.animCmd = function(i) {
      return t.animCmds.newRelativeStream(i).readUI8();
    }
    t.increaseAnim = function(a, slot) {
      var highflag, i, end, code, nc, cost = a.cost, curpos = cost.curpos[slot];

      if(curpos == 0xFFFF)
        return 0;
      highflag = curpos & 0x8000;
      i = curpos & 0x7FFF;
      end = cost.end[slot];
      code = t.animCmd(i) & 0x7F;

      do {
        if(!highflag) {
          if(i++ >= end)
            i = cost.start[slot];
        } else {
          if(i != end)
            i++;
        }
        nc = t.animCmd(i);
        if(nc == 0x7C) {
          cost.animCounter++;
          if(cost.start[slot] != end)
            continue;
        } else {
          // 0x78 marks a frame with a sound (footsteps and the like);
          // playActorSounds plays it
          if(nc == 0x78) {
            cost.soundCounter = (cost.soundCounter | 0) + 1;
            if(cost.start[slot] != end)
              continue;
          }
        }
        cost.curpos[slot] = i | highflag;
        return (t.animCmd(i) & 0x7F) != code;
      } while(1);
    };
    t.hasManyDirections = function(id) {
      return false;
    };
  };

  s.CostumeRenderer = function() {
    var t = this;
    t.loader = s.costumeLoader;
    t.actorX = t.actorY = 0;
    t.zbuf = 0;
    t.scaleX = t.scaleY = 0;
    t.scaleIndexX = t.scaleIndexY = 0;
    t.draw_top = t.draw_bottom = 0;
    t.out = t.srcptr = null;
    t.palette = [];
    t.mirror = false;

    // costume.cpp ClassicCostumeRenderer::setPalette: the actor's own
    // palette (set with actorOps) wins over the costume's, 255 meaning "keep
    // the costume colour". With the lights off actors are drawn as grey
    // silhouettes.
    t.setPalette = function(palette) {
      var i, color;
      if(s.scummVar("current_lights") & 8) {   // LIGHTMODE_actor_use_colors
        for(i = 0; i < t.loader.numColors; i++) {
          color = palette ? palette[i] : 255;
          if(color == 255 || color === undefined)
            color = t.loader.palette[i];
          t.palette[i] = color;
        }
      } else {
        for(i = 0; i < t.loader.numColors; i++)
          t.palette[i] = 8;
        t.palette[12] = 0;
      }
    };
    t.setFacing = function(actor) {
      t.mirror = _system.newDirToOldDir(actor.facing) != 0 || t.loader.mirror;
    };
    t.setCostume = function(costume, shadow) {
      t.loader.loadCostume(costume);
    };
    t.drawCostume = function(vs, numStrips, a, drawToBackBuf) {
      var i, result = 0
      t.out = _system.clone(vs);
      var dst = t.out;
      if(drawToBackBuf)
        dst.pixels = vs.getBackPixels(0, 0);
      else
        dst.pixels = vs.getPixels(0, 0);

      t.actorX += s._virtscreens[0].xstart & 7;
      dst.w = dst.pitch;
      dst.pixels.seek(-(s._virtscreens[0].xstart & 7));
      t.numStrips = numStrips;
      t.xmove = t.ymove = 0;
      for(i = 0; i < 16; i++)   // all 16 limbs, as base-costume.cpp
        result |= t.drawLimb(a, i);
      return result;
    };
    t.drawLimb = function(actor, limb) {
      var i, code, baseptr, frameptr, frameoffset, cost = actor.cost, costumeInfo, xmoveCur, ymoveCur, offset;

      if(cost.curpos[limb] == 0xFFFF || cost.stopped & (1 << limb))
        return 0;

      i = cost.curpos[limb] & 0x7FFF;
      baseptr = t.loader.baseptr.newRelativeStream();
      offset = t.loader.frameOffsets + limb * 2;
      frameoffset = baseptr.newRelativeStream(offset).readUI16();
      frameptr = baseptr.newRelativeStream(frameoffset);
      code = t.loader.animCmd(i) & 0x7F;
      if(code != 0x7B) {
        frameptr.seek(code * 2);
        offset = frameptr.readUI16();
        if(offset > baseptr.length) return 0;
        t.srcptr = baseptr.newRelativeStream(offset);
        costumeInfo = new s.CostumeInfo(t.srcptr);
        t.width = costumeInfo.width;
        t.height = costumeInfo.height;
        xmoveCur = t.xmove + costumeInfo.rel_x;
        ymoveCur = t.ymove + costumeInfo.rel_y;
        t.xmove += costumeInfo.move_x;
        t.ymove -= costumeInfo.move_y;

        return t.mainRoutine(xmoveCur, ymoveCur);
      }
      return 0;
    };

    t.mainRoutine = function(xmoveCur, ymoveCur) {
      var i, skip = 0, drawFlag = 1, use_scaling, startScaleIndexX, ex1, ex2, rect = {left: 0, right: 0, top: 0, bottom: 0}, step;
      var codec = {
        x: 0, y: 0, skip_width: 0, destptr: null, mask_ptr: null, scaleXstep: 0, mask: 0, shr: 0, repcolor: 0, replen: 0
      };
      if(t.loader.numColors == 32) {
        codec.mask = 7; codec.shr = 3;
      } else {
        codec.mask = 15; codec.shr = 4;
      }
      use_scaling = (t.scaleX != 0xFF) || (t.scaleY != 0xFF);
      codec.x = t.actorX;
      codec.y = t.actorY;

      if(use_scaling) {
        codec.scaleXstep = -1;
        if(xmoveCur < 0) {
          xmoveCur = -xmoveCur;
          codec.scaleXstep = 1;
        }
        if(t.mirror) {
          startScaleIndexX = t.scaleIndexX = scaletableSize - xmoveCur;
          for(i = 0; i < xmoveCur; i++) {
            if(scale_table[t.scaleIndexX++ & 0xFF] < t.scaleX)
              codec.x -= codec.scaleXstep;
          }

          rect.left = rect.right = codec.x;

          t.scaleIndexX = startScaleIndexX;
          for(i = 0; i < t.width; i++) {
            if(rect.right < 0) {
              skip++;
              startScaleIndexX = t.scaleIndexX;
            }
            if(scale_table[t.scaleIndexX++ & 0xFF] < t.scaleX)
              rect.right++;
          }
        } else {
          startScaleIndexX = t.scaleIndexX = xmoveCur + scaletableSize;
          for(i = 0; i < xmoveCur; i++) {
            if(scale_table[t.scaleIndexX-- & 0xFF] < t.scaleX)
              codec.x += codec.scaleXstep;
          }

          rect.left = rect.right = codec.x;

          t.scaleIndexX = startScaleIndexX;
          for(i = 0; i < t.width; i++) {
            if(rect.left >= t.out.w) {
              startScaleIndexX = t.scaleIndexX;
              skip++;
            }
            if(scale_table[t.scaleIndexX-- & 0xFF] < t.scaleX)
              rect.left--;
          }
        }

        t.scaleIndexX = startScaleIndexX;

        if(skip) skip--;

        step = -1;
        if(ymoveCur < 0) {
          ymoveCur = -ymoveCur;
          step = 1;
        }

        t.scaleIndexY = scaletableSize - ymoveCur;
        for(i = 0; i < ymoveCur; i++) {
          if(scale_table[t.scaleIndexY++ & 0xFF] < t.scaleY)
            codec.y -= step;
        }

        rect.top = rect.bottom = codec.y;
        t.scaleIndexY = scaletableSize - ymoveCur;
        for(i = 0; i < t.height; i++) {
          if(scale_table[t.scaleIndexY++ & 0xFF] < t.scaleY)
            rect.bottom++;
        }

        t.scaleIndexY = scaletableSize - ymoveCur;
      } else {
        if(!t.mirror)
          xmoveCur = -xmoveCur;
        codec.x += xmoveCur
        codec.y += ymoveCur

        if(t.mirror) {
          rect.left = codec.x;
          rect.right = codec.x + t.width;
        } else {
          rect.left = codec.x - t.width;
          rect.right = codec.x;
        }

        rect.top = codec.y;
        rect.bottom = rect.top + t.height;
      }

      codec.skip_width = t.width;
      codec.scaleXstep = t.mirror ? 1 : -1;

      // mark dirty

      if(rect.top >= t.out.h || rect.bottom <= 0) {
        return 0;
      }
      if(rect.left >= t.out.w || rect.right <= 0) {
        return 0;
      }

      codec.replen = 0;
      if(t.mirror) {
        if(!use_scaling)
          skip = -codec.x;
        if(skip > 0) {
          codec.skip_width -= skip;
          t.codec_ignorePakCols(codec, skip);
          codec.x = 0;
        } else {
          skip = rect.right - t.out.w;
          if(skip <= 0) {
            drawFlag = 2;
          } else {
            codec.skip_width -= skip;
          }
        }
      } else {
        if(!use_scaling)
          skip = rect.right - t.out.w;
        if(skip > 0) {
          codec.skip_width -= skip;
          t.codec_ignorePakCols(codec, skip);
          // drawn right to left, so it starts at the right edge
          codec.x = t.out.w - 1;
        } else {
          skip = -1 - rect.left;
          if(skip <= 0)
            drawFlag = 2;
          else
            codec.skip_width -= skip;
        }
      }

      if(codec.skip_width <= 0) {
        return 0;
      }

      if(rect.left < 0)
        rect.left = 0;
      if(rect.top < 0)
        rect.top = 0;
      if(rect.top > t.out.h)
        rect.top = t.out.h;
      if(rect.bottom > t.out.h)
        rect.bottom = t.out.h;

      if(t.draw_top > rect.top)
        t.draw_top = rect.top;
      if(t.draw_bottom < rect.bottom)
        t.draw_bottom = rect.bottom;
      if(t.draw_left > rect.left)
        t.draw_left = rect.left;
      if(t.draw_right < rect.right)
        t.draw_right = rect.right;

      if(t.height + rect.top >= 256) {
        return 2;
      }

      codec.destptr = t.out.pixels.newRelativeStream(codec.y * t.out.pitch + codec.x);

      // ScummEngine::getMaskBuffer: the mask is laid out by room strip, and
      // codec.x is screen-relative, so start from the strip the screen does
      codec.mask_ptr = s._gdi.getMaskBuffer(Math.floor(s._virtscreens[0].xstart / 8), codec.y, t.zbuf);

      t.proc3(codec);

      return drawFlag;
    };

    t.codec_ignorePakCols = function(codec, num) {
      // log("ignore "+num+" cols for actor "+t.actorId);
      num *= t.height;
      do {
        codec.replen = t.srcptr.readUI8();
        codec.repcolor = codec.replen >> codec.shr;
        codec.replen &= codec.mask;
        if(!codec.replen)
          codec.replen = t.srcptr.readUI8();
        do {
          if(!--num) return;
        } while(--codec.replen);
      } while(1);
    };

    t.proc3 = function(codec) {
      var mask, src, dst, len, maskbit, maskval, y, color, height, pcolor, scaleIndexY, masked = false, startpos = false;

      y = codec.y;
      src = t.srcptr.newRelativeStream();
      dst = codec.destptr.newRelativeStream();
      len = codec.replen;
      color = codec.repcolor;
      height = t.height;

      scaleIndexY = t.scaleIndexY;
      maskbit = revBitMask(codec.x & 7);
      mask = codec.mask_ptr.newRelativeStream(Math.floor(codec.x / 8));

      if(len > 0)
        startpos = true;

      do {
        if(!startpos) {
          len = src.readUI8();
          color = len >> codec.shr;
          len &= codec.mask;
          if(!len)
            len = src.readUI8();
        }

        do {
          if(!startpos) {
            if(t.scaleY == 255 || scale_table[scaleIndexY++ & 0xFF] < t.scaleY) {
              maskval = mask.readUI8();
              mask.seek(-1);
              masked = (y < 0 || y >= t.out.h) || (codec.x < 0 || codec.x >= t.out.w) || (codec.mask_ptr && (maskval & maskbit));
              if(codec.mask_ptr && (maskval & maskbit))
                ; //log("masked in mask");
              if(color && !masked) {
                // base-costume.cpp: colour 13 (or every colour, in shadow
                // mode 0x20) darkens what is underneath through the room's
                // shadow table
                if(t.shadow_mode & 0x20) {
                  pcolor = s._shadowPalette[dst.readUI8()];
                  dst.seek(-1);
                } else {
                  pcolor = t.palette[color];
                  if(pcolor == 13 && s._shadowPalette) {
                    pcolor = s._shadowPalette[dst.readUI8()];
                    dst.seek(-1);
                  }
                }
                dst.writeUI8(pcolor);
                dst.seek(-1);
              }
              dst.seek(t.out.pitch);
              mask.seek(t.numStrips);
              y++;
            }
            if(!--height) {
              if(!--codec.skip_width)
                return;
              height = t.height;
              y = codec.y;
              scaleIndexY = t.scaleIndexY;
              if(t.scaleX == 255 || scale_table[t.scaleIndexX & 0xFF] < t.scaleX) {
                codec.x += codec.scaleXstep;
                if(codec.x < 0 || codec.x >= t.out.w)
                  return;
                maskbit = revBitMask(codec.x & 7);
                codec.destptr.seek(codec.scaleXstep);
              }
              t.scaleIndexX += codec.scaleXstep;
              dst = codec.destptr.newRelativeStream();
              mask = codec.mask_ptr.newRelativeStream(Math.floor(codec.x / 8));
            }
          }
          startpos = false;
        } while(--len);
      } while(1);

    };

  };

  s.isValidActor = function(id) {
    var t = this;
    return id >= 0 && id < t._actors.length && t._actors[id] && t._actors[id].number == id;
  };

  s.getActor = function(id) {
    var t = this;
    if(id == 0) return null;
    if(!t.isValidActor(id)) {
      return null;
    }
    return t._actors[id];
  };

  // actor.cpp playActorSounds: the first actor in the room whose costume hit
  // a sound frame plays its sound; all the counters are then cleared
  s.playActorSounds = function() {
    var t = this, i, j, a;
    for(i = 1; i < t._nums['actors']; i++) {
      a = t._actors[i];
      if(a && a.cost && a.cost.soundCounter && a.isInCurrentRoom()) {
        t._currentScript = 0xFF;
        if(a.sound) t.startSound(a.sound);
        for(j = 1; j < t._nums['actors']; j++)
          if(t._actors[j] && t._actors[j].cost) t._actors[j].cost.soundCounter = 0;
        return;
      }
    }
  };

  s.processActors = function() {
    var t = this, i, j, numactors = 0, tmp, actor;
    for(i = 1; i < t._nums['actors']; i++) {
      if(t._actors[i] && t._actors[i].isInCurrentRoom()) {
        t._sortedActors[numactors++] = t._actors[i];
      }
    }
    if(!numactors) return;

    // Sort actors
    for(j = 0; j < numactors; ++j) {
      for(i = 0; i < numactors; ++i) {
        // actor.cpp: further down the screen is drawn later, i.e. in front.
        // The swap used to assign [i] twice, so nothing was ever reordered.
        var sc_actor1 = t._sortedActors[j].pos.y - t._sortedActors[j].layer * 2000;
        var sc_actor2 = t._sortedActors[i].pos.y - t._sortedActors[i].layer * 2000;
        if(sc_actor1 < sc_actor2) {
          tmp = t._sortedActors[i];
          t._sortedActors[i] = t._sortedActors[j];
          t._sortedActors[j] = tmp;
        }
      }
    }

    // Draw actors
    // var actors = "";
    for(i = 0; i < numactors; ++i) {
      actor = t._sortedActors[i];
      // actors += actor.number;
      // actors += " ";
      if(actor.costume) {
        actor.drawActorCostume();
        actor.animateCostume();
      }
    }
    // window.console.log(actors);
  };

  s.showActors = function() {
    var t = this, i;
    for(i = 1; i < t._actors.length; i++) {
      if(t._actors[i].isInCurrentRoom())
        t._actors[i].showActor();
    }
  };

  s.walkActors = function() {
    var t = this, i;
    for(i = 1; i < t._actors.length; i++) {
      if(t._actors[i].isInCurrentRoom())
        t._actors[i].walkActor();
    }
  };

  s.resetActorBgs = function() {
    var t = this, i, j, strip;
    for(i = 0; i < t._gdi.numStrips; i++) {
      strip = t.screenStartStrip + i;
      for(j = 1; j < t._actors.length; j++) {
        if((t._actors[j].top != 0x7fffffff && t._actors[j].needRedraw )|| t._actors[j].needBgReset) {
          if((t._actors[j].bottom - t._actors[j].top) >= 0) {
            t._gdi.resetBackground(t._actors[j].top, t._actors[j].bottom, i);
          }
        }
      }
    }
    for(j = 1; j < t._actors.length; j++) {
      t._actors[j].needBgReset = false;
    }
  }

  s.costumeLoader = new s.CostumeLoader();
  s.costumeRenderer = new s.CostumeRenderer();

}());
