/*
 * Camera, ported from ScummVM's engines/scumm/camera.cpp.
 *
 * Rooms are wider than the 320px screen, so the view scrolls. camera.cur is
 * where the view is now, camera.dest where it is heading; moveCamera() closes
 * the gap 8 pixels (one strip) a frame. In follow mode the camera watches the
 * actor and retargets itself once the actor crosses a trigger strip.
 */
(function() {
  var _system = ScummVM.system,
      s = ScummVM.engines.SCUMM;

  s.setCameraAtEx = function(at) {
    var t = this, camera = t._camera;
    camera.mode = "normal";
    camera.cur.x = at;
    t.setCameraAt(at, 0);
    camera.movingToActor = false;
    t._fullRedraw = true;
  };

  s.setCameraAt = function(pos_x, pos_y) {
    var t = this, camera = t._camera;

    // A jump of more than half a screen is a cut, not a pan, so snap even
    // while following an actor.
    if(camera.mode != "follow_actor" ||
       Math.abs(pos_x - camera.cur.x) > (t._screenWidth / 2))
      camera.cur.x = pos_x;

    camera.dest.x = pos_x;

    if(camera.cur.x < t.scummVar("camera_min_x")) camera.cur.x = t.scummVar("camera_min_x");
    if(camera.cur.x > t.scummVar("camera_max_x")) camera.cur.x = t.scummVar("camera_max_x");

    if(t.scummVar("scroll_script")) {
      t.scummVar("camera_pos_x", camera.cur.x);
      t.runScript(t.scummVar("scroll_script"), 0, 0, 0);
    }

    // Text is drawn at a fixed screen position, so scrolling has to drop it.
    if(camera.cur.x != camera.last.x && t._charsetHasMask)
      t.stopTalk();
  };

  s.setCameraFollows = function(a, setCamera) {
    var t = this, i, j, camera = t._camera;
    if(!a) return;
    camera.mode = "follow_actor";
    camera.follows = a.number;

    if(!a.isInCurrentRoom()) {
      t.startScene(a.room, 0, 0);
      camera.mode = "follow_actor";
      camera.cur.x = a.getPos().x;
      t.setCameraAt(camera.cur.x, 0);
    }

    i = Math.floor(a.getPos().x / 8) - t._screenStartStrip;

    if(i < camera.leftTrigger || i > camera.rightTrigger || setCamera == true)
      t.setCameraAt(a.getPos().x, 0);

    for(j = 1; j < t._actors.length; j++) {
      if(t._actors[j].isInCurrentRoom())
        t._actors[j].needRedraw = true;
    }
    t.runInventoryScript(0);
  };

  s.panCameraTo = function(x, y) {
    var camera = this._camera;
    camera.dest.x = x;
    camera.mode = "panning";
    camera.movingToActor = false;
  };

  /* One frame of camera movement, ported from ScummEngine::moveCamera. */
  s.moveCamera = function() {
    var t = this, camera = t._camera, pos = camera.cur.x, i, a,
        minX = t.scummVar("camera_min_x"), maxX = t.scummVar("camera_max_x"),
        snapToX = !!t.scummVar("camera_fast_x");

    // The camera only ever sits on a strip boundary.
    camera.cur.x &= 0xFFF8;

    if(camera.cur.x < minX) {
      camera.cur.x = snapToX ? minX : camera.cur.x + 8;
      t.cameraMoved();
      return;
    }

    if(camera.cur.x > maxX) {
      camera.cur.x = snapToX ? maxX : camera.cur.x - 8;
      t.cameraMoved();
      return;
    }

    if(camera.mode == "follow_actor") {
      a = t.getActor(camera.follows);
      if(a) {
        i = Math.floor(a.getPos().x / 8) - t._screenStartStrip;

        // The actor has wandered into the margin, so start chasing them.
        if(i < camera.leftTrigger || i > camera.rightTrigger) {
          if(snapToX) {
            if(i > 40 - 5) camera.dest.x = a.getPos().x + 80;
            if(i < 5)      camera.dest.x = a.getPos().x - 80;
          } else {
            camera.movingToActor = true;
          }
        }
      }
    }

    if(camera.movingToActor) {
      a = t.getActor(camera.follows);
      if(a) camera.dest.x = a.getPos().x;
    }

    if(camera.dest.x < minX) camera.dest.x = minX;
    if(camera.dest.x > maxX) camera.dest.x = maxX;

    if(snapToX) {
      camera.cur.x = camera.dest.x;
    } else {
      if(camera.cur.x < camera.dest.x) camera.cur.x += 8;
      if(camera.cur.x > camera.dest.x) camera.cur.x -= 8;
    }

    if(camera.movingToActor && a &&
       Math.floor(camera.cur.x / 8) == Math.floor(a.getPos().x / 8))
      camera.movingToActor = false;

    t.cameraMoved();

    if(t.scummVar("scroll_script") && pos != camera.cur.x) {
      t.scummVar("camera_pos_x", camera.cur.x);
      t.runScript(t.scummVar("scroll_script"), 0, 0, 0);
    }
  };

  s.cameraMoved = function() {
    var t = this, camera = t._camera, screenLeft, oldStart = t._screenStartStrip;

    if(camera.cur.x < (t._screenWidth / 2)) {
      camera.cur.x = Math.floor(t._screenWidth / 2);
    } else if(camera.cur.x > t._roomWidth - (t._screenWidth / 2)) {
      camera.cur.x = t._roomWidth - Math.floor(t._screenWidth / 2);
    }

    t._screenStartStrip = Math.floor(camera.cur.x / 8) - Math.floor(t._gdi.numStrips / 2);
    t._screenEndStrip = t._screenStartStrip + t._gdi.numStrips - 1;
    t._screenTop = camera.cur.y - Math.floor(t._screenHeight / 2);
    screenLeft = t._screenStartStrip * 8;
    t._virtscreens[0].xstart = screenLeft;

    // ScummVM repaints from redrawBGAreas by comparing camera.last; ours
    // repaints the whole strip range, so just ask for it when the view moved.
    if(t._screenStartStrip != oldStart) {
      t._bgNeedsRedraw = true;
      for(var i = 1; i < t._actors.length; i++)
        if(t._actors[i].isInCurrentRoom()) t._actors[i].needRedraw = true;
    }
    // camera.last is updated at the end of the frame (scumm.js), as in
    // scumm.cpp -- setting it here hid the move from redrawBGAreas and
    // displayDialog, so speech stayed on screen while the room scrolled
  };

  s.actorFollowCamera = function(act) {
    var t = this, camera = t._camera, old = camera.follows;
    t.setCameraFollows(t.getActor(act));
    if(camera.follows != old)
      t.runInventoryScript(0);
    camera.movingToActor = false;
  };

}());
