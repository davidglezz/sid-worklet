/// <reference types="node" />
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

describe('seek', () => {
  const file = 'adsrtest';
  const sampleRate = 44100;

  it('seek(0) produces same samples as fresh load', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);

    // Collect 100 samples from a fresh load.
    const expected: number[] = [];
    for (let i = 0; i < 100; i++) expected.push(sid.play());

    // seek(0) should reset to the same initial state.
    sid.seek(0);
    const actual: number[] = [];
    for (let i = 0; i < 100; i++) actual.push(sid.play());

    expect(actual).toEqual(expected);
  });

  it('seek(T) then play matches playing continuously from 0 to T', ({ expect }) => {
    const seekTarget = 0.5; // seconds
    const verifyCount = 200; // samples to compare after seek point
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));

    // Reference: play from 0 straight through to T + verifyCount samples.
    const ref = SIDPlayer(sampleRate);
    ref.load(songBytes);
    const targetSamples = Math.floor(seekTarget * sampleRate);
    for (let i = 0; i < targetSamples; i++) ref.play();
    const expected: number[] = [];
    for (let i = 0; i < verifyCount; i++) expected.push(ref.play());

    // Seeked player: load, seek(T), then play verifyCount samples.
    const seeked = SIDPlayer(sampleRate);
    seeked.load(songBytes);
    seeked.seek(seekTarget);
    const actual: number[] = [];
    for (let i = 0; i < verifyCount; i++) actual.push(seeked.play());

    expect(actual).toEqual(expected);
  });

  it('playtime reflects seek target', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);

    const target = 1.0;
    sid.seek(target);
    // playtime advances by 1/sampleRate per play() call so after
    // floor(target * sampleRate) calls it should be within 1 sample of target.
    expect(sid.playtime).toBeGreaterThanOrEqual(target - 1 / sampleRate);
    expect(sid.playtime).toBeLessThan(target + 1 / sampleRate);
  });

  it('seek remains absolute after partial playback', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const verifyCount = 200;

    const ref = SIDPlayer(sampleRate);
    ref.load(songBytes);
    const absoluteTarget = 0.6;
    const absoluteTargetSamples = Math.floor(absoluteTarget * sampleRate);
    for (let i = 0; i < absoluteTargetSamples; i++) ref.play();
    const expected: number[] = [];
    for (let i = 0; i < verifyCount; i++) expected.push(ref.play());

    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);
    const preRoll = Math.floor(0.2 * sampleRate);
    for (let i = 0; i < preRoll; i++) sid.play();
    sid.seek(absoluteTarget);

    const actual: number[] = [];
    for (let i = 0; i < verifyCount; i++) actual.push(sid.play());

    expect(actual).toEqual(expected);
  });

  it('seek does nothing when no song is loaded', ({ expect }) => {
    const sid = SIDPlayer(sampleRate);
    expect(() => sid.seek(1)).not.toThrow();
    // playtime should remain 0 (no advance occurred).
    expect(sid.playtime).toBe(0);
  });
});

describe('seek — edge cases', () => {
  const file = 'adsrtest';
  const sampleRate = 44100;

  it('seek to negative clamps to 0', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));

    // Reference: fresh load, collect 100 samples from position 0.
    const ref = SIDPlayer(sampleRate);
    ref.load(songBytes);
    const expected: number[] = [];
    for (let i = 0; i < 100; i++) expected.push(ref.play());

    // seek(-5) must clamp to 0 and produce the same initial samples.
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);
    sid.seek(-5);
    const actual: number[] = [];
    for (let i = 0; i < 100; i++) actual.push(sid.play());

    expect(actual).toEqual(expected);
  });

  it('seek beyond playtime advances forward', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);

    // Seek well past 0; the player must advance and not crash.
    // Using 3 s (a large-but-practical value) rather than an impractical 9 999 s.
    sid.seek(3);
    expect(sid.playtime).toBeGreaterThan(0);
  });

  it('seek does not throw when called before load', ({ expect }) => {
    const sid = SIDPlayer(sampleRate);
    expect(() => sid.seek(1)).not.toThrow();
    expect(sid.playtime).toBe(0);
  });

  it('consecutive seeks are always absolute', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const verifyCount = 100;

    // Reference: play straight through to 0.1 s, then capture samples.
    const ref = SIDPlayer(sampleRate);
    ref.load(songBytes);
    const refSamples = Math.floor(0.1 * sampleRate);
    for (let i = 0; i < refSamples; i++) ref.play();
    const expected: number[] = [];
    for (let i = 0; i < verifyCount; i++) expected.push(ref.play());

    // Seeked player: jump forward to 0.3 s, then backward to 0.1 s.
    // The second seek must be absolute (not relative to 0.3 s).
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);
    sid.seek(0.3);
    sid.seek(0.1);
    const actual: number[] = [];
    for (let i = 0; i < verifyCount; i++) actual.push(sid.play());

    expect(actual).toEqual(expected);
  });

  // This test plays 31 seconds of emulated audio to guarantee a checkpoint is
  // written at the 30 s boundary, so give it a generous wall-clock budget.
  it('checkpoint is used on forward seek past 30 s', ({ expect }) => {
    const songBytes = toArrayBuffer(readFileSync(`test-songs/${file}.sid`));
    const sid = SIDPlayer(sampleRate);
    sid.load(songBytes);

    // Advance past the first CHECKPOINT_INTERVAL (30 s) so the engine
    // saves a checkpoint, then seek to 30.5 s to exercise the restore path.
    const thirtyOneSamples = 31 * sampleRate;
    for (let i = 0; i < thirtyOneSamples; i++) sid.play();

    sid.seek(30.5);

    // playtime must land within one sample of the requested target.
    expect(sid.playtime).toBeGreaterThanOrEqual(30.5 - 1 / sampleRate);
    expect(sid.playtime).toBeLessThan(30.5 + 1 / sampleRate);
  }, 120_000); // up to 2 min — 31 s of emulated C64 audio takes real time
});

function toArrayBuffer(buffer: Buffer<ArrayBuffer>) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
