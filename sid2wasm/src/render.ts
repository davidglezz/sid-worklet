/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeWav, loadWasmSong, WasmSidPlayer } from './player.ts';

const HELP = `Usage: node sid2wasm/src/render.ts <song.wasm> [options]

Render a module produced by sid2wasm to a WAV file.

Options:
  -o, --output <file>   Output .wav path (default: <song>.wav)
  -s, --seconds <n>     Duration in seconds (default: 5)
      --subsong <n>     Zero-based subtune (default: 0)
      --rate <n>        Sample rate (default: 44100)
      --quiet           Do not print the summary
  -h, --help            Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      seconds: { type: 'string', short: 's', default: '5' },
      subsong: { type: 'string', default: '0' },
      rate: { type: 'string', default: '44100' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP.trimEnd());
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (positionals.length > 1) {
    throw new Error(`Expected one input file, got ${positionals.length}`);
  }

  const input = resolve(positionals[0]!);
  const output = values.output
    ? resolve(values.output)
    : join(dirname(input), `${basename(input, extname(input))}.wav`);
  const seconds = Number(values.seconds);
  const subsong = Number(values.subsong);
  const sampleRate = Number(values.rate);

  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid --seconds');
  if (!Number.isInteger(subsong) || subsong < 0) throw new Error('Invalid --subsong');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid --rate');

  const loaded = await loadWasmSong(new Uint8Array(readFileSync(input)));
  const player = WasmSidPlayer.create(loaded, sampleRate);
  player.init(subsong);
  const samples = player.render(seconds);
  writeFileSync(output, encodeWav(samples, sampleRate));

  if (!values.quiet) {
    console.log(`${output}`);
    console.log(
      `${seconds}s @ ${sampleRate} Hz, subsong ${subsong}/${player.subtunes}, ` +
        `${samples.length} samples`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
