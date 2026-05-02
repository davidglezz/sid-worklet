import { createWriteStream } from 'node:fs';
import { exit } from 'node:process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const SONG_LENGTHS_URL = 'https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.txt';
const outputFile = 'public/songlist.txt';

async function* convertSonglengthsLines(lines: AsyncIterable<string>): AsyncGenerator<string> {
  const iter = lines[Symbol.asyncIterator]();

  // Skip the "[Database]" header
  await iter.next();

  while (true) {
    const { value: pathLine, done: d1 } = await iter.next();
    if (d1) break;

    const { value: hashLine, done: d2 } = await iter.next();
    if (d2) break;

    if (!pathLine.startsWith('; ')) throw new Error(`Error with the line ${hashLine}.`);

    const file = pathLine.substring(2);
    const durations = hashLine.substring(33).replaceAll(' ', '\t');

    yield `${file}\t${durations}\n`;
  }
}

async function main() {
  const response = await fetch(SONG_LENGTHS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch song lengths: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is not readable');
  }

  const lines = createInterface({
    input: Readable.fromWeb(response.body as never),
    crlfDelay: Infinity,
  });
  const out = createWriteStream(outputFile, { encoding: 'utf8' });
  await pipeline(convertSonglengthsLines(lines), out);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
