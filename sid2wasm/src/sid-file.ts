/**
 * PSID/RSID header parsing.
 *
 * The returned `image` is the C64 memory image that must be placed at
 * `imageAddress` inside the 64 KiB address space before the init routine runs.
 */

export interface SidMetadata {
  /** PSID version (1..4). */
  version: number;
  /** Offset of the C64 data in the original file. */
  dataOffset: number;
  /** C64 address where the image is loaded. */
  loadAddress: number;
  /** Address of the init routine. */
  initAddress: number;
  /** Address of the play routine (0 means "use the IRQ vector"). */
  playAddress: number;
  /** Number of subtunes. */
  songs: number;
  /** Default subtune (1-based in the file). */
  startSong: number;
  /** Speed bitmask (one bit per subtune; 1 = CIA timer, 0 = VBlank). */
  speed: number;
  title: string;
  author: string;
  released: string;
  /** SID chip model per SID socket (6581 or 8580). */
  sidModels: [number, number, number];
  /** SID base address per socket (0 when unused). */
  sidAddresses: [number, number, number];
  /** First C64 address covered by `image`. */
  imageAddress: number;
  /** Number of bytes in `image`. */
  imageLength: number;
}

export interface ParsedSid {
  metadata: SidMetadata;
  image: Uint8Array;
  /** Original file bytes (useful for diagnostics). */
  source: Uint8Array;
}

const HEADER_SIZE = 0x7c;
const MEMORY_SIZE = 0x10000;

export function parseSid(source: Uint8Array): ParsedSid {
  if (source.length < HEADER_SIZE) {
    throw new Error(`SID file is too short (${source.length} bytes)`);
  }

  const magic = ascii(source, 0, 4);
  if (magic !== 'PSID' && magic !== 'RSID') {
    throw new Error(`Not a PSID/RSID file (magic: ${JSON.stringify(magic)})`);
  }

  const version = readU16BE(source, 4);
  const dataOffset = readU16BE(source, 6);

  if (dataOffset < HEADER_SIZE || dataOffset >= source.length) {
    throw new Error(`Invalid SID data offset: ${dataOffset}`);
  }

  // PSID spec: when the header load address is zero, the first two bytes at
  // dataOffset contain the actual load address and the image starts after them.
  const headerLoadAddress = readU16BE(source, 8);
  let loadAddress: number;
  let dataStart: number;
  if (headerLoadAddress !== 0) {
    loadAddress = headerLoadAddress;
    dataStart = dataOffset;
  } else {
    loadAddress = readU16LE(source, dataOffset);
    dataStart = dataOffset + 2;
  }

  const initAddress = readU16BE(source, 0x0a) || loadAddress;
  const playAddress = readU16BE(source, 0x0c);
  const songs = source[0x0f] || 1;
  const startSong = source[0x10] || 1;
  const speed = readU32BE(source, 0x12);

  const sidModels: [number, number, number] = [
    (source[0x77] & 0x30) >= 0x20 ? 8580 : 6581,
    (source[0x77] & 0xc0) >= 0x80 ? 8580 : 6581,
    (source[0x76] & 0x03) >= 0x03 ? 8580 : 6581,
  ];

  const sidAddresses: [number, number, number] = [
    0xd400,
    isSidAddress(source[0x7a]) ? 0xd000 + source[0x7a] * 16 : 0,
    isSidAddress(source[0x7b]) ? 0xd000 + source[0x7b] * 16 : 0,
  ];

  const image = source.slice(
    dataStart,
    Math.min(source.length, dataStart + MEMORY_SIZE - loadAddress),
  );

  return {
    metadata: {
      version,
      dataOffset,
      loadAddress,
      initAddress,
      playAddress,
      songs,
      startSong,
      speed,
      title: readCString(source, 0x16, 32),
      author: readCString(source, 0x36, 32),
      released: readCString(source, 0x56, 32),
      sidModels,
      sidAddresses,
      imageAddress: loadAddress,
      imageLength: image.length,
    },
    image,
    source,
  };
}

/** True when a SID address nibble from the header points to a usable SID. */
function isSidAddress(value: number): boolean {
  return value >= 0x42 && (value < 0x80 || value >= 0xe0);
}

function readU16BE(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

function readU16LE(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readU32BE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3]) >>>
    0
  );
}

function readCString(buffer: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = Math.min(offset + length, buffer.length);
  while (end < max && buffer[end] !== 0) end++;
  return ascii(buffer, offset, end - offset).trim();
}

function ascii(buffer: Uint8Array, offset: number, length: number): string {
  let result = '';
  for (let i = offset; i < offset + length && i < buffer.length; i++) {
    result += String.fromCharCode(buffer[i]!);
  }
  return result;
}
