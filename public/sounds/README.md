# Sounds

Local generated audio used by the Pomodoro timer.

- Break-start cue is generated with Web Audio in `src/lib/sounds.ts`; the old `break-chime.wav` asset is no longer used by default.
- `rain.wav` - loopable rain background.
- `cafe.wav` - loopable cafe background.
- `fireplace.wav` - loopable fireplace background.
- `forest.wav` - loopable forest background.

The ambient files are short local loops so the app does not depend on external audio URLs.
