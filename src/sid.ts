// Based on work jsSID by Hermit (Mihaly Horvath) : https://github.com/og2t/jsSID

import { createCPU } from './cpu.ts';
import { copySidImage, parseSidHeader } from './sid-header.ts';
import { createSID } from './sid-device.ts';
import type { SidSnapshot } from './sid-snapshot.ts';

//emulated machine constants
const C64_PAL_CPUCLK = 985248; //Hz
const PAL_FRAMERATE = 50; //NTSC_FRAMERATE = 60;
const SIDamount_vol = [1, 0.6, 0.4]; //how much to attenuate with more 2SID/3SID to avoid master-output overflows

function clampSubtune(value: number, count: number): number {
  const index = Math.floor(value);
  const max = Math.max(0, count - 1);
  return Number.isFinite(index) ? Math.min(Math.max(index, 0), max) : 0;
}

export function SIDPlayer(samplerate = globalThis.sampleRate ?? 44100) {
  const clk_ratio = C64_PAL_CPUCLK / samplerate;
  const samplePeriod = 1 / samplerate;

  let title = '';
  let author = '';
  let info = '';

  const timermode = new Uint8Array(32);
  let loadaddr = 0x1000;
  let initaddr = 0x1000;
  let playaddf = 0x1003;
  let playaddr = 0x1003;
  let subtune = 0;
  let subtune_amount = 1;
  let playlength = 0;

  const SID_model = [8580, 8580, 8580];
  const SID_address = [0xd400, 0, 0];
  const memory = new Uint8Array(65536);
  let loaded = 0;
  let initialized = 0;
  let finished = 0;
  let endcallback: () => void = () => {};
  let playtime = 0;
  let ended = 0;

  //framespeed = 1;
  let frame_sampleperiod = samplerate / PAL_FRAMERATE; //samplerate/(PAL_FRAMERATE*framespeed);
  let framecnt = 1;
  let volume = 1.0;
  let CPUtime = 0;
  let SIDamount = 0;
  let sidAmountVolume = SIDamount_vol[0]!;

  const CPU = createCPU(memory);
  const SID = createSID(memory, samplerate, clk_ratio, SID_model);

  const CHECKPOINT_INTERVAL = 5; // seconds
  const MAX_CHECKPOINTS = 512; // 42 minutes at 5 s intervals
  const CHECKPOINT_PAGE_SIZE = 256;
  const CHECKPOINT_PAGE_COUNT = memory.length / CHECKPOINT_PAGE_SIZE;

  interface Checkpoint {
    playtime: number;
    cpu: ReturnType<typeof CPU.getState>;
    sid: ReturnType<typeof SID.getState>;
    /** Pages that differ from the post-init baseline, in ascending order. */
    pageIndices: Uint8Array;
    /** Concatenated 256-byte page contents. */
    pageData: Uint8Array;
    CPUtime: number;
    framecnt: number;
    frame_sampleperiod: number;
    finished: number;
    ended: number;
    playaddr: number;
    subtune: number;
  }

  let checkpoints: Checkpoint[] = [];
  const baselineMemory = new Uint8Array(memory.length);
  let nextCheckpointTime = CHECKPOINT_INTERVAL;

  function captureCheckpointPages(): Pick<Checkpoint, 'pageIndices' | 'pageData'> {
    const indices: number[] = [];
    for (let page = 0; page < CHECKPOINT_PAGE_COUNT; page++) {
      const offset = page * CHECKPOINT_PAGE_SIZE;
      for (let i = 0; i < CHECKPOINT_PAGE_SIZE; i++) {
        if (memory[offset + i] !== baselineMemory[offset + i]) {
          indices.push(page);
          break;
        }
      }
    }

    const pageIndices = Uint8Array.from(indices);
    const pageData = new Uint8Array(indices.length * CHECKPOINT_PAGE_SIZE);
    for (let n = 0; n < indices.length; n++) {
      const offset = indices[n]! * CHECKPOINT_PAGE_SIZE;
      pageData.set(
        memory.subarray(offset, offset + CHECKPOINT_PAGE_SIZE),
        n * CHECKPOINT_PAGE_SIZE,
      );
    }
    return { pageIndices, pageData };
  }

  function restoreCheckpointPages(checkpoint: Checkpoint) {
    memory.set(baselineMemory);
    for (let n = 0; n < checkpoint.pageIndices.length; n++) {
      const offset = checkpoint.pageIndices[n]! * CHECKPOINT_PAGE_SIZE;
      memory.set(
        checkpoint.pageData.subarray(n * CHECKPOINT_PAGE_SIZE, (n + 1) * CHECKPOINT_PAGE_SIZE),
        offset,
      );
    }
  }

  function unload() {
    loaded = 0;
    SID.init();
  }

  function load(data: ArrayBuffer | SharedArrayBuffer, subt?: number) {
    const filedata = new Uint8Array(data);
    //SID-file format information can be found at HVSC
    const header = parseSidHeader(filedata);
    subtune_amount = header.songs;
    subtune = clampSubtune(subt ?? header.startSong - 1, header.songs);
    loadaddr = header.loadAddress;
    for (let i = 0; i < 32; i++)
      timermode[31 - i] = filedata[0x12 + (i >> 3)] & (2 ** (7 - (i % 8)));
    memory.fill(0);
    copySidImage(filedata, header, memory);
    title = getString(filedata, 0x16);
    author = getString(filedata, 0x36);
    info = getString(filedata, 0x56);

    initaddr = filedata[0xa] + filedata[0xb] ? filedata[0xa] * 256 + filedata[0xb] : loadaddr;
    playaddr = playaddf = filedata[0xc] * 256 + filedata[0xd];
    SID_model[0] = (filedata[0x77] & 0x30) >= 0x20 ? 8580 : 6581;
    SID_model[1] = (filedata[0x77] & 0xc0) >= 0x80 ? 8580 : 6581;
    SID_model[2] = (filedata[0x76] & 3) >= 3 ? 8580 : 6581;
    SID_address[1] =
      filedata[0x7a] >= 0x42 && (filedata[0x7a] < 0x80 || filedata[0x7a] >= 0xe0)
        ? 0xd000 + filedata[0x7a] * 16
        : 0;
    SID_address[2] =
      filedata[0x7b] >= 0x42 && (filedata[0x7b] < 0x80 || filedata[0x7b] >= 0xe0)
        ? 0xd000 + filedata[0x7b] * 16
        : 0;
    SIDamount = 0;
    if (SID_address[1] > 0) SIDamount++;
    if (SID_address[2] > 0) SIDamount++;
    sidAmountVolume = SIDamount_vol[SIDamount]!;
    loaded = 1;
    init(subtune);
  }

  function init(subt: number) {
    if (loaded) {
      initialized = 0;
      subtune = clampSubtune(subt, subtune_amount);
      CPU.init(initaddr, subtune);
      SID.init();
      memory[1] = 0x37;
      memory[0xdc05] = 0;
      for (let timeout = 100000; timeout >= 0; timeout--) {
        if (CPU.tick()) break;
      }
      if (timermode[subtune] || memory[0xdc05]) {
        //&& playaddf {   //CIA timing
        if (!memory[0xdc05]) {
          memory[0xdc04] = 0x24;
          memory[0xdc05] = 0x40;
        }
        frame_sampleperiod = (memory[0xdc04] + memory[0xdc05] * 256) / clk_ratio;
      } else frame_sampleperiod = samplerate / PAL_FRAMERATE;
      //Vsync timing
      //frame_sampleperiod = (memory[0xDC05]!=0 || (!timermode[subtune] && playaddf))? samplerate/PAL_FRAMERATE : (memory[0xDC04] + memory[0xDC05]*256) / clk_ratio;
      if (playaddf === 0)
        playaddr =
          (memory[1] & 3) < 2
            ? memory[0xfffe] + memory[0xffff] * 256
            : memory[0x314] + memory[0x315] * 256;
      else {
        playaddr = playaddf;
        if (playaddr >= 0xe000 && memory[1] === 0x37) memory[1] = 0x35;
      }

      CPU.init(playaddr);
      baselineMemory.set(memory);
      framecnt = 1;
      finished = 0;
      CPUtime = 0;
      playtime = 0;
      ended = 0;
      checkpoints = [];
      nextCheckpointTime = CHECKPOINT_INTERVAL;
      initialized = 1;
    }
  }

  function play() {
    if (loaded && initialized) {
      framecnt--;
      playtime += samplePeriod;
      if (framecnt <= 0) {
        framecnt = frame_sampleperiod;
        finished = 0;
        CPU.PC = playaddr;
        CPU.SP = 0xff;
      }
      if (finished === 0) {
        const timerMode = timermode[subtune];
        const sid1 = SID_address[1];
        const sid2 = SID_address[2];
        while (CPUtime <= clk_ratio) {
          const pPC = CPU.PC;
          if (CPU.tick() >= 0xfe) {
            finished = 1;
            break;
          }
          CPUtime += CPU.cycles;
          const PC = CPU.PC;
          const bank = memory[1] & 3;
          if (bank > 1 && pPC < 0xe000 && (PC === 0xea31 || PC === 0xea81)) {
            finished = 1;
            break;
          }
          const addr = CPU.addr;
          //IRQ player ROM return handling
          if ((addr === 0xdc05 || addr === 0xdc04) && bank && timerMode) {
            frame_sampleperiod = (memory[0xdc04] + memory[0xdc05] * 256) / clk_ratio;
          }
          CPU.galwayRubiconWorkaround(sid1, sid2);
          SID.whittakerPlayerWorkaround(addr);
        }
        CPUtime -= clk_ratio;
      }
    }

    if (playlength > 0 && (playtime | 0) === (playlength | 0) && ended === 0) {
      ended = 1;
      endcallback();
    }
    let mix = SID.emulate(0, 0xd400);
    if (SID_address[1]) mix += SID.emulate(1, SID_address[1]);
    if (SID_address[2]) mix += SID.emulate(2, SID_address[2]);

    // Save a checkpoint at each CHECKPOINT_INTERVAL boundary, storing only the
    // pages that differ from the post-init baseline.
    if (playtime >= nextCheckpointTime) {
      nextCheckpointTime += CHECKPOINT_INTERVAL;
      if (checkpoints.length >= MAX_CHECKPOINTS) checkpoints.shift();
      const { pageIndices, pageData } = captureCheckpointPages();
      checkpoints.push({
        playtime,
        cpu: CPU.getState(),
        sid: SID.getState(),
        pageIndices,
        pageData,
        CPUtime,
        framecnt,
        frame_sampleperiod,
        finished,
        ended,
        playaddr,
        subtune,
      });
    }

    return mix * volume * sidAmountVolume;
  }

  /**
   * Fill `left`/`right` with `length` mono samples.
   *
   * This is the batch entry point used by the AudioWorklet; it keeps the
   * per-sample loop inside the player instead of crossing the closure boundary
   * once per sample from the worklet.
   */
  function render(left: Float32Array, right: Float32Array, length: number) {
    for (let i = 0; i < length; i++) {
      const value = play();
      left[i] = value;
      right[i] = value;
    }
  }

  function seek(seconds: number) {
    if (!loaded) return;
    const targetSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

    // Find the latest checkpoint at or before the target time.
    const cpIndex = checkpoints.findLastIndex((cp) => cp.playtime <= targetSeconds);

    let startSamples: number;
    if (cpIndex >= 0) {
      // Restore checkpoint state without calling init().
      const cp = checkpoints[cpIndex]!;
      restoreCheckpointPages(cp);
      CPU.setState(cp.cpu);
      SID.setState(cp.sid);
      playtime = cp.playtime;
      CPUtime = cp.CPUtime;
      framecnt = cp.framecnt;
      frame_sampleperiod = cp.frame_sampleperiod;
      finished = cp.finished;
      ended = cp.ended;
      playaddr = cp.playaddr;
      subtune = cp.subtune;
      startSamples = Math.floor(cp.playtime * samplerate);
    } else {
      // No usable checkpoint: restart from the beginning.
      init(subtune);
      startSamples = 0;
    }

    nextCheckpointTime = (Math.floor(playtime / CHECKPOINT_INTERVAL) + 1) * CHECKPOINT_INTERVAL;
    const targetSamples = Math.floor(targetSeconds * samplerate);
    for (let i = startSamples; i < targetSamples; i++) {
      play();
    }
  }

  function setEndCallback(callback: () => void, seconds: number) {
    endcallback = callback;
    playlength = seconds;
  }

  function getSnapshot(): SidSnapshot {
    return {
      memory: memory.slice(),
      cpu: CPU.getState(),
      sid: SID.getState(),
      playtime,
      CPUtime,
      framecnt,
      frame_sampleperiod,
      finished,
      ended,
      playaddr,
      subtune,
    };
  }

  function setSnapshot(snapshot: SidSnapshot) {
    memory.set(snapshot.memory);
    CPU.setState(snapshot.cpu);
    SID.setState(snapshot.sid);
    playtime = snapshot.playtime;
    CPUtime = snapshot.CPUtime;
    framecnt = snapshot.framecnt;
    frame_sampleperiod = snapshot.frame_sampleperiod;
    finished = snapshot.finished;
    ended = snapshot.ended;
    playaddr = snapshot.playaddr;
    subtune = snapshot.subtune;
    nextCheckpointTime = (Math.floor(playtime / CHECKPOINT_INTERVAL) + 1) * CHECKPOINT_INTERVAL;
    initialized = 1;
  }

  return {
    unload,
    load,
    init,
    play,
    render,
    seek,
    getSnapshot,
    setSnapshot,
    get playtime() {
      return playtime;
    },
    get volume() {
      return volume;
    },
    set volume(value) {
      volume = value;
    },
    get subtunes() {
      return subtune_amount;
    },
    get subtune() {
      return subtune;
    },
    get title() {
      return title;
    },
    get author() {
      return author;
    },
    get info() {
      return info;
    },
    isEnded: () => ended === 1,
    SID_model,
    setEndCallback,
  };
}

function getString(buffer: Uint8Array, startOffset: number) {
  const maxOffset = startOffset + 32;
  let endOffset = startOffset;

  while (endOffset < maxOffset && buffer[endOffset] !== 0) {
    endOffset++;
  }

  return String.fromCharCode(...buffer.subarray(startOffset, endOffset));
}
