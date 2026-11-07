import { SIDNode } from './sid-node.ts';
import type { SongInfo } from './sid-worklet.ts';
import SIDProcessor from './sid-worklet.ts?worker&url';

export interface EventMap {
  statechange: AudioContext;
  songInfo: SongInfoEvent;
  position: PositionEvent;
  log: LogEvent;
  ready: CustomEvent;
  error: PlayerErrorEvent;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class AudioPlayer extends EventTarget {
  public context: AudioContext;
  protected gainNode: GainNode;
  protected playerNode!: SIDNode;
  /** Resolves once the AudioWorklet module is loaded and playerNode is ready. */
  private readonly readyPromise: Promise<void>;
  /** Set when the worklet failed to load, so load() does not duplicate the event. */
  private readyFailed = false;
  private pendingPosition: number | null = null;
  private pendingSubsong: number | null = null;
  private pendingVisualizer: AudioNode | null = null;
  private visualizer: AudioNode | null = null;

  constructor() {
    super();
    this.context = new AudioContext({ sampleRate: 44100 }); // SID.SAMPLE_RATE
    if (this.context.state === 'running') {
      void this.context.suspend();
    }
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    this.readyPromise = this.context.audioWorklet
      .addModule(SIDProcessor)
      .then(() => {
        this.playerNode = new SIDNode(this.context);
        this.playerNode.on('position', ({ detail }) => {
          this.dispatchEvent(new PositionEvent(detail.value));
        });
        this.playerNode.on('songInfo', ({ detail }) => {
          this.dispatchEvent(new SongInfoEvent(detail.songInfo));
        });
        this.playerNode.on('log', ({ detail: { severity, message } }) => {
          this.dispatchEvent(new LogEvent(severity, message));
        });
        this.playerNode.on('error', ({ detail: { message } }) => {
          this.dispatchEvent(new PlayerErrorEvent(new Error(message)));
        });
        this.playerNode.connect(this.gainNode);
        if (this.pendingVisualizer) {
          this.connectVisualizer(this.pendingVisualizer);
          this.pendingVisualizer = null;
        }
        this.dispatchEvent(new CustomEvent('ready'));
      })
      .catch((error) => {
        this.readyFailed = true;
        this.dispatchEvent(new PlayerErrorEvent(toError(error)));
        throw error;
      });
  }

  /**
   * Subscribe to a player event.
   * @returns A function that removes the listener when called.
   */
  on<K extends keyof EventMap>(id: K, callback: (event: EventMap[K]) => void): () => void {
    if (id === 'statechange') {
      const wrapper = () => callback(this.context as EventMap[K]);
      this.context.addEventListener('statechange', wrapper);
      return () => this.context.removeEventListener('statechange', wrapper);
    }
    this.addEventListener(id, callback as EventListener);
    return () => this.removeEventListener(id, callback as EventListener);
  }

  setVolume(value: number): Promise<void> {
    this.gainNode.gain.value = value;
    return Promise.resolve();
  }

  async play(url = '', durationSeconds = 0) {
    await this.readyPromise;
    if (url) {
      await this.load(url, durationSeconds);
    }

    if (this.context.state !== 'running') {
      await this.context.resume();
    }
  }

  async pause() {
    await this.context.suspend();
  }

  async togglePlay() {
    if (this.context.state !== 'running') {
      await this.play();
    } else {
      await this.pause();
    }
  }

  async load(url: string, durationSeconds = 0) {
    try {
      await this.readyPromise;
      const songData = await this.download(url);
      this.playerNode.setDuration(durationSeconds);
      this.playerNode.load(songData);
      if (this.pendingSubsong !== null) {
        this.playerNode.setSubsong(this.pendingSubsong);
        this.pendingSubsong = null;
      }
      if (this.pendingPosition !== null) {
        this.playerNode.setPosition(this.pendingPosition);
        this.pendingPosition = null;
      }
    } catch (err) {
      if (!this.readyFailed) {
        this.dispatchEvent(new PlayerErrorEvent(toError(err)));
      }
      throw err;
    }
  }

  /**
   * Seek to a position in the current song.
   * @param value Position in seconds (canonical unit).
   */
  setPosition(value: number) {
    if (!this.playerNode) {
      this.pendingPosition = value;
      return;
    }
    this.playerNode.setPosition(value);
  }

  setSubsong(value: number) {
    if (!this.playerNode) {
      this.pendingSubsong = value;
      return;
    }
    this.playerNode.setSubsong(value);
  }

  /**
   * Seek to a position expressed as a fraction of the total duration [0, 1].
   * Requires a known duration; if duration is 0 the call is ignored.
   */
  setPositionPercent(percent: number, durationSeconds: number) {
    if (durationSeconds <= 0) return;
    const clamped = Math.max(0, Math.min(1, percent));
    this.setPosition(clamped * durationSeconds);
  }

  connectVisualizer(visualizer: AudioNode) {
    if (!this.playerNode) {
      this.pendingVisualizer = visualizer;
      return;
    }
    if (this.visualizer) {
      this.playerNode.disconnect(this.visualizer);
      this.visualizer.disconnect(this.gainNode);
      this.visualizer = null;
    } else {
      this.playerNode.disconnect(this.gainNode);
    }
    this.playerNode.connect(visualizer);
    visualizer.connect(this.gainNode);
    this.visualizer = visualizer;
  }

  protected async download(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.statusText} (${response.status})`);
    }
    return await response.arrayBuffer();
  }
}

export class PositionEvent extends Event {
  readonly value: number;

  constructor(value: number) {
    super('position');
    this.value = value;
  }
}

export class SongInfoEvent extends Event {
  readonly songInfo: SongInfo;

  constructor(songInfo: SongInfo) {
    super('songInfo');
    this.songInfo = songInfo;
  }
}

export class LogEvent extends Event {
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;

  constructor(severity: 'info' | 'warn' | 'error', message: string) {
    super('log');
    this.severity = severity;
    this.message = message;
  }
}

export class PlayerErrorEvent extends Event {
  readonly error: Error;

  constructor(error: Error) {
    super('error');
    this.error = error;
  }
}
