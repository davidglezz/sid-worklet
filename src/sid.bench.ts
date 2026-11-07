/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { Buffer } from 'node:buffer';
import { test, describe } from 'vitest';
import { SIDPlayer as SIDPlayerCurrent } from './sid.ts';
import { SIDPlayer as SIDPlayerBaseline } from './__bench__/sid-baseline.ts';
// @ts-ignore - This is the reference implementation in JavaScript.
import { jsSID as ReferenceSID } from './sid.reference-implementation.js';

const SAMPLE_RATE = 44100;
const BENCH_SECONDS = 2;
const SAMPLES_PER_RUN = SAMPLE_RATE * BENCH_SECONDS;

const SONGS = [
  'adsrtest',
  'combwformtst',
  'ctfcurvedsaw',
  'cutoffcurve',
  'dactest',
  'delaybug',
  'filtertest',
  'fltphasetest',
  'noisewfsweep',
  'pulseclartst',
  'resodistest',
  'resoscaletst',
  'sawclaritest',
  'sawscaletest',
  'sndstarttest',
] as const;

const songData = new Map<string, ArrayBuffer>();
for (const song of SONGS) {
  const file: Buffer<ArrayBuffer> = readFileSync(`test-songs/${song}.sid`);
  songData.set(song, toArrayBuffer(file));
}

interface BenchPlayer {
  load(data: ArrayBuffer | SharedArrayBuffer, subt?: number): void;
  play(): number;
}

function runSong(playerFactory: (sampleRate: number) => BenchPlayer, song: string) {
  const data = songData.get(song);
  if (!data) throw new Error(`Missing song data for ${song}`);

  const player = playerFactory(SAMPLE_RATE);
  player.load(data);
  for (let i = 0; i < SAMPLES_PER_RUN; i++) {
    player.play();
  }
}

function runSongReference(song: string) {
  const data = songData.get(song);
  if (!data) throw new Error(`Missing song data for ${song}`);

  const player = new (ReferenceSID as any)(SAMPLE_RATE, 0);
  player.load(data);
  for (let i = 0; i < SAMPLES_PER_RUN; i++) {
    player.play();
  }
}

describe('SID songs benchmark (real test songs)', () => {
  for (const song of SONGS) {
    {
      const _benchName = `current ${song}`;
      test(_benchName, async ({ bench }) => {
        await bench(_benchName, () => {
          runSong(SIDPlayerCurrent, song);
        }).run();
      });
    }

    {
      const _benchName2 = `baseline ${song}`;
      test(_benchName2, async ({ bench }) => {
        await bench(_benchName2, () => {
          runSong(SIDPlayerBaseline, song);
        }).run();
      });
    }

    {
      const _benchName3 = `reference ${song}`;
      test(_benchName3, async ({ bench }) => {
        await bench(_benchName3, () => {
          runSongReference(song);
        }).run();
      });
    }
  }
});

function toArrayBuffer(buffer: Buffer<ArrayBuffer>) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
