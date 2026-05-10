import { SIDNode } from './sid-node.ts';
import type { SongInfo } from './sid-worklet.ts';
import SIDProcessor from './sid-worklet.ts?worker&url';

export interface EventMap {
  statechange: AudioContext;
  songInfo: SongInfoEvent;
  position: PositionEvent;
  log: LogEvent;
  ready: CustomEvent;
}

export class AudioPlayer extends EventTarget {
  public context: AudioContext;
  protected gainNode: GainNode;
  protected playerNode!: SIDNode;
  /** Resolves once the AudioWorklet module is loaded and playerNode is ready. */
  private readonly readyPromise: Promise<void>;

  constructor() {
    super();
    this.context = new AudioContext({ sampleRate: 44100 }); // SID.SAMPLE_RATE
    if (this.context.state === 'running') {
      void this.context.suspend();
    }
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    this.readyPromise = this.context.audioWorklet.addModule(SIDProcessor).then(() => {
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
      this.playerNode.connect(this.gainNode);
      this.dispatchEvent(new CustomEvent('ready'));
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

  async play(url = '') {
    if (url) {
      await this.load(url);
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

  async load(url: string) {
    await this.readyPromise;
    const songData = await this.download(url);
    this.playerNode.load(songData);
  }

  /**
   * Seek to a position in the current song.
   * @param value Position in seconds (canonical unit).
   */
  setPosition(value: number) {
    this.playerNode.setPosition(value);
  }

  setSubsong(value: number) {
    this.playerNode.setSubsong(value);
  }

  /**
   * Seek to a position expressed as a fraction of the total duration [0, 1].
   * Requires a known duration; if duration is 0 the call is ignored.
   */
  setPositionPercent(percent: number, durationSeconds: number) {
    if (durationSeconds <= 0) return;
    const clamped = Math.max(0, Math.min(1, percent));
    this.playerNode.setPosition(clamped * durationSeconds);
  }

  connectVisualizer(visualizer: AudioNode) {
    this.playerNode.disconnect(this.gainNode);
    this.playerNode.connect(visualizer);
    visualizer.connect(this.gainNode);
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
