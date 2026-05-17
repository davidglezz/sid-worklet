/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { Buffer } from 'node:buffer';
import { bench, describe } from 'vitest';
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

function runSong(
  playerFactory: (sampleRate: number) => ReturnType<typeof SIDPlayerCurrent>,
  song: string,
) {
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
    bench(`current ${song}`, () => {
      runSong(SIDPlayerCurrent, song);
    });

    bench(`baseline ${song}`, () => {
      runSong(SIDPlayerBaseline, song);
    });

    bench(`reference ${song}`, () => {
      runSongReference(song);
    });
  }
});

function toArrayBuffer(buffer: Buffer<ArrayBuffer>) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
