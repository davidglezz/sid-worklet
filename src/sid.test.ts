import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
// @ts-expect-error - no types
import { jsSID as ReferenceSID } from './sid.reference-implementation.js';
import { SIDPlayer } from './sid.ts';
import { toArrayBuffer } from './utils.ts';

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
    it(`progressive compare`, ({ expect }) => {
      const sampleRate = 44100;
      const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));

      const referenceSID = new ReferenceSID(sampleRate, 0);
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
