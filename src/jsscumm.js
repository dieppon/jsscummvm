var ScummVM = {
  width: 320,
  height: 200,
  // The engine always renders at the logical 320x200 above; `scale` only
  // enlarges the visible canvas. Set it to 1 for the previous behaviour.
  scale: 2,
  engines: {},
  engine: null,
  canvas: null,
  context: null,
  debugLevel: 3
};

function log(message) {
  // window.console.log(message);
  $("#console").prepend(message+"<br />");
}

function debug(level, message) {
  if(level <= ScummVM.debugLevel)
    log(message);
}

function error(message) {
  log("ERROR "+message);
}

function assert(condition) {
  if(!condition) {
    log("ASSERTION FAILED!");
  }
}

(function(){
  var canvas = document.getElementById("jsscummvm");
  ScummVM.load = function(game) {
    var t = ScummVM;
    t.canvas = canvas;
    t.init_graphics();
    t.engine = ScummVM.engines.SCUMM;
    t.engine.init(game);
    t.engine.go();
  };
  ScummVM.init_graphics = function() {
    var t = this;

    // Everything in the engine draws through t.context at 320x200. Point it
    // at an offscreen buffer of exactly that size and blow the buffer up to
    // the visible canvas in present(), so the canvas can be as large as we
    // like without the engine ever knowing about it.
    t.buffer = document.createElement("canvas");
    t.buffer.width = t.width;
    t.buffer.height = t.height;
    t.context = t.buffer.getContext('2d');

    t.canvas.width = t.width * t.scale;
    t.canvas.height = t.height * t.scale;
    t.displayContext = t.canvas.getContext('2d');
    // Nearest-neighbour, so upscaled pixel art stays crisp rather than blurry.
    t.displayContext.imageSmoothingEnabled = false;
    t.displayContext.mozImageSmoothingEnabled = false;
    t.displayContext.webkitImageSmoothingEnabled = false;
    t.displayContext.msImageSmoothingEnabled = false;

    t.context.fillRect(0,0,t.width,t.height);
    t.present();
  };

  ScummVM.present = function() {
    var t = this;
    t.displayContext.drawImage(t.buffer,
      0, 0, t.width, t.height,
      0, 0, t.canvas.width, t.canvas.height);
  };

  window.document.addEventListener("keypress", function(e) {
    var c = String.fromCharCode(e.keyCode)
    ScummVM.engine._lastKeyHit = "ESC";
    return true;
  });

}());
