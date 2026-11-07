import { createSID } from '../../src/sid-device.ts';
import type { SidMetadata } from './sid-file.ts';

const C64_PAL_CPUCLK = 985248;
const PAL_FRAMERATE = 50;
const SID_AMOUNT_VOL = [1, 0.6, 0.4];

export interface WasmSongMetadata extends SidMetadata {
  codegen?: { translated: number; total: number };
}

export interface LoadedWasmSong {
  module: WebAssembly.Module;
  metadata: WasmSongMetadata;
}

/** Compile wasm bytes and read the embedded `sid` metadata custom section. */
export async function loadWasmSong(wasm: Uint8Array): Promise<LoadedWasmSong> {
  const module = await WebAssembly.compile(wasm as BufferSource);
  const sections = WebAssembly.Module.customSections(module, 'sid');
  if (sections.length === 0) {
    throw new Error('WASM module does not contain a "sid" metadata section');
  }
  const metadata = JSON.parse(new TextDecoder().decode(sections[0])) as WasmSongMetadata;
  return { module, metadata };
}

/** Instantiate a compiled SID WASM module (synchronous once compiled). */
export function instantiateWasmSong(loaded: LoadedWasmSong): WebAssembly.Instance {
  return new WebAssembly.Instance(loaded.module, {
    env: { whittaker: () => {} },
  });
}

export interface SongInfo {
  Name: string;
  Info: string;
  Subsong: number;
  Subsongs: number;
}

/**
 * Plays a `sid2wasm` module using the repository's existing SID synthesiser.
 *
 * The 6502 CPU runs inside WASM. SID register reads/writes are visible through
 * the exported `memory`, so the TypeScript SID device can render audio from it.
 */
export class WasmSidPlayer {
  readonly sampleRate: number;
  readonly metadata: WasmSongMetadata;
  readonly memory: Uint8Array;
  volume = 1;

  private readonly wasm: WebAssembly.Instance['exports'];
  private readonly sid: ReturnType<typeof createSID>;
  private readonly clkRatio: number;
  private readonly samplePeriod: number;

  private subtune = 0;
  private playAddress = 0;
  private frameSamplePeriod = 0;
  private frameCount = 0;
  private finished = false;
  private cpuTime = 0;
  private playtime = 0;
  private timerMode = 0;

  private constructor(
    wasm: WebAssembly.Instance['exports'],
    metadata: WasmSongMetadata,
    sampleRate: number,
    memory: Uint8Array,
    sid: ReturnType<typeof createSID>,
  ) {
    this.wasm = wasm;
    this.metadata = metadata;
    this.sampleRate = sampleRate;
    this.clkRatio = C64_PAL_CPUCLK / sampleRate;
    this.samplePeriod = 1 / sampleRate;
    this.memory = memory;
    this.sid = sid;
  }

  static create(loaded: LoadedWasmSong, sampleRate = 44100): WasmSidPlayer {
    const clkRatio = C64_PAL_CPUCLK / sampleRate;
    const whittakerHolder = { fn: (_addr: number) => {} };
    const instance = new WebAssembly.Instance(loaded.module, {
      env: { whittaker: (addr: number) => whittakerHolder.fn(addr) },
    });
    const wasm = instance.exports as WebAssembly.Instance['exports'];
    const memoryExport = wasm.memory as WebAssembly.Memory;
    const memory = new Uint8Array(memoryExport.buffer as ArrayBuffer, 0, 0x10000);
    const sid = createSID(memory, sampleRate, clkRatio, loaded.metadata.sidModels);
    whittakerHolder.fn = (addr: number) => sid.whittakerPlayerWorkaround(addr);
    return new WasmSidPlayer(wasm, loaded.metadata, sampleRate, memory, sid);
  }

  get playtimeSeconds(): number {
    return this.playtime;
  }

  get subsong(): number {
    return this.subtune;
  }

  get subtunes(): number {
    return this.metadata.songs;
  }

  get songInfo(): SongInfo {
    return {
      Name: `${this.metadata.author} - ${this.metadata.title}`,
      Info: this.metadata.released,
      Subsong: this.subtune,
      Subsongs: this.metadata.songs,
    };
  }

  get finishedPlayback(): boolean {
    return this.finished;
  }

  /** Initialise the SID and run the song's init routine. */
  init(subtune = 0): void {
    this.subtune = Math.max(0, Math.floor(subtune)) % this.metadata.songs;
    this.timerMode = (this.metadata.speed >>> this.subtune) & 1;

    // Match src/sid.ts: clear SID state before running the init routine.
    this.sid.init();
    (this.wasm.init as (subtune: number) => void)(this.subtune);

    if (this.timerMode || this.memory[0xdc05]) {
      if (!this.memory[0xdc05]) {
        this.memory[0xdc04] = 0x24;
        this.memory[0xdc05] = 0x40;
      }
      this.frameSamplePeriod = (this.memory[0xdc04] + this.memory[0xdc05] * 256) / this.clkRatio;
    } else {
      this.frameSamplePeriod = this.sampleRate / PAL_FRAMERATE;
    }

    if (this.metadata.playAddress) {
      this.playAddress = this.metadata.playAddress;
      if (this.playAddress >= 0xe000 && this.memory[1] === 0x37) {
        this.memory[1] = 0x35;
      }
    } else {
      this.playAddress =
        (this.memory[1] & 3) < 2
          ? this.memory[0xfffe] + this.memory[0xffff] * 256
          : this.memory[0x314] + this.memory[0x315] * 256;
    }

    (this.wasm.reset_cpu as (pc: number) => void)(this.playAddress);
    this.frameCount = 1;
    this.finished = false;
    this.cpuTime = 0;
    this.playtime = 0;
  }

  /** Produce exactly one mono audio sample. */
  play(): number {
    this.frameCount--;
    this.playtime += this.samplePeriod;

    if (this.frameCount <= 0) {
      this.frameCount = this.frameSamplePeriod;
      this.finished = false;
      (this.wasm.start_frame as (pc: number) => void)(this.playAddress);
    }

    if (!this.finished) {
      const spent = (this.wasm.run as (maxCycles: number) => number)(this.clkRatio - this.cpuTime);
      this.cpuTime += spent - this.clkRatio;

      const flags = (this.wasm.take_flags as () => number)();
      if ((flags & 8 || flags & 16) && this.memory[1] & 3 && this.timerMode) {
        this.frameSamplePeriod = (this.memory[0xdc04] + this.memory[0xdc05] * 256) / this.clkRatio;
      }

      if ((this.wasm.halted as () => number)() !== 0) {
        this.finished = true;
      }
    }

    let mix = this.sid.emulate(0, 0xd400);
    const sid2 = this.metadata.sidAddresses[1];
    const sid3 = this.metadata.sidAddresses[2];
    if (sid2) mix += this.sid.emulate(1, sid2);
    if (sid3) mix += this.sid.emulate(2, sid3);

    const amount = (sid2 ? 1 : 0) + (sid3 ? 1 : 0);
    return mix * this.volume * SID_AMOUNT_VOL[amount]!;
  }

  /** Render `seconds` of mono audio. */
  render(seconds: number): Float32Array {
    const samples = Math.max(0, Math.floor(seconds * this.sampleRate));
    const output = new Float32Array(samples);
    for (let i = 0; i < samples; i++) output[i] = this.play();
    return output;
  }
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
