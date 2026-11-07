# sid2wasm

Convert a Commodore 64 `.sid` tune into a self-contained WebAssembly module
whose 6502 CPU is **statically translated** to WebAssembly. The module embeds
the SID image and exposes a small CPU API that can be driven from JavaScript
or Node.js. Audio synthesis is performed by the existing TypeScript SID device
in `src/sid-device.ts`, so the generated `.wasm` stays small and matches the
behaviour of the in-browser player.

## Quick start

```sh
cd sid2wasm
pnpm install

# Convert a SID file
node src/cli.ts ../test-songs/adsrtest.sid -o out/adsrtest.wasm --wat out/adsrtest.wat

# Render 5 seconds of audio to WAV
node src/render.ts out/adsrtest.wasm -o out/adsrtest.wav -s 5
```

## Programmatic use (Node.js / browser)

```ts
import { readFileSync } from 'node:fs';
import { compileSid } from './sid2wasm/src/compiler.ts';
import { loadWasmSong, WasmSidPlayer } from './sid2wasm/src/player.ts';

const sidBytes = new Uint8Array(readFileSync('song.sid'));
const { wasm } = await compileSid(sidBytes);
const loaded = await loadWasmSong(wasm);
const player = WasmSidPlayer.create(loaded, 44100);
player.init(0); // subtune 0
const samples = player.render(5); // Float32Array, 5 seconds
```

## Exported WASM API

| Export              | Signature              | Description                                 |
| ------------------- | ---------------------- | ------------------------------------------- |
| `memory`            | `WebAssembly.Memory`   | 64 KiB C64 address space                    |
| `error`             | `global i32` (mutable) | Non-zero if an unsupported opcode was hit   |
| `init(subtune)`     | `() -> void`           | Run the SID init routine                    |
| `reset_cpu(pc)`     | `() -> void`           | Reset registers and start at `pc`           |
| `start_frame(pc)`   | `() -> void`           | Start a new frame at `pc` (keeps registers) |
| `run(maxCycles)`    | `(f64) -> i32`         | Run until halt or cycle budget exhausted    |
| `take_flags()`      | `() -> i32`            | SID/CIA addresses touched since last call   |
| `pc()` / `sp()`     | `() -> i32`            | Inspect registers                           |
| `halted()`          | `() -> i32`            | 1 if the play routine returned              |
| `set_pc` / `set_sp` | `(i32) -> void`        | Override registers                          |
| `addcycles(n)`      | `(i32) -> void`        | Manual cycle accounting                     |

## How it works

1. `sid-file.ts` parses the PSID/RSID header and extracts the C64 image.
2. `opcodes.ts` decodes 6502 instruction lengths and groups.
3. `codegen.ts` emits one WAT function per byte of the image. Each function
   checks that its instruction bytes still match (self-modification falls back
   to a generic interpreter), executes the instruction, and updates `$pc`.
4. `compiler.ts` assembles the WAT with `wabt` and appends a custom `sid`
   section carrying the song metadata.
5. `player.ts` wraps the module with `createSID` from `src/sid-device.ts`.

## Tests

```sh
node --test test/*.test.ts
```

The differential test renders one second of audio for every song in
`test-songs/` and asserts bit-exact equality with `SIDPlayer` from `src/sid.ts`.
