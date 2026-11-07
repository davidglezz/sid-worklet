/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compileSid } from './compiler.ts';

const HELP = `Usage: node sid2wasm/src/cli.ts <song.sid> [options]

Convert a PSID/RSID file into a standalone WebAssembly module.

Options:
  -o, --output <file>   Output .wasm path (default: <song>.wasm)
      --wat <file>      Also write the generated WAT text
      --quiet           Do not print the summary
  -h, --help            Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      wat: { type: 'string' },
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
    : join(dirname(input), `${basename(input, extname(input))}.wasm`);

  const source = new Uint8Array(readFileSync(input));
  const result = await compileSid(source, { keepWat: Boolean(values.wat) });

  writeFileSync(output, result.wasm);
  if (values.wat) {
    writeFileSync(resolve(values.wat), result.wat);
  }

  if (!values.quiet) {
    const { metadata } = result;
    const kib = (result.wasm.length / 1024).toFixed(1);
    console.log(`SID      ${metadata.title || '(untitled)'}`);
    console.log(`Author   ${metadata.author || '(unknown)'}`);
    console.log(`Released ${metadata.released || '(unknown)'}`);
    console.log(
      `Load     $${hex(metadata.loadAddress)}  init $${hex(metadata.initAddress)}  ` +
        `play $${hex(metadata.playAddress)}  songs ${metadata.songs}`,
    );
    console.log(
      `Image    ${metadata.imageLength} bytes  translated ${result.translated}/${result.total} addresses`,
    );
    console.log(`Output   ${output} (${kib} KiB)`);
  }
}

function hex(value: number): string {
  return value.toString(16).padStart(4, '0').toUpperCase();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
