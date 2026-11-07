(function(){
  ScummVM.system = {
    new_dir_table: [ 270, 90, 180, 0 ],
    Point: function(x, y) {
      return {x: x, y: y};
    },
    clone: function(obj) {
      var clone = {};
      clone.prototype = obj.prototype;
      for (property in obj) clone[property] = obj[property];
      return clone;
    },
    getMillis: function() {
      d = new Date();
      return d.getTime();
    },
    // The game's files, read out of its archive already (feed.js)
    loadGameFiles: function(game, file_nos, callback) {
      var src = ScummVM.source, i;
      if(!src || src.game != game) {
        error("no files for " + game + ": it has not been fetched from the feed");
        return;
      }
      // the old games' files, one per room (00.LFL, 01.LFL...), by name;
      // the index first, as file 0
      if(src.names) {
        src.names.forEach(function(name, i) {
          ScummVM.engine.setFile(i, name, src.files[name],
            typeof src.encByte == "function" ? src.encByte(name) : src.encByte);
        });
        if(callback) callback();
        return;
      }
      for(i = 0; i < file_nos.length; i++)
        ScummVM.engine.setFile(file_nos[i], game + ".00" + file_nos[i], src.files[file_nos[i]]);
      if(callback) callback();
    },
    xorString: function(str, encByte) {
      stream = new ScummVM.Stream(str, "", str.length);
      stream.encByte = encByte;
      return stream.readString(str.length);
    },
    MKID_BE: function(id) {
      s = new ScummVM.Stream(id, "", 4);
      return s.readUI32(true);
    },
    reverse_MKID: function(value) {
      var isNegative, orig_value, i, Rem, s = "";
      isNegative = (value < 0);
      if (isNegative) {
        value = value * (0 - 1);
      }
      orig_value = value;
      for (i = 0; i < 4; i++) {
        Rem = value % 256;
        if (isNegative) {
          Rem = 255 - Rem;
        }
        s = String.fromCharCode(Rem) + s;
        value = Math.floor(value / 256);
      }
      if (value > 0) {
        throw ("Argument out of range: " + orig_value);
      }
      return s;
    },
    newDirToOldDir: function(dir) {
      if(dir >= 71 && dir <= 109) return 1;
      if(dir >= 109 && dir <= 251) return 2;
      if(dir >= 251 && dir <= 289) return 0;
      return 3;
    },
    oldDirToNewDir: function(dir) {
      return this.new_dir_table[dir];
    },
    toSimpleDir: function(dir) {
      var directions = [ 22, 72, 107, 157, 202, 252, 287, 337];
      for(var i = 0; i < 7; i++) {
        if(dir >= directions[i] && dir <= directions[i+1])
            return i+1;
      }
      return 0;
    },
    normalizeAngle: function(angle) {
      var temp = (angle + 360) % 360;
      return this.toSimpleDir(temp) * 45;
    }
  };
}());
