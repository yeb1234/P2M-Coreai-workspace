# Sounds

Local generated audio used by the Pomodoro timer.

- Break-start cue is generated with Web Audio in `src/lib/sounds.ts`; the old `break-chime.wav` asset is no longer used by default.
- `rain.ogg` - rain background, derived from "Rain (1)" on Wikimedia Commons.
- `cafe.ogg` - 20-minute cafe ambiance background, derived from "Cafe ambiance" on Wikimedia Commons (CC0).
- `fireplace.ogg` - campfire background, derived from "Campfire sound ambience" on Wikimedia Commons.
- `forest.ogg` - forest background, derived from "Forest" by Joseph Sardin / BigSoundBank.
- `ocean.ogg` - ocean background, derived from BigSoundBank sound 0267.
- `stream.ogg` - stream background, derived from BigSoundBank sound 2713.
- `countryside.ogg` - countryside background, derived from BigSoundBank sound 0097.
- `wind.ogg` - wind background, derived from BigSoundBank sound 1716.
- `pomodoro-start.ogg` - start/focus cue, derived from BigSoundBank sound 2086.
- `pomodoro-break.ogg` - break cue, derived from BigSoundBank sound 0292.
- `pomodoro-complete.ogg` - completion cue, derived from BigSoundBank sound 2705.

The ambient files are local OGG files, so the app does not depend on external audio URLs. The older WAV files are kept as local fallbacks/assets but are not used by the timer.
