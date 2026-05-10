# SID web audio worklet

SID Player using AudioWorklet

This is derived from jsSID (https://github.com/og2t/jsSID)

## API

### `AudioPlayer`

```ts
// Lifecycle
player.load(url: string, durationSeconds?: number): Promise<void>
player.play(url?: string, durationSeconds?: number): Promise<void>
player.pause(): Promise<void>
player.togglePlay(): Promise<void>

// Volume  — value in [0, 1]
player.setVolume(value: number): Promise<void>

// Seek — canonical unit is seconds
player.setPosition(seconds: number): void

// Seek as a fraction [0, 1] of a known duration.
// Ignored if durationSeconds is 0 or negative.
player.setPositionPercent(percent: number, durationSeconds: number): void

// Subsong selection (0-based index)
player.setSubsong(index: number): void

// Connect an AudioNode (e.g. an AnalyserNode) into the signal path
// between the worklet and the gain node.
player.connectVisualizer(visualizer: AudioNode): void

// Subscribe to an event. Returns an unsubscribe function.
player.on(event, callback): () => void
```

### Events

| Event         | Payload            | Description                                      |
| ------------- | ------------------ | ------------------------------------------------ |
| `ready`       | `CustomEvent`      | AudioWorklet module loaded and ready             |
| `statechange` | `AudioContext`     | `context.state` changed (running / suspended)    |
| `songInfo`    | `SongInfoEvent`    | Fired after `load()` or `setSubsong()`           |
| `position`    | `PositionEvent`    | Current playback position (~100 ms interval)     |
| `log`         | `LogEvent`         | Diagnostic message from the worklet              |
| `error`       | `PlayerErrorEvent` | Load failure (also rejects the `load()` promise) |

#### `SongInfoEvent`

```ts
event.songInfo: {
  Name: string;        // "Author - Title"
  Info: string;        // copyright string from SID header
  Duration: number;    // seconds (0 when unknown)
  Subsong: number;     // current subsong index (0-based)
  Subsongs: number;    // total number of subsongs
}
```

#### `PlayerErrorEvent`

```ts
event.error: Error    // the underlying Error object
```

### Seek behaviour

- `setPosition(seconds)` is the canonical seek method. The unit is seconds.
- The seek is **exact**: the emulator state is restored from the nearest 30-second checkpoint and then advanced sample-by-sample to the requested point, producing bit-identical output to continuous playback.
- **Checkpoints** are saved automatically every 30 seconds of audio during normal playback. Seeking to a position within a checkpointed region is fast regardless of song length.
- Rapid scrubbing (many calls in quick succession) is safe: only the **last** queued seek is executed per audio block, avoiding backlog and accumulated jumps.
- The audio graph is never recreated during a seek; playback continuity is preserved.
- The `position` event is emitted after every seek and approximately every 100 ms during normal playback.

### Performance notes

- The **first** forward play-through of a song builds checkpoints in real time — no overhead beyond the normal emulation cost.
- Subsequent seeks land on the nearest 30-second checkpoint and advance only the delta, so worst-case seek cost is ~30 seconds of emulation (≈ 1.3 M samples) rather than the full song length.
- For UI scrub bars, debounce or throttle `setPosition` calls (≥ 50 ms) to limit seek frequency.

### Keyboard shortcuts (demo UI)

| Key     | Action           |
| ------- | ---------------- |
| `Space` | Play / pause     |
| `←`     | Seek back 5 s    |
| `→`     | Seek forward 5 s |
| `↑`     | Volume +10%      |
| `↓`     | Volume −10%      |
| `M`     | Mute / unmute    |

Shortcuts are disabled while focus is inside an `<input>`, `<select>`, or `<textarea>`.
