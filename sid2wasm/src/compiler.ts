import wabtFactory from 'wabt';
import { generateWat } from './codegen.ts';
import { parseSid, type SidMetadata } from './sid-file.ts';

export interface CompiledSong {
  wasm: Uint8Array;
  wat: string;
  metadata: SidMetadata;
  translated: number;
  total: number;
}

export interface CompileOptions {
  /** Keep the generated WAT in the result (handy for debugging). */
  keepWat?: boolean;
}

/**
 * Compile a `.sid` file into a self-contained WebAssembly module.
 *
 * The module embeds the C64 image and exposes a small CPU API. It does not
 * synthesise audio itself; pair it with a SID emulator (see `player.ts`).
 */
export async function compileSid(
  source: Uint8Array,
  options: CompileOptions = {},
): Promise<CompiledSong> {
  const parsed = parseSid(source);
  const generated = generateWat(parsed);

  const wabt = await wabtFactory();
  const module = wabt.parseWat('song.wat', generated.wat, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    bulk_memory: true,
    reference_types: true,
    multi_value: false,
    tail_call: false,
  });

  const { buffer } = module.toBinary({
    log: false,
    canonicalize_lebs: true,
    write_debug_names: false,
  });
  module.destroy();

  const metadata = {
    ...parsed.metadata,
    codegen: {
      translated: generated.translated,
      total: generated.total,
    },
  };
  const wasm = appendCustomSection(
    new Uint8Array(buffer),
    'sid',
    new TextEncoder().encode(JSON.stringify(metadata)),
  );

  return {
    wasm,
    wat: options.keepWat ? generated.wat : '',
    metadata: parsed.metadata,
    translated: generated.translated,
    total: generated.total,
  };
}

/** Append a WebAssembly custom section (id 0). */
function appendCustomSection(binary: Uint8Array, name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const sectionBody = new Uint8Array(
    uleb128(nameBytes.length).length + nameBytes.length + payload.length,
  );
  let offset = 0;
  offset = writeUleb128(sectionBody, offset, nameBytes.length);
  sectionBody.set(nameBytes, offset);
  offset += nameBytes.length;
  sectionBody.set(payload, offset);

  const section = new Uint8Array(1 + uleb128(sectionBody.length).length + sectionBody.length);
  section[0] = 0; // custom section id
  let sectionOffset = 1;
  sectionOffset = writeUleb128(section, sectionOffset, sectionBody.length);
  section.set(sectionBody, sectionOffset);

  const result = new Uint8Array(binary.length + section.length);
  result.set(binary, 0);
  result.set(section, binary.length);
  return result;
}

function uleb128(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function writeUleb128(target: Uint8Array, offset: number, value: number): number {
  for (const byte of uleb128(value)) {
    target[offset++] = byte;
  }
  return offset;
}
