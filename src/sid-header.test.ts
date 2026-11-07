import { describe, expect, it } from 'vitest';
import { SIDPlayer } from './sid.ts';
import { copySidImage, parseSidHeader } from './sid-header.ts';

interface CreateSidOptions {
  magic?: string;
  dataOffset?: number;
  headerLoadAddress?: number;
  dataLoadAddress?: number;
  image?: number[];
  songs?: number;
  startSong?: number;
}

function createSid(options: CreateSidOptions = {}): Uint8Array {
  const dataOffset = options.dataOffset ?? 0x7c;
  const headerLoadAddress = options.headerLoadAddress ?? 0;
  const dataLoadAddress = options.dataLoadAddress ?? 0x1000;
  const image = options.image ?? [0x60];
  const prefix =
    headerLoadAddress === 0 ? [dataLoadAddress & 0xff, (dataLoadAddress >> 8) & 0xff] : [];

  const buffer = new Uint8Array(dataOffset + prefix.length + image.length);
  const magic = options.magic ?? 'PSID';
  for (let i = 0; i < 4; i++) buffer[i] = magic.charCodeAt(i);
  writeU16BE(buffer, 0x04, 1);
  writeU16BE(buffer, 0x06, dataOffset);
  writeU16BE(buffer, 0x08, headerLoadAddress);
  writeU16BE(buffer, 0x0a, dataLoadAddress);
  writeU16BE(buffer, 0x0c, 0);
  writeU16BE(buffer, 0x0e, options.songs ?? 1);
  writeU16BE(buffer, 0x10, options.startSong ?? 1);
  buffer.set(prefix, dataOffset);
  buffer.set(image, dataOffset + prefix.length);
  return buffer;
}

function writeU16BE(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = (value >> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}

describe('parseSidHeader', () => {
  it('reads the load address from the data when the header address is zero', () => {
    const sid = createSid({ dataOffset: 0x7c, dataLoadAddress: 0x1000, image: [0xaa] });
    expect(parseSidHeader(sid)).toEqual({
      dataOffset: 0x7c,
      loadAddress: 0x1000,
      dataStart: 0x7e,
      songs: 1,
      startSong: 1,
    });
  });

  it('uses the header load address and starts the image at dataOffset', () => {
    const sid = createSid({ dataOffset: 0x7c, headerLoadAddress: 0x2000, image: [0xaa] });
    expect(parseSidHeader(sid)).toEqual({
      dataOffset: 0x7c,
      loadAddress: 0x2000,
      dataStart: 0x7c,
      songs: 1,
      startSong: 1,
    });
  });

  it('reads a 16-bit data offset', () => {
    const sid = createSid({ dataOffset: 0x100, dataLoadAddress: 0x1000, image: [0x60] });
    const header = parseSidHeader(sid);
    expect(header.dataOffset).toBe(0x100);
    expect(header.dataStart).toBe(0x102);
  });

  it('reads the 16-bit song count and preferred start song', () => {
    const header = parseSidHeader(createSid({ songs: 0x0102, startSong: 2 }));
    expect(header.songs).toBe(0x0102);
    expect(header.startSong).toBe(2);
  });

  it('defaults a zero song count and start song to one', () => {
    const header = parseSidHeader(createSid({ songs: 0, startSong: 0 }));
    expect(header.songs).toBe(1);
    expect(header.startSong).toBe(1);
  });

  it('rejects files with an invalid magic', () => {
    expect(() => parseSidHeader(createSid({ magic: 'NOPE' }))).toThrow(/Not a PSID/);
  });

  it('rejects files that are too short', () => {
    expect(() => parseSidHeader(new Uint8Array(8))).toThrow(/too short/);
  });

  it('rejects a data offset inside the header', () => {
    const sid = new Uint8Array(0x80);
    for (let i = 0; i < 4; i++) sid[i] = 'PSID'.charCodeAt(i);
    writeU16BE(sid, 0x06, 0x10);
    expect(() => parseSidHeader(sid)).toThrow(/data offset/);
  });

  it('rejects a missing load address', () => {
    const sid = new Uint8Array(0x7d);
    sid.set([0x50, 0x53, 0x49, 0x44], 0); // PSID
    writeU16BE(sid, 0x06, 0x7c);
    writeU16BE(sid, 0x08, 0);
    expect(() => parseSidHeader(sid)).toThrow(/load address/);
  });
});

describe('copySidImage', () => {
  it('copies from dataStart when the header has a load address', () => {
    const sid = createSid({ headerLoadAddress: 0x2000, image: [0xaa, 0xbb, 0xcc] });
    const memory = new Uint8Array(65536);
    copySidImage(sid, parseSidHeader(sid), memory);
    expect(Array.from(memory.subarray(0x2000, 0x2003))).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('skips the embedded load address when the header address is zero', () => {
    const sid = createSid({ dataLoadAddress: 0x1000, image: [0x60, 0x61] });
    const memory = new Uint8Array(65536);
    copySidImage(sid, parseSidHeader(sid), memory);
    expect(memory[0x1000]).toBe(0x60);
    expect(memory[0x1001]).toBe(0x61);
  });

  it('clips the image at the end of the 64 KiB address space', () => {
    const sid = createSid({ headerLoadAddress: 0xfffe, image: [0xaa, 0xbb, 0xcc] });
    const memory = new Uint8Array(65536);
    copySidImage(sid, parseSidHeader(sid), memory);
    expect(memory[0xfffe]).toBe(0xaa);
    expect(memory[0xffff]).toBe(0xbb);
  });
});

describe('SIDPlayer header usage', () => {
  const sampleRate = 44100;

  function createPlayableSid(): Uint8Array {
    // Init routine is a single RTS at $1000, so load() returns immediately.
    return createSid({
      headerLoadAddress: 0x1000,
      dataLoadAddress: 0x1000,
      image: [0x60],
      songs: 2,
      startSong: 2,
    });
  }

  it('starts at the preferred start song', () => {
    const sid = SIDPlayer(sampleRate);
    sid.load(createPlayableSid().buffer as ArrayBuffer);
    expect(sid.subtune).toBe(1);
    expect(sid.subtunes).toBe(2);
  });

  it('clamps explicit subtune indexes', () => {
    const sid = SIDPlayer(sampleRate);
    sid.load(createPlayableSid().buffer as ArrayBuffer, 0);
    expect(sid.subtune).toBe(0);

    sid.init(99);
    expect(sid.subtune).toBe(1);

    sid.init(-1);
    expect(sid.subtune).toBe(0);
  });
});
