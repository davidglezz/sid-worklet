import { readFileSync } from 'node:fs';
import type { Buffer } from 'node:buffer';
import { describe, it } from 'vitest';
import { jsSID as ReferenceSID } from './sid.reference-implementation.js';
import { SIDPlayer } from './sid.ts';

describe('test SID', () => {
  describe.each([
    ['adsrtest', ''],
    ['combwformtst', ''],
    ['ctfcurvedsaw', ''],
    ['cutoffcurve', ''],
    ['dactest', ''],
    ['delaybug', ''],
    ['filtertest', ''],
    ['fltphasetest', ''],
    ['noisewfsweep', ''],
    ['pulseclartst', ''],
    ['resodistest', ''],
    ['resoscaletst', ''],
    ['sawclaritest', ''],
    ['sawscaletest', ''],
    ['sndstarttest', ''],
  ])('%s', (file, _sha256) => {
    it(`progressive compare ${file}`, ({ expect }) => {
      const sampleRate = 44100;
      const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));

      const referenceSID = new (ReferenceSID as any)(sampleRate, 0);
      referenceSID.load(songBytes);

      const sid = SIDPlayer(sampleRate);
      sid.load(songBytes);

      let maxSamples = sampleRate * 2; // 2 seconds
      while (!referenceSID.isEndded() && maxSamples--) {
        const expected = referenceSID.play();
        const actual = sid.play();
        expect(actual).toEqual(expected);
      }
    });
  });
});

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
