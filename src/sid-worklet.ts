import { SIDPlayer } from './sid.ts';

/// <reference types="@types/audioworklet" />

// This is a workaround to make the TextDecoder available in the AudioWorkletGlobalScope
(globalThis as any).TextDecoder = class TextDecoder {
  decode(buffer: Uint8Array) {
    return String.fromCharCode(...buffer);
  }
};

/** Types to define the comunication between the AudioWorklet and the Node. */
export interface InputMessagesMap {
  load: { songData: ArrayBuffer };
  setPosition: { value: number };
}

export interface OutputMessagesMap {
  songInfo: { songInfo: any };
  position: { value: number };
  log: { severity: 'info' | 'warn' | 'error'; message: string };
}

type Id<T extends object, R = { [ID in keyof T]: { id: ID } & T[ID] }[keyof T]> = NonNullable<{
  [P in keyof R]: R[P];
}>;
export type InputMessages = Id<InputMessagesMap>;
export type OutputMessages = Id<OutputMessagesMap>;

type MessageHandler<T = InputMessagesMap> = { [ID in keyof T]: (params: T[ID]) => void };

class SIDProcessor
  extends AudioWorkletProcessor
  implements AudioWorkletProcessorImpl, MessageHandler
{
  sid = SIDPlayer(/*sampleRate*/);
  /** Pending seek target in seconds; null if no seek is queued (last-wins). */
  private pendingSeek: number | null = null;
  /** Sample counter used to throttle periodic position messages. */
  private samplesSinceLastPosition = 0;
  /** Emit a position message every ~100 ms (at 44100 Hz ≈ 4410 samples). */
  private static readonly POSITION_INTERVAL = 4410;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<InputMessages>) => {
      const { id, ...params } = ev.data;
      // @ts-expect-error - Params depends on the message id
      this[id]?.(params);
    };
  }

  process(_input: never, outputs: Float32Array[][], _params: never): boolean {
    const output = outputs[0];
    const length = output[0].length;
    const left = output[0];
    const right = output[1];

    // Apply pending seek (last-wins) before producing samples.
    if (this.pendingSeek !== null) {
      const target = this.pendingSeek;
      this.pendingSeek = null;
      this.sid.seek(target);
      this.port.postMessage({ id: 'position', value: this.sid.playtime });
      this.samplesSinceLastPosition = 0;
    }

    for (let i = 0; i < length; i++) {
      left[i] = right[i] = this.sid.play();
    }

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

  load({ songData }: InputMessagesMap['load']) {
    this.sid.load(songData, 0);
    this.port.postMessage({ id: 'songInfo', songInfo: this.getSongInfo() });
    this.port.postMessage({ id: 'position', value: 0 });
  }

  getSongInfo() {
    return {
      Name: `${this.sid.author} - ${this.sid.title}`,
      Info: this.sid.info,
      Duration: 0,
    };
  }
}

registerProcessor('sid', SIDProcessor);
