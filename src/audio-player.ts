import { SIDNode } from './sid-node.ts';
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

  constructor() {
    super();
    this.context = new AudioContext({ sampleRate: 44100 }); // SID.SAMPLE_RATE
    if (this.context.state === 'running') {
      void this.context.suspend();
    }
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    void this.context.audioWorklet.addModule(SIDProcessor).then(() => {
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

  on<K extends keyof EventMap>(id: K, callback: (event: EventMap[K]) => void) {
    if (id === 'statechange') {
      this.context.addEventListener('statechange', () => callback(this.context as any));
    } else {
      this.addEventListener(id, callback as EventListener);
    }
  }

  async setVolume(value: number) {
    this.gainNode.gain.value = value;
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
  readonly songInfo: any;

  constructor(songInfo: any) {
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
