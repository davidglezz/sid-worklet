# SID web audio worklet

SID Player using AudioWorklet

This is derived from jsSID (https://github.com/og2t/jsSID)

## API

### `AudioPlayer`

```ts
player.load(url: string): Promise<void>
player.play(url?: string): Promise<void>
player.pause(): Promise<void>
player.togglePlay(): Promise<void>
player.setVolume(value: number): Promise<void>

// Seek to a position in seconds (canonical unit).
player.setPosition(seconds: number): void

// Seek to a position as a fraction [0, 1] of a known duration.
// Ignored if durationSeconds is 0 or negative.
player.setPositionPercent(percent: number, durationSeconds: number): void
```

### Seek behaviour

- `setPosition(seconds)` accepts the target time in seconds and is the canonical unit.
- The seek is exact: the emulator is re-initialised and advanced sample-by-sample to the requested point, producing bit-identical output to continuous playback.
- Rapid scrubbing (many calls in quick succession) is safe: only the **last** queued seek is executed per audio block, avoiding backlog and accumulated jumps.
- The audio graph is never recreated during a seek; playback continuity is preserved.
- The `position` event is emitted after every seek and approximately every 100 ms during normal playback.

### Performance notes

- Seeking forwards in time requires advancing the emulator sample-by-sample from the start. For songs longer than ~60 s, seeks to late positions may take a noticeable amount of time inside the audio thread. If this becomes an issue, consider adding periodic checkpoints at the application level.
- For UI scrub bars, debounce or throttle `setPosition` calls (≥ 50 ms) to limit seek frequency.
