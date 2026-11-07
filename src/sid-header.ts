/** PSID/RSID header fields needed to locate and load the C64 image. */
export interface SidHeader {
  /** Offset of the C64 data in the source file. */
  dataOffset: number;
  /** C64 address where the image is loaded. */
  loadAddress: number;
  /** Offset in the source where the image bytes begin. */
  dataStart: number;
}

const HEADER_SIZE = 0x7c;

/**
 * Read the fixed PSID/RSID header.
 *
 * When the header load address is zero the first two bytes at `dataOffset`
 * contain the load address (little-endian) and the image starts after them.
 * When it is non-zero the image starts at `dataOffset` and is loaded at the
 * header address.
 */
export function parseSidHeader(source: Uint8Array): SidHeader {
  if (source.length < HEADER_SIZE) {
    throw new Error(`SID file is too short (${source.length} bytes)`);
  }

  const magic = String.fromCharCode(source[0]!, source[1]!, source[2]!, source[3]!);
  if (magic !== 'PSID' && magic !== 'RSID') {
    throw new Error(`Not a PSID/RSID file (magic: ${JSON.stringify(magic)})`);
  }

  const dataOffset = readU16BE(source, 0x06);
  if (dataOffset < HEADER_SIZE || dataOffset >= source.length) {
    throw new Error(`Invalid SID data offset: ${dataOffset}`);
  }

  const headerLoadAddress = readU16BE(source, 0x08);
  if (headerLoadAddress === 0 && dataOffset + 1 >= source.length) {
    throw new Error('SID file is missing the load address');
  }

  const loadAddress = headerLoadAddress || readU16LE(source, dataOffset);
  const dataStart = headerLoadAddress ? dataOffset : dataOffset + 2;
  if (dataStart >= source.length) {
    throw new Error('SID file does not contain image data');
  }

  return { dataOffset, loadAddress, dataStart };
}

/** Copy the image bytes from `source` into the 64 KiB C64 address space. */
export function copySidImage(source: Uint8Array, header: SidHeader, memory: Uint8Array): void {
  const length = Math.min(source.length - header.dataStart, memory.length - header.loadAddress);
  if (length <= 0) return;
  memory.set(source.subarray(header.dataStart, header.dataStart + length), header.loadAddress);
}

function readU16BE(buffer: Uint8Array, offset: number): number {
  return (buffer[offset]! << 8) | buffer[offset + 1]!;
}

function readU16LE(buffer: Uint8Array, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8);
}
