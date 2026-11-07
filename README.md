JS ScummVM
----------

A native JavaScript implementation of [ScummVM](http://scummvm.org).

Progress
========

These LucasArts games run, each on the SCUMM version ScummVM gives it:

* Maniac Mansion (SCUMM v2): playable, with saving and PCjr sound.
* Zak McKracken and the Alien Mindbenders (v2): playable, with saving and
  PCjr sound.
* Indiana Jones and the Last Crusade, VGA (v3): playable, with saving and
  PCjr sound.
* Loom, CD (v4): starts, with its CD music and voices; the drafts are still
  to be tested.
* The Secret of Monkey Island, CD (v5): playable, with saving and CD music.
* Monkey Island 2: LeChuck's Revenge (v5): playable, with iMUSE music.
* Indiana Jones and the Fate of Atlantis, CD (v5): playable, with speech.
* Day of the Tentacle, CD (v6): plays its intro into the first room; the
  rest, its speech and its music still to be tested.

Sam & Max Hit the Road, Full Throttle, The Dig and The Curse of Monkey
Island do not run yet.

It runs at [dieppa.co.uk/jsscummvm](https://dieppa.co.uk/jsscummvm/).

Usage
=====

The games are not included. They come from a
[webRcade](https://www.webrcade.com/) feed: a JSON list of games, each with
a link to a zip of its data files (and, for the CD games, their tracks and
speech). Give the page the feed, and the game by its ScummVM id:

    index.html?feed=https://example.com/example-feed&game=monkey

Without a feed the page asks for one. Without a game it starts at a DOS
prompt, and the boxes on the shelf load the games in the feed.

Credits
=======

Most of the code is directly ported from ScummVM's C++ code base, see
[the ScummVM README](http://scummvm.svn.sourceforge.net/viewvc/scummvm/scummvm/tags/release-1-1-1/README?view=markup)
for full credits.

stream.js is based on the stream implementation of [gordon](http://github.com/tobeytailor/gordon/) by Tobias Schneider.

The CRT monitor's case is adapted from Manz's [pure-CSS CRT monitor](https://codepen.io/manz/pen/yLbrpGV).

The coffee mug on the desk is adapted from Alvaro Montoro's [pure-CSS coffee mug](https://codepen.io/alvaromontoro/pen/wvxoarW).

The DOS prompt is set in [Less Perfect DOS VGA](http://laemeur.sdf.org/fonts/) by laemeur, after Zeh Fernando's Perfect DOS VGA 437.

LucasArts, Monkey Island, Maniac Mansion, Full Throttle, The Dig, LOOM, and probably lots of other things are
registered trademarks of LucasArts, Inc.. All other trademarks and registered trademarks are owned by their respective
companies. ScummVM or JS ScummVM are not affiliated in any way with LucasArts, Inc.
