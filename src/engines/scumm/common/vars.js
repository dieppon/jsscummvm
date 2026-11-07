/*
 * The game variables, ported from ScummVM's engines/scumm/vars.cpp: which
 * variable number means what in a v5 game, and what they start at.
 */
(function() {
  var s = ScummVM.engines.SCUMM;

  s.setupScummVars = function() {
    var t = this;
    t._vars = {
      keypress: 0,
      ego: 1,
      camera_pos_x: 2,
      have_msg: 3,
      room: 4,
      override: 5,
      machine_speed: 6,
      num_actor: 8,
      current_lights: 9,
      currentdrive: 10,
      tmr_1: 11,
      tmr_2: 12,
      tmr_3: 13,
      music_timer: 14,
      actor_range_min: 15,
      actor_range_max: 16,
      camera_min_x: 17,
      camera_max_x: 18,
      timer_next: 19,
      virt_mouse_x: 20,
      virt_mouse_y: 21,
      room_resource: 22,
      last_sound: 23,
      cutsceneexit_key: 24,
      talk_actor: 25,
      camera_fast_x: 26,
      scroll_script: 27,
      entry_script: 28,
      entry_script2: 29,
      exit_script: 30,
      exit_script2: 31,
      verb_script: 32,
      sentence_script: 33,
      inventory_script: 34,
      cutscene_start_script: 35,
      cutscene_end_script: 36,
      charinc: 37,
      walkto_obj: 38,
      debugmode: 39,
      heapspace: 40,
      restart_key: 42,
      pause_key: 43,
      mouse_x: 44,
      mouse_y: 45,
      timer: 46,
      timer_total: 47,
      soundcard: 48,
      videomode: 49,
      mainmenu_key: 50,
      fixeddisk: 51,
      cursorstate: 52,
      userput: 53,
      talk_string_y: 54,
      soundresult: 56,
      talkstop_key: 57,
      fade_delay: 59,
      nosubtitles: 60,
      soundparam: 64,
      soundparam2: 65,
      soundparam3: 66,
      inputmode: 67,
      memory_performance: 68,
      video_performance: 69,
      room_flag: 70,
      game_loaded: 71,
      new_room: 72
    };
  };

  s.resetScummVars = function() {
    var t = this,
        vm = t._vm;

    vm.numNestedScripts = 0;
    t._currentScript = 0xFF;
    t._currentRoom = 0;
    t.scummVar("talk_string_y", -0x50);
    t.scummVar("videomode", 19);
    t.scummVar("soundcard", 3);     // AdLib -- what the sound we play will be
    t.scummVar("heapspace", 1400);
    t.scummVar("fixeddisk", 1);
    t.scummVar("inputmode", 3);
    // vars.cpp: actors use their own colours and the room lights are on.
    // Left at 0, Monkey Island thinks every room is dark ("It's too dark to
    // see it").
    t.scummVar("current_lights", 1 | 2 | 8);

    t.scummVar("debugmode", t._debugMode);
    t.scummVar("fade_delay", 3);
    t.scummVar("charinc", 4);

    t.setTalkingActor(0);

    // Setup Light
    t._scummVars[74] = 1225; // Monkey1 specific
  };

}());
