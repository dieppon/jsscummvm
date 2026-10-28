/*
 * The AdLib MIDI driver, ported from ScummVM's audio/adlib.cpp
 * (MidiDriver_ADLIB), OPL2 path only.
 *
 * iMUSE talks MIDI to 32 parts; the driver plays them on the chip's 9
 * voices, stealing the lowest-priority voice when it runs out. Instruments
 * are AdLibInstrument records -- two operators' register values plus two
 * "extra" envelope modulators (Struct10/11 in ScummVM) that the 250 Hz
 * timer steps to animate volume, vibrato and the like.
 */
(function(){
  var MKTAG_ADL = 0x41444C20;   // 'ADL '

  var OPERATOR1_OFFSETS = [0, 1, 2, 8, 9, 10, 16, 17, 18];
  var OPERATOR2_OFFSETS = [3, 4, 5, 11, 12, 13, 19, 20, 21];

  // registerBase, shift, mask, inversion
  var SET_PARAM_TABLE = [
    [0x40, 0, 63, 63],  // level
    [0xE0, 2, 0, 0],    // unused
    [0x40, 6, 192, 0],  // level key scaling
    [0x20, 0, 15, 0],   // modulator frequency multiple
    [0x60, 4, 240, 15], // attack rate
    [0x60, 0, 15, 15],  // decay rate
    [0x80, 4, 240, 15], // sustain level
    [0x80, 0, 15, 15],  // release rate
    [0xE0, 0, 3, 0],    // waveform select
    [0x20, 7, 128, 0],  // amp mod
    [0x20, 6, 64, 0],   // vib
    [0x20, 5, 32, 0],   // eg type
    [0x20, 4, 16, 0],   // ksr
    [0xC0, 0, 1, 0],    // decay alg
    [0xC0, 1, 14, 0]    // feedback
  ];

  var PARAM_TABLE1 = [29, 28, 27, 0, 3, 4, 7, 8, 13, 16, 17, 20, 21, 30, 31, 0];
  var MAX_VAL_TABLE = [0x2FF, 0x1F, 0x7, 0x3F, 0x0F, 0x0F, 0x0F, 0x3,
                       0x3F, 0x0F, 0x0F, 0x0F, 0x3, 0x3E, 0x1F, 0];
  var NUM_STEPS_TABLE = [1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 24, 30,
                         36, 50, 64, 82, 100, 136, 160, 192, 240, 276, 340, 460,
                         600, 860, 1200, 1600];
  var NOTE_FREQUENCIES = [
    90, 91, 92, 92, 93, 94, 94, 95, 96, 96, 97, 98, 98, 99, 100, 101,
    101, 102, 103, 104, 104, 105, 106, 107, 107, 108, 109, 110, 111, 111, 112, 113,
    114, 115, 115, 116, 117, 118, 119, 120, 121, 121, 122, 123, 124, 125, 126, 127,
    128, 129, 130, 131, 132, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142,
    143, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 157, 158, 159, 160,
    161, 162, 163, 165, 166, 167, 168, 169, 171, 172, 173, 174, 176, 177, 178, 180,
    181, 182, 184, 185, 186, 188, 189, 190, 192, 193, 194, 196, 197, 199, 200, 202,
    203, 205, 206, 208, 209, 211, 212, 214, 215, 217, 218, 220, 222, 223, 225, 226,
    228, 230, 231, 233, 235, 236, 238, 240, 242, 243, 245, 247, 249, 251, 252, 254
  ];
  var VOLUME_TABLE = [
    0, 4, 7, 11, 13, 16, 18, 20, 22, 24, 26, 27, 29, 30, 31, 33,
    34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 44, 45, 46, 47, 47,
    48, 49, 49, 50, 51, 51, 52, 53, 53, 54, 54, 55, 55, 56, 56, 57,
    57, 58, 58, 59, 59, 60, 60, 60, 61, 61, 62, 62, 62, 63, 63, 63
  ];

  // audio/adlib.cpp g_gmInstruments: the instrument each General MIDI
  // program starts with, as the 30 bytes of an AdLibInstrument
  var GM_INSTRUMENTS = [
    [194, 197, 43, 153, 88, 194, 31, 30, 200, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 35],
    [34, 83, 14, 138, 48, 20, 6, 29, 122, 92, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [6, 0, 28, 121, 64, 2, 0, 75, 121, 88, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [194, 137, 42, 137, 73, 194, 22, 28, 184, 124, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 35],
    [194, 23, 61, 106, 0, 196, 46, 45, 201, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [6, 30, 28, 153, 0, 2, 58, 76, 121, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [132, 64, 59, 90, 111, 129, 14, 59, 90, 127, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [132, 64, 59, 90, 99, 129, 0, 59, 90, 127, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [140, 128, 5, 234, 89, 130, 10, 60, 170, 100, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [133, 64, 13, 236, 113, 132, 88, 62, 203, 124, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [138, 192, 12, 220, 80, 136, 88, 61, 218, 124, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [201, 64, 43, 120, 66, 194, 4, 76, 138, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 26],
    [42, 14, 23, 137, 40, 34, 12, 27, 9, 112, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [231, 155, 8, 8, 38, 226, 6, 10, 8, 112, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [197, 5, 0, 252, 64, 132, 0, 0, 220, 80, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [134, 64, 93, 90, 65, 129, 0, 11, 90, 127, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [237, 0, 123, 200, 64, 225, 153, 74, 233, 126, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [232, 79, 58, 215, 124, 226, 151, 73, 249, 125, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 16, 47, 247, 125, 243, 69, 143, 199, 98, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 140, 159, 218, 112, 228, 80, 159, 218, 106, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 213, 157, 165, 69, 226, 63, 159, 214, 73, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [229, 15, 125, 184, 46, 162, 15, 124, 199, 97, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 42, 159, 219, 1, 225, 4, 143, 215, 98, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 136, 156, 80, 100, 226, 24, 112, 196, 124, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 163, 13, 218, 1, 194, 53, 93, 88, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24],
    [66, 85, 62, 235, 36, 212, 8, 13, 169, 113, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24],
    [194, 0, 43, 23, 81, 194, 30, 77, 151, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 25],
    [198, 1, 45, 167, 68, 194, 6, 14, 167, 121, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [194, 12, 6, 6, 85, 194, 63, 9, 134, 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10],
    [194, 46, 79, 119, 0, 196, 8, 14, 152, 89, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [194, 48, 79, 202, 1, 196, 13, 14, 184, 127, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [196, 41, 79, 202, 3, 200, 13, 12, 183, 125, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11],
    [194, 64, 60, 150, 88, 196, 222, 14, 199, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32],
    [49, 19, 45, 215, 60, 226, 24, 46, 184, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [34, 134, 13, 215, 80, 228, 24, 94, 184, 124, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
    [242, 10, 13, 215, 64, 228, 31, 94, 184, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 9, 75, 214, 72, 228, 31, 28, 184, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40],
    [98, 17, 12, 230, 60, 228, 31, 12, 200, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 18, 61, 230, 52, 228, 31, 125, 184, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 19, 61, 230, 52, 228, 31, 93, 184, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [162, 64, 93, 186, 63, 226, 0, 143, 216, 121, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 64, 61, 218, 59, 225, 0, 126, 216, 122, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [98, 0, 109, 250, 93, 226, 0, 143, 200, 121, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 0, 78, 219, 74, 227, 24, 111, 233, 126, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 0, 78, 219, 102, 226, 0, 127, 233, 126, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 15, 102, 170, 81, 2, 100, 41, 249, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [22, 74, 4, 186, 57, 194, 88, 45, 202, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
    [2, 0, 1, 122, 121, 2, 63, 40, 234, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [98, 83, 156, 186, 49, 98, 91, 173, 201, 85, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 64, 110, 218, 73, 226, 19, 143, 249, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 64, 143, 250, 80, 242, 4, 127, 250, 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 160, 206, 91, 2, 226, 50, 127, 251, 61, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [230, 128, 156, 153, 66, 226, 4, 125, 120, 96, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [234, 160, 172, 103, 2, 226, 0, 124, 122, 124, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [231, 148, 173, 183, 3, 226, 0, 124, 186, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [195, 63, 75, 233, 126, 193, 63, 155, 249, 127, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6],
    [178, 32, 173, 233, 0, 98, 5, 143, 200, 104, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 0, 143, 251, 80, 246, 71, 143, 233, 104, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 0, 175, 136, 88, 242, 84, 110, 201, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [242, 42, 159, 152, 1, 226, 132, 78, 120, 108, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 2, 159, 184, 72, 34, 137, 159, 232, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 42, 127, 184, 1, 228, 0, 13, 197, 124, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 40, 142, 232, 1, 242, 0, 77, 214, 125, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [98, 35, 143, 234, 0, 242, 0, 94, 217, 124, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [180, 38, 110, 152, 1, 98, 0, 125, 200, 125, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 46, 32, 217, 1, 242, 15, 144, 248, 120, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 40, 126, 248, 1, 226, 35, 142, 232, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [184, 40, 158, 152, 1, 98, 0, 61, 200, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [98, 0, 142, 201, 61, 230, 0, 126, 216, 104, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 0, 95, 249, 72, 230, 152, 143, 248, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [98, 12, 110, 216, 61, 42, 6, 125, 216, 88, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 0, 126, 137, 56, 230, 132, 128, 248, 104, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 128, 108, 217, 48, 226, 0, 141, 200, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 128, 136, 72, 64, 226, 10, 125, 168, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 0, 119, 197, 84, 226, 0, 158, 215, 112, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 128, 134, 185, 100, 226, 5, 159, 215, 120, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 0, 104, 104, 86, 226, 8, 155, 179, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 0, 166, 135, 65, 226, 10, 126, 201, 124, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 128, 154, 184, 72, 226, 0, 158, 249, 96, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 128, 142, 100, 104, 226, 40, 111, 115, 124, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [232, 0, 125, 153, 84, 230, 128, 128, 248, 124, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [230, 0, 159, 185, 109, 225, 0, 143, 200, 125, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 0, 9, 104, 74, 226, 43, 158, 243, 124, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [196, 0, 153, 232, 59, 226, 37, 111, 147, 124, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [230, 0, 111, 218, 105, 226, 5, 47, 216, 106, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [236, 96, 157, 199, 0, 226, 33, 127, 201, 124, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [227, 0, 15, 247, 125, 225, 63, 15, 167, 1, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 169, 15, 168, 2, 226, 60, 95, 218, 60, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [232, 64, 13, 137, 125, 226, 23, 126, 217, 124, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 0, 223, 138, 86, 226, 94, 207, 186, 126, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [226, 0, 11, 104, 96, 226, 1, 158, 184, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [234, 0, 174, 171, 73, 226, 0, 174, 186, 108, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [235, 128, 140, 203, 58, 226, 134, 175, 202, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [229, 64, 219, 59, 60, 226, 128, 190, 202, 113, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [228, 0, 158, 170, 61, 225, 67, 15, 186, 126, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [231, 64, 236, 202, 68, 226, 3, 191, 186, 102, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [234, 0, 104, 184, 72, 226, 10, 142, 184, 124, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [97, 0, 190, 153, 126, 227, 64, 207, 202, 125, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [205, 0, 11, 0, 72, 194, 88, 12, 0, 124, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 28],
    [226, 0, 14, 0, 82, 226, 88, 95, 208, 125, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [204, 0, 125, 218, 64, 194, 0, 94, 155, 88, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [233, 192, 238, 216, 67, 226, 5, 221, 170, 112, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [218, 0, 143, 172, 74, 34, 5, 141, 138, 117, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [98, 138, 203, 122, 116, 230, 86, 175, 219, 112, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [194, 65, 172, 91, 91, 194, 128, 13, 203, 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18],
    [117, 0, 14, 203, 90, 226, 30, 10, 201, 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16],
    [65, 0, 14, 234, 83, 194, 0, 8, 202, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7],
    [193, 64, 12, 89, 106, 194, 128, 60, 171, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 13],
    [75, 0, 10, 245, 97, 194, 25, 12, 233, 124, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7],
    [98, 0, 127, 216, 84, 234, 0, 143, 216, 125, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 0, 127, 217, 86, 225, 0, 143, 216, 126, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [225, 0, 127, 217, 86, 225, 0, 143, 216, 126, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [207, 64, 9, 234, 84, 196, 0, 12, 219, 100, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [207, 64, 12, 170, 84, 196, 0, 24, 249, 100, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [201, 14, 136, 217, 62, 194, 8, 26, 234, 108, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
    [3, 0, 21, 0, 100, 2, 0, 8, 0, 124, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [1, 0, 71, 215, 108, 1, 63, 12, 251, 124, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [0, 0, 54, 103, 124, 1, 63, 14, 250, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
    [2, 0, 54, 104, 124, 1, 63, 14, 250, 124, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
    [203, 0, 175, 0, 126, 192, 0, 192, 6, 127, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 15],
    [5, 13, 128, 166, 127, 11, 56, 169, 216, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [15, 0, 144, 250, 104, 6, 0, 167, 57, 84, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6],
    [201, 21, 221, 255, 124, 0, 0, 231, 252, 108, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 56],
    [72, 60, 48, 246, 3, 10, 56, 151, 232, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
    [7, 128, 11, 200, 101, 2, 63, 12, 234, 124, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
    [0, 33, 102, 64, 3, 0, 63, 71, 0, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [8, 0, 11, 60, 124, 8, 63, 6, 243, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [0, 63, 76, 251, 0, 0, 63, 10, 233, 124, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]
  ];

  // g_volumeLookupTable[i][j] = i * (j + 1) >> 5, with column 0 zero
  var VOLUME_LOOKUP = [];
  (function() {
    var i, j, sum;
    for (i = 0; i < 64; i++) {
      VOLUME_LOOKUP[i] = [];
      sum = i;
      for (j = 0; j < 32; j++) {
        VOLUME_LOOKUP[i][j] = sum >> 5;
        sum += i;
      }
      VOLUME_LOOKUP[i][0] = 0;
    }
  })();

  function lookupVolume(a, b) {
    if (b == 0) return 0;
    if (b == 31) return a;
    if (a < -63 || a > 63) return b * (a + 1) >> 5;
    if (b < 0) {
      if (a < 0) return VOLUME_LOOKUP[-a][-b];
      return -VOLUME_LOOKUP[a][-b];
    }
    if (a < 0) return -VOLUME_LOOKUP[-a][b];
    return VOLUME_LOOKUP[a][b];
  }

  // An AdLibInstrument from its 30 bytes
  function instrumentFromBytes(b) {
    return {
      modCharacteristic: b[0], modScalingOutputLevel: b[1], modAttackDecay: b[2],
      modSustainRelease: b[3], modWaveformSelect: b[4],
      carCharacteristic: b[5], carScalingOutputLevel: b[6], carAttackDecay: b[7],
      carSustainRelease: b[8], carWaveformSelect: b[9],
      feedback: b[10],
      flagsA: b[11], extraA: b.slice(12, 20),
      flagsB: b[20], extraB: b.slice(21, 29),
      duration: b[29]
    };
  }

  // Struct10: one envelope modulator; Struct11: what it modulates
  function Struct10() {
    this.active = 0; this.curVal = 0; this.count = 0; this.maxValue = 0;
    this.startValue = 0; this.loop = 0; this.tableA = [0, 0, 0, 0]; this.tableB = [0, 0, 0, 0];
    this.unk3 = 0; this.modWheel = 0; this.modWheelLast = 0; this.speedLoMax = 0;
    this.numSteps = 0; this.speedHi = 0; this.direction = 0; this.speedLo = 0;
    this.speedLoCounter = 0;
  }
  function Struct11() {
    this.modifyVal = 0; this.param = 0; this.flag0x40 = 0; this.flag0x10 = 0; this.s10 = null;
  }
  function Voice(channel) {
    this.part = null; this.next = null; this.prev = null;
    this.waitForPedal = false; this.note = 0; this.channel = channel;
    this.twoChan = 0; this.vol1 = 0; this.vol2 = 0; this.duration = 0;
    this.s10a = new Struct10(); this.s11a = new Struct11();
    this.s10b = new Struct10(); this.s11b = new Struct11();
    this.s11a.s10 = this.s10b;
    this.s11b.s10 = this.s10a;
  }

  // --- AdLibPart: one MIDI channel ------------------------------------------

  function Part(owner, channel) {
    this.owner = owner;
    this.channel = channel;
    this.voice = null;
    this.pitchBendValue = 0;
    this.pitchBendFactorValue = 2;
    this.transposeEff = 0;
    this.volEff = 0;
    this.detuneEff = 0;
    this.modWheel = 0;
    this.pedal = false;
    this.program = 0;
    this.priEff = 127;
    this.pan = 64;
    this.allocated = false;
    this.instr = instrumentFromBytes(GM_INSTRUMENTS[0]);
  }
  Part.prototype = {
    release: function() { this.allocated = false; },
    noteOff: function(note) { this.owner.partKeyOff(this, note); },
    noteOn: function(note, velocity) { this.owner.partKeyOn(this, this.instr, note, velocity); },
    programChange: function(program) {
      if (program > 127) return;
      this.program = program;
      this.instr = instrumentFromBytes(GM_INSTRUMENTS[program]);
    },
    // re-pitch every sounding voice, as pitchBend/detune/transpose do
    retune: function() {
      for (var v = this.voice; v; v = v.next)
        this.owner.adlibNoteOn(v.channel, (v.note + this.transposeEff) & 0xFF,
                               (this.pitchBendValue * this.pitchBendFactorValue >> 6) + this.detuneEff);
    },
    pitchBend: function(bend) { this.pitchBendValue = bend; this.retune(); },
    controlChange: function(control, value) {
      switch (control) {
        case 1: this.modulationWheel(value); break;
        case 7: this.volume(value); break;
        case 10: this.panPosition(value); break;
        case 16: this.pitchBendFactor(value); break;
        case 17: this.detune(value); break;
        case 18: this.priority(value); break;
        case 64: this.sustain(value > 0); break;
        case 121:
          this.modulationWheel(0); this.pitchBendFactor(0); this.detune(0); this.sustain(false);
          break;
        case 123: this.allNotesOff(); break;
      }
    },
    modulationWheel: function(value) {
      this.modWheel = value;
      for (var v = this.voice; v; v = v.next) {
        if (v.s10a.active && v.s11a.flag0x40) v.s10a.modWheel = value >> 2;
        if (v.s10b.active && v.s11b.flag0x40) v.s10b.modWheel = value >> 2;
      }
    },
    volume: function(value) {
      var v, o = this.owner;
      this.volEff = value;
      for (v = this.voice; v; v = v.next) {
        o.adlibSetParam(v.channel, 0, VOLUME_TABLE[VOLUME_LOOKUP[v.vol2][value >> 2]]);
        if (v.twoChan)
          o.adlibSetParam(v.channel, 13, VOLUME_TABLE[VOLUME_LOOKUP[v.vol1][value >> 2]]);
      }
    },
    panPosition: function(value) { this.pan = value; },
    pitchBendFactor: function(value) { this.pitchBendFactorValue = value; this.retune(); },
    detune: function(value) { this.detuneEff = value; this.retune(); },
    transpose: function(value) { this.transposeEff = value; this.retune(); },
    priority: function(value) { this.priEff = value; },
    sustain: function(value) {
      this.pedal = value;
      if (!value)
        for (var v = this.voice; v; v = v.next)
          if (v.waitForPedal) this.owner.mcOff(v);
    },
    effectLevel: function() {},
    chorusLevel: function() {},
    allNotesOff: function() {
      while (this.voice) this.owner.mcOff(this.voice);
    },
    sysEx_customInstrument: function(type, bytes) {
      if (type == MKTAG_ADL && bytes && bytes.length == 30)
        this.instr = instrumentFromBytes(bytes);
    }
  };

  // --- the driver ------------------------------------------------------------

  ScummVM.AdLibDriver = function(opl) {
    var t = this, i;
    t.opl = opl;
    t.regCache = new Uint8Array(256);
    t.timerCounter = 0;
    t.timerIncrease = 0xD69;
    t.timerThreshold = 0x411B;
    t.voiceIndex = -1;
    t.curNotTable = new Array(9);
    t.channelTable2 = new Array(9);
    for (i = 0; i < 9; i++) { t.curNotTable[i] = 0; t.channelTable2[i] = 0; }
    t.voices = [];
    for (i = 0; i < 9; i++) t.voices.push(new Voice(i));
    t.parts = [];
    for (i = 0; i < 32; i++) t.parts.push(new Part(t, i + (i >= 9 ? 1 : 0)));
    t.timerProc = null;
    t.randSeed = 1;

    // open()
    t.adlibWrite(8, 0x40);
    t.adlibWrite(0xBD, 0x00);
    t.adlibWrite(1, 0x20);
  };

  // OPL::kDefaultCallbackFrequency: onTimer runs 250 times a second
  ScummVM.AdLibDriver.CALLBACK_FREQUENCY = 250;

  ScummVM.AdLibDriver.prototype = {
    getBaseTempo: function() { return 1000000 / ScummVM.AdLibDriver.CALLBACK_FREQUENCY; },

    allocateChannel: function() {
      for (var i = 0; i < this.parts.length; i++) {
        if (!this.parts[i].allocated) {
          this.parts[i].allocated = true;
          return this.parts[i];
        }
      }
      return null;
    },

    setTimerCallback: function(proc) { this.timerProc = proc; },

    adlibWrite: function(reg, value) {
      value &= 0xFF;
      if (this.regCache[reg] == value) return;
      this.regCache[reg] = value;
      this.opl.writeReg(reg, value);
    },

    onTimer: function() {
      var t = this, i, v;
      if (t.timerProc) t.timerProc();
      t.timerCounter += t.timerIncrease;
      while (t.timerCounter >= t.timerThreshold) {
        t.timerCounter -= t.timerThreshold;
        for (i = 0; i < 9; i++) {
          v = t.voices[i];
          if (!v.part) continue;
          if (v.duration && (v.duration -= 0x11) <= 0) {
            t.mcOff(v);
            return;   // (sic) as ScummVM: the rest wait for the next tick
          }
          if (v.s10a.active) t.mcIncStuff(v, v.s10a, v.s11a);
          if (v.s10b.active) t.mcIncStuff(v, v.s10b, v.s11b);
        }
      }
    },

    mcOff: function(voice) {
      var tmp;
      this.adlibKeyOff(voice.channel);
      tmp = voice.prev;
      if (voice.next) voice.next.prev = tmp;
      if (tmp) tmp.next = voice.next;
      else voice.part.voice = voice.next;
      voice.part = null;
    },

    mcIncStuff: function(voice, s10, s11) {
      var t = this, part = voice.part, code = t.struct10OnTimer(s10, s11);
      if (code & 1) {
        switch (s11.param) {
          case 0:
            voice.vol2 = (s10.startValue + s11.modifyVal) & 0xFF;
            t.adlibSetParam(voice.channel, 0,
                            VOLUME_TABLE[VOLUME_LOOKUP[voice.vol2][part.volEff >> 2]]);
          break;
          case 13:
            voice.vol1 = (s10.startValue + s11.modifyVal) & 0xFF;
            if (voice.twoChan)
              t.adlibSetParam(voice.channel, 13,
                              VOLUME_TABLE[VOLUME_LOOKUP[voice.vol1][part.volEff >> 2]]);
            else
              t.adlibSetParam(voice.channel, 13, voice.vol1);
          break;
          case 30:
            s11.s10.modWheel = (s11.modifyVal << 24) >> 24;
          break;
          case 31:
            s11.s10.unk3 = (s11.modifyVal << 24) >> 24;
          break;
          default:
            t.adlibSetParam(voice.channel, s11.param, s10.startValue + s11.modifyVal);
        }
      }
      if ((code & 2) && s11.flag0x10)
        t.adlibKeyOnOff(voice.channel);
    },

    adlibKeyOff: function(chan) {
      var reg = chan + 0xB0;
      this.adlibWrite(reg, this.regCache[reg] & ~0x20);
    },

    struct10OnTimer: function(s10, s11) {
      var result = 0, i;
      if (s10.count && (s10.count -= 17) <= 0) {
        s10.active = 0;
        return 0;
      }
      i = s10.curVal + s10.speedHi;
      s10.speedLoCounter = (s10.speedLoCounter + s10.speedLo) & 0xFFFF;
      if (s10.speedLoCounter >= s10.speedLoMax) {
        s10.speedLoCounter -= s10.speedLoMax;
        i += s10.direction;
      }
      if (s10.curVal != i || s10.modWheel != s10.modWheelLast) {
        s10.curVal = i;
        s10.modWheelLast = s10.modWheel;
        i = lookupVolume(i, s10.modWheelLast);
        if (i != s11.modifyVal) {
          s11.modifyVal = i;
          result = 1;
        }
      }
      s10.numSteps = (s10.numSteps - 1) & 0xFFFF;
      if (!s10.numSteps) {
        s10.active++;
        if (s10.active > 4) {
          if (s10.loop) {
            s10.active = 1;
            result |= 2;
            this.struct10Setup(s10);
          } else {
            s10.active = 0;
          }
        } else {
          this.struct10Setup(s10);
        }
      }
      return result;
    },

    adlibSetParam: function(channel, param, value) {
      var as, reg;
      if (param <= 12) {
        reg = OPERATOR2_OFFSETS[channel];
      } else if (param <= 25) {
        param -= 13;
        reg = OPERATOR1_OFFSETS[channel];
      } else if (param <= 27) {
        param -= 13;
        reg = channel;
      } else if (param == 28 || param == 29) {
        if (param == 28) value -= 15;
        else value -= 383;
        value *= 16;
        this.channelTable2[channel] = value;
        this.adlibPlayNote(channel, this.curNotTable[channel] + value);
        return;
      } else {
        return;
      }
      as = SET_PARAM_TABLE[param];
      if (as[3]) value = as[3] - value;
      reg += as[0];
      this.adlibWrite(reg, (this.regCache[reg] & ~as[2]) | ((value & 0xFF) << as[1]));
    },

    adlibKeyOnOff: function(channel) {
      var reg = channel + 0xB0, val = this.regCache[reg];
      this.adlibWrite(reg, val & ~0x20);
      this.adlibWrite(reg, val | 0x20);
    },

    struct10Setup: function(s10) {
      var b, c, d, e, f, g, h, t;
      b = s10.unk3;
      f = s10.active - 1;
      t = s10.tableA[f];
      e = NUM_STEPS_TABLE[VOLUME_LOOKUP[t & 0x7F][b]];
      if (t & 0x80) e = this.randomNr(e);
      if (e == 0) e++;
      s10.numSteps = s10.speedLoMax = e;
      if (f != 2) {
        c = s10.maxValue;
        g = s10.startValue;
        t = s10.tableB[f];
        d = lookupVolume(c, (t & 0x7F) - 31);
        if (t & 0x80) d = this.randomNr(d);
        if (d + g > c) {
          h = c - g;
        } else {
          h = d;
          if (d + g < 0) h = -g;
        }
        h -= s10.curVal;
      } else {
        h = 0;
      }
      s10.speedHi = Math.trunc(h / e);
      if (h < 0) {
        h = -h;
        s10.direction = -1;
      } else {
        s10.direction = 1;
      }
      s10.speedLo = h % e;
      s10.speedLoCounter = 0;
    },

    adlibPlayNote: function(channel, note) {
      var old, oct, notex, note2, i;
      note2 = ((note >> 7) - 4) & 0xFF;
      note2 = (note2 < 128) ? note2 : 0;
      oct = Math.floor(note2 / 12);
      if (oct > 7) oct = 7 << 2;
      else oct <<= 2;
      notex = note2 % 12 + 3;
      old = this.regCache[channel + 0xB0];
      if (old & 0x20) {
        old &= ~0x20;
        if (oct > old) {
          if (notex < 6) {
            notex += 12;
            oct -= 4;
          }
        } else if (oct < old) {
          if (notex > 11) {
            notex -= 12;
            oct += 4;
          }
        }
      }
      i = (notex << 3) + ((note >> 4) & 0x7);
      this.adlibWrite(channel + 0xA0, NOTE_FREQUENCIES[i]);
      this.adlibWrite(channel + 0xB0, oct | 0x20);
    },

    randomNr: function(a) {
      if (this.randSeed & 1) {
        this.randSeed >>= 1;
        this.randSeed ^= 0xB8;
      } else {
        this.randSeed >>= 1;
      }
      return this.randSeed * a >> 8;
    },

    partKeyOff: function(part, note) {
      for (var v = part.voice; v; v = v.next) {
        if (v.note == note) {
          if (part.pedal) v.waitForPedal = true;
          else this.mcOff(v);
        }
      }
    },

    partKeyOn: function(part, instr, note, velocity) {
      var voice = this.allocateVoice(part.priEff);
      if (!voice) return;
      this.linkMc(part, voice);
      this.mcKeyOn(voice, instr, note, velocity);
    },

    allocateVoice: function(pri) {
      var i, ac, best = null;
      for (i = 0; i < 9; i++) {
        if (++this.voiceIndex >= 9) this.voiceIndex = 0;
        ac = this.voices[this.voiceIndex];
        if (!ac.part) return ac;
        if (!ac.next) {
          if (ac.part.priEff <= pri) {
            pri = ac.part.priEff;
            best = ac;
          }
        }
      }
      if (best) this.mcOff(best);
      return best;
    },

    linkMc: function(part, voice) {
      voice.part = part;
      voice.next = part.voice;
      part.voice = voice;
      voice.prev = null;
      if (voice.next) voice.next.prev = voice;
    },

    mcKeyOn: function(voice, instr, note, velocity) {
      var t = this, part = voice.part, vol1, vol2, c;
      voice.twoChan = instr.feedback & 1;
      voice.note = note;
      voice.waitForPedal = false;
      voice.duration = instr.duration;
      if (voice.duration != 0) voice.duration *= 63;

      vol1 = (instr.modScalingOutputLevel & 0x3F) + VOLUME_LOOKUP[velocity >> 1][instr.modWaveformSelect >> 2];
      if (vol1 > 0x3F) vol1 = 0x3F;
      voice.vol1 = vol1;
      vol2 = (instr.carScalingOutputLevel & 0x3F) + VOLUME_LOOKUP[velocity >> 1][instr.carWaveformSelect >> 2];
      if (vol2 > 0x3F) vol2 = 0x3F;
      voice.vol2 = vol2;

      c = part.volEff >> 2;
      vol2 = VOLUME_TABLE[VOLUME_LOOKUP[vol2][c]];
      if (voice.twoChan) vol1 = VOLUME_TABLE[VOLUME_LOOKUP[vol1][c]];

      t.adlibSetupChannel(voice.channel, instr, vol1, vol2);
      t.adlibNoteOnEx(voice.channel, (note + part.transposeEff) & 0xFF,
                      part.detuneEff + (part.pitchBendValue * part.pitchBendFactorValue >> 6));
      if (instr.flagsA & 0x80) t.mcInitStuff(voice, voice.s10a, voice.s11a, instr.flagsA, instr.extraA);
      else voice.s10a.active = 0;
      if (instr.flagsB & 0x80) t.mcInitStuff(voice, voice.s10b, voice.s11b, instr.flagsB, instr.extraB);
      else voice.s10b.active = 0;
    },

    adlibSetupChannel: function(chan, instr, vol1, vol2) {
      var t = this, channel = OPERATOR1_OFFSETS[chan];
      t.adlibWrite(channel + 0x20, instr.modCharacteristic);
      t.adlibWrite(channel + 0x40, (instr.modScalingOutputLevel | 0x3F) - vol1);
      t.adlibWrite(channel + 0x60, ~instr.modAttackDecay);
      t.adlibWrite(channel + 0x80, ~instr.modSustainRelease);
      t.adlibWrite(channel + 0xE0, instr.modWaveformSelect);
      channel = OPERATOR2_OFFSETS[chan];
      t.adlibWrite(channel + 0x20, instr.carCharacteristic);
      t.adlibWrite(channel + 0x40, (instr.carScalingOutputLevel | 0x3F) - vol2);
      t.adlibWrite(channel + 0x60, ~instr.carAttackDecay);
      t.adlibWrite(channel + 0x80, ~instr.carSustainRelease);
      t.adlibWrite(channel + 0xE0, instr.carWaveformSelect);
      t.adlibWrite(chan + 0xC0, instr.feedback);
    },

    mcInitStuff: function(voice, s10, s11, flags, ie) {
      var part = voice.part;
      s11.modifyVal = 0;
      s11.flag0x40 = flags & 0x40;
      s10.loop = flags & 0x20;
      s11.flag0x10 = flags & 0x10;
      s11.param = PARAM_TABLE1[flags & 0xF];
      s10.maxValue = MAX_VAL_TABLE[flags & 0xF];
      s10.unk3 = 31;
      s10.modWheel = s11.flag0x40 ? part.modWheel >> 2 : 31;
      switch (s11.param) {
        case 0: s10.startValue = voice.vol2; break;
        case 13: s10.startValue = voice.vol1; break;
        case 30:
          s10.startValue = 31;
          s11.s10.modWheel = 0;
        break;
        case 31:
          s10.startValue = 0;
          s11.s10.unk3 = 0;
        break;
        default:
          s10.startValue = this.adlibGetRegValueParam(voice.channel, s11.param);
      }
      this.struct10Init(s10, ie);
    },

    // ie: the 8 InstrumentExtra bytes a..h
    struct10Init: function(s10, ie) {
      s10.active = 1;
      s10.curVal = 0;
      s10.modWheelLast = 31;
      s10.count = ie[0];
      if (s10.count) s10.count *= 63;
      s10.tableA[0] = ie[1];
      s10.tableA[1] = ie[3];
      s10.tableA[2] = ie[5];
      s10.tableA[3] = ie[6];
      s10.tableB[0] = ie[2];
      s10.tableB[1] = ie[4];
      s10.tableB[2] = 0;
      s10.tableB[3] = ie[7];
      this.struct10Setup(s10);
    },

    adlibGetRegValueParam: function(chan, param) {
      var as, val, channel;
      if (param <= 12) {
        channel = OPERATOR2_OFFSETS[chan];
      } else if (param <= 25) {
        param -= 13;
        channel = OPERATOR1_OFFSETS[chan];
      } else if (param <= 27) {
        param -= 13;
        channel = chan;
      } else if (param == 28) {
        return 0xF;
      } else if (param == 29) {
        return 0x17F;
      } else {
        return 0;
      }
      as = SET_PARAM_TABLE[param];
      val = this.regCache[channel + as[0]];
      val &= as[2];
      val >>= as[1];
      if (as[3]) val = as[3] - val;
      return val;
    },

    adlibNoteOn: function(chan, note, mod) {
      var code = (note << 7) + mod;
      this.curNotTable[chan] = code;
      this.adlibPlayNote(chan, ((this.channelTable2[chan] << 16) >> 16) + code);
    },

    adlibNoteOnEx: function(chan, note, mod) {
      var code = (note << 7) + mod;
      this.curNotTable[chan] = code;
      this.channelTable2[chan] = 0;
      this.adlibPlayNote(chan, code);
    }
  };
}());
