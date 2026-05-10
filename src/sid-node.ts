import type { InputMessages, OutputMessages, SongInfo } from './sid-worklet';

interface EventMap {
  songInfo: CustomEvent<{ songInfo: SongInfo }>;
  position: CustomEvent<{ value: number }>;
  log: CustomEvent<{ severity: 'info' | 'warn' | 'error'; message: string }>;
}

export class SIDNode extends AudioWorkletNode {
  constructor(context: AudioContext) {
    super(context, 'sid', {
      outputChannelCount: [2],
      numberOfInputs: 0,
      numberOfOutputs: 1,
    });

    this.handleMessages();
  }

  protected handleMessages() {
    this.port.onmessage = (ev: MessageEvent<OutputMessages>) => {
      const { id, ...detail } = ev.data;
      this.dispatchEvent(new CustomEvent(id, { detail }));
    };
  }

  /**
   * Subscribe to a worklet event.
   * @returns A function that removes the listener when called.
   */
  on<K extends keyof EventMap>(id: K, callback: (event: EventMap[K]) => void): () => void {
    this.addEventListener(id, callback as EventListener);
    return () => this.removeEventListener(id, callback as EventListener);
  }

  protected sendMessage(message: InputMessages) {
    this.port.postMessage(message);
  }

  load(songData: ArrayBuffer) {
    this.sendMessage({ id: 'load', songData });
  }

  setPosition(value: number) {
    this.sendMessage({ id: 'setPosition', value });
  }

  setSubsong(value: number) {
    this.sendMessage({ id: 'setSubsong', value });
  }
}
