/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { SIDPlayer } from '../../src/sid.ts';
import { compileSid } from '../src/compiler.ts';
import { loadWasmSong, WasmSidPlayer } from '../src/player.ts';

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
];

for (const name of SONGS) {
  test(`differential: ${name}`, async () => {
    const bytes = new Uint8Array(readFileSync(`../test-songs/${name}.sid`));
    const compiled = await compileSid(bytes);
    const loaded = await loadWasmSong(compiled.wasm);

    const reference = SIDPlayer(44100);
    reference.load(bytes.buffer as ArrayBuffer);

    const wasm = WasmSidPlayer.create(loaded, 44100);
    wasm.init(0);

    let maxDiff = 0;
    for (let i = 0; i < 44100; i++) {
      const expected = reference.play();
      const actual = wasm.play();
      const diff = Math.abs(expected - actual);
      if (diff > maxDiff) maxDiff = diff;
    }

    strictEqual(maxDiff, 0, `${name}: max sample diff ${maxDiff}`);
  });
}
