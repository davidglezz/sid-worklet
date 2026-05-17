import { bench, describe } from 'vitest';
import { createCPU } from './cpu';
import { createCPU as createCPUBaseline } from './__bench__/cpu-baseline';
import { createSID } from './sid-device';
import { createSID as createSIDBaseline } from './__bench__/sid-device-baseline';

const MEM_SIZE = 65536;
const CPU_TICKS = 4096;
const SID_CALLS = 2048;

function setupCPU(createFn: typeof createCPU | typeof createCPUBaseline) {
  const mem = new Uint8Array(MEM_SIZE);
  mem[0x1000] = 0xea; // NOP
  const cpu = createFn(mem);
  cpu.init(0x1000);
  return { cpu, mem };
}

function setupSID(createFn: typeof createSID | typeof createSIDBaseline) {
  const mem = new Uint8Array(MEM_SIZE);
  const base = 0xd400;
  const sid = createFn(mem, 44100, 22, [8580, 8580, 8580]);
  sid.init();

  // Voice 1 setup to keep a non-trivial deterministic signal path.
  mem[base + 0] = 0x00;
  mem[base + 1] = 0x20;
  mem[base + 2] = 0x00;
  mem[base + 3] = 0x08;
  mem[base + 4] = 0x41; // pulse + gate
  mem[base + 5] = 0x21;
  mem[base + 6] = 0xf0;
  // Filter + volume
  mem[base + 0x15] = 0x80;
  mem[base + 0x16] = 0x80;
  mem[base + 0x17] = 0xf7;
  mem[base + 0x18] = 0x0f;

  return { sid, base };
}

describe('CPU Benchmark', () => {
  const { cpu: currentCpu } = setupCPU(createCPU);
  const { cpu: baselineCpu } = setupCPU(createCPUBaseline);

  bench('current cpu', () => {
    for (let i = 0; i < CPU_TICKS; i++) {
      currentCpu.tick();
    }
  });

  bench('baseline cpu', () => {
    for (let i = 0; i < CPU_TICKS; i++) {
      baselineCpu.tick();
    }
  });
});

describe('SID Benchmark', () => {
  const { sid: currentSid, base } = setupSID(createSID);
  const { sid: baselineSid } = setupSID(createSIDBaseline);

  bench('current sid', () => {
    for (let i = 0; i < SID_CALLS; i++) {
      currentSid.emulate(0, base);
    }
  });

  bench('baseline sid', () => {
    for (let i = 0; i < SID_CALLS; i++) {
      baselineSid.emulate(0, base);
    }
  });
});
