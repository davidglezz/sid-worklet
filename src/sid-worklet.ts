import { SIDPlayer } from './sid.ts';

/// <reference types="@types/audioworklet" />

/** Metadata for a loaded SID file. */
export interface SongInfo {
  /** Author and title formatted as "Author - Title". */
  Name: string;
  /** Copyright / info string from the SID header. */
  Info: string;
  /** Song duration in seconds (0 when unknown). */
  Duration: number;
  /** Zero-based index of the currently active subsong. */
  Subsong: number;
  /** Total number of subsongs in this file. */
  Subsongs: number;
}

/** Types to define the comunication between the AudioWorklet and the Node. */
export interface InputMessagesMap {
  load: { songData: ArrayBuffer };
  setPosition: { value: number };
  setSubsong: { value: number };
  setDuration: { value: number };
}

export interface OutputMessagesMap {
  songInfo: { songInfo: SongInfo };
  position: { value: number };
  log: { severity: 'info' | 'warn' | 'error'; message: string };
  error: { message: string };
}

type Id<T extends object, R = { [ID in keyof T]: { id: ID } & T[ID] }[keyof T]> = NonNullable<{
  [P in keyof R]: R[P];
}>;
export type InputMessages = Id<InputMessagesMap>;
export type OutputMessages = Id<OutputMessagesMap>;

class SIDProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  sid = SIDPlayer(/*sampleRate*/);
  /** Pending seek target in seconds; null if no seek is queued (last-wins). */
  private pendingSeek: number | null = null;
  /** Duration of the current song in seconds (0 when unknown). */
  private duration = 0;
  /** Sample counter used to throttle periodic position messages. */
  private samplesSinceLastPosition = 0;
  /** Emit a position message every ~100 ms (at 44100 Hz ≈ 4410 samples). */
  private static readonly POSITION_INTERVAL = 4410;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<InputMessages>) => {
      const message = ev.data;
      switch (message.id) {
        case 'load':
          this.load(message);
          break;
        case 'setPosition':
          this.setPosition(message);
          break;
        case 'setSubsong':
          this.setSubsong(message);
          break;
        case 'setDuration':
          this.setDuration(message);
          break;
        default:
          this.port.postMessage({
            id: 'log',
            severity: 'warn',
            message: `Unknown message: ${String((message as { id: unknown }).id)}`,
          });
      }
    };
  }

  process(_input: never, outputs: Float32Array[][], _params: never): boolean {
    const output = outputs[0];
    const left = output[0];
    const length = left.length;
    const right = output.length > 1 ? output[1] : left;

    // Apply pending seek (last-wins) before producing samples.
    if (this.pendingSeek !== null) {
      const target = this.pendingSeek;
      this.pendingSeek = null;
      this.sid.seek(target);
      this.port.postMessage({ id: 'position', value: this.sid.playtime });
      this.samplesSinceLastPosition = 0;
    }

    this.sid.render(left, right, length);

    this.samplesSinceLastPosition += length;
    if (this.samplesSinceLastPosition >= SIDProcessor.POSITION_INTERVAL) {
      this.samplesSinceLastPosition = 0;
      this.port.postMessage({ id: 'position', value: this.sid.playtime });
    }

    return true;
  }

  setPosition({ value }: InputMessagesMap['setPosition']) {
    // value is in seconds; queue as pending (last-wins to avoid backlog).
    this.pendingSeek = value;
  }

  setSubsong({ value }: InputMessagesMap['setSubsong']) {
    this.pendingSeek = null;
    const index = Math.max(0, Math.floor(value));
    this.sid.init(index);
    this.port.postMessage({ id: 'songInfo', songInfo: this.getSongInfo() });
    this.port.postMessage({ id: 'position', value: 0 });
  }

  load({ songData }: InputMessagesMap['load']) {
    this.pendingSeek = null;
    try {
      this.sid.load(songData);
      this.port.postMessage({ id: 'songInfo', songInfo: this.getSongInfo() });
      this.port.postMessage({ id: 'position', value: 0 });
    } catch (error) {
      this.port.postMessage({
        id: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  setDuration({ value }: InputMessagesMap['setDuration']) {
    this.duration = Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  getSongInfo(): SongInfo {
    return {
      Name: `${this.sid.author} - ${this.sid.title}`,
      Info: this.sid.info,
      Duration: this.duration,
      Subsong: this.sid.subtune,
      Subsongs: this.sid.subtunes,
    };
  }
}

registerProcessor('sid', SIDProcessor);
