import type { LogEvent } from './audio-player.ts';
import { AudioPlayer } from './audio-player.ts';
import { AudioVisualizer } from './audio-visualizer.ts';

const appRoot = document.getElementById('app')!;
const el = <T extends HTMLElement>(selector: string) => appRoot.querySelector<T>(selector)!;
const parts = {
  visualizer: el<HTMLCanvasElement>('#visualizer'),
  play: el<HTMLButtonElement>('#play'),
  position: el<HTMLInputElement>('#position'),
  positionLabel: el<HTMLLabelElement>('[for=position]'),
  subsong: el<HTMLSelectElement>('#subsong'),
  time: el<HTMLSpanElement>('#time-indicator'),
  volume: el<HTMLInputElement>('#volume'),
  volumeLabel: el<HTMLLabelElement>('[for=volume]'),
  songlist: el<HTMLDivElement>('#songlist'),
  get currentSongLink() {
    return this.songlist.querySelector<HTMLAnchorElement>('a.active[data-song]');
  },
};

const player = new AudioPlayer();
const visualizer = new AudioVisualizer(player.context, parts.visualizer, 'sinewave');

player.on('log', ({ severity, message }: LogEvent) => console[severity](message)); // eslint-disable-line no-console
player.on('ready', async () => {
  player.connectVisualizer(visualizer.getNode());
  await displaySongList();
  const songName = location.hash.slice(1) || getRandomSong();
  await load(songName);
});
player.on('position', (e) => {
  if (!isDragging) parts.position.value = String(e.value);
  updateTimeIndicator();
});
player.on('statechange', (audioCtx) => {
  parts.play.classList.toggle('btn--playing', audioCtx.state === 'running');
});
player.on('songInfo', ({ songInfo }) => {
  parts.positionLabel.textContent = songInfo.Name;
  setupSubsongSelector(songInfo.Subsongs);
  if (typeof songInfo.Subsong === 'number') {
    parts.subsong.value = String(songInfo.Subsong);
    parts.position.max = `${getCurrentDuration()}`;
  }
  updateTimeIndicator();
  console.log(songInfo); // eslint-disable-line no-console
});
parts.visualizer.onclick = async () => visualizer.next();
parts.play.onclick = async () => player.togglePlay();
parts.volume.oninput = (event) => {
  const value = (event.target as HTMLInputElement).value;
  void player.setVolume(Number(value));
  parts.volumeLabel.textContent = `${Math.round(Number(value) * 100)}%`;
};
parts.subsong.onchange = () => {
  const value = Number(parts.subsong.value);
  parts.position.value = '0';
  parts.position.max = `${getCurrentDuration()}`;
  updateTimeIndicator();
  player.setSubsong(value);
};

// Debounce seek so rapid scrubbing only sends the last position.
let seekTimer: ReturnType<typeof setTimeout> | null = null;
let isDragging = false;
const onPointerDown = () => (isDragging = true);
parts.position.addEventListener('mousedown', onPointerDown);
parts.position.addEventListener('touchstart', onPointerDown);
const onPointerUp = () => (isDragging = false);
parts.position.addEventListener('mouseup', onPointerUp);
parts.position.addEventListener('touchend', onPointerUp);
parts.position.oninput = (event) => {
  const seconds = Number((event.target as HTMLInputElement).value);
  updateTimeIndicator();
  if (seekTimer !== null) clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    seekTimer = null;
    player.setPosition(seconds);
  }, 50);
};
window.onhashchange = () => play(location.hash.slice(1));

function getRandomSong(): string {
  const songs = parts.songlist.querySelectorAll<HTMLAnchorElement>('a[data-song]');
  return songs[Math.floor(Math.random() * songs.length)]?.dataset.song ?? '';
}

async function load(songName: string) {
  if (!songName) {
    return;
  }

  parts.currentSongLink?.classList.remove('active');
  parts.songlist
    .querySelector<HTMLAnchorElement>(`a[data-song="${CSS.escape(songName)}"]`)
    ?.classList.add('active');

  parts.subsong.value = '0';
  parts.position.value = '0';
  parts.position.max = `${getCurrentDuration()}`;
  updateTimeIndicator();
  await player.load(`https://modland.com/pub/modules/HVSC${songName}`);
}

async function play(songName: string) {
  await load(songName);
  await player.play();
}

interface Song {
  relativeUrl: string;
  path: string;
  name: string;
  durations: string[];
}

async function* streamSongList(): AsyncGenerator<Song> {
  const response = await fetch('songlist.txt');
  if (!response.ok || !response.body) {
    throw new Error('Failed to load song list');
  }
  const textStream = response.body.pipeThrough(new TextDecoderStream());

  for await (const line of splitLines(textStream)) {
    const song = parseSongLine(line);
    if (song) yield song;
  }
}

async function displaySongList() {
  let currentPath = '';
  let currentSection: HTMLElement | null = null;

  for await (const song of streamSongList()) {
    if (song.path !== currentPath) {
      currentPath = song.path;
      currentSection = document.createElement('section');
      parts.songlist.appendChild(currentSection);

      const title = document.createElement('h3');
      title.textContent = currentPath;
      currentSection.appendChild(title);
    }

    const link = document.createElement('a');
    link.dataset.song = song.relativeUrl;
    link.dataset.duration = song.durations.join(',');
    link.textContent = song.name.replaceAll('_', ' ');
    link.href = `#${song.relativeUrl}`;
    const duration =
      song.durations.length > 1
        ? formatTime(song.durations.reduce((sum, d) => sum + parseDuration(d), 0))
        : song.durations[0];
    const durationSpan = document.createElement('span');
    durationSpan.textContent = duration;
    link.appendChild(durationSpan);
    currentSection?.appendChild(link);
  }
}

function setupSubsongSelector(count: number) {
  parts.subsong.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Subsong ${i + 1}`;
    parts.subsong.appendChild(option);
  }
  parts.subsong.disabled = count <= 1;
  parts.subsong.value = '0';
}

function getCurrentDuration() {
  return parseDuration(
    (parts.currentSongLink?.dataset.duration ?? '').split(',').at(Number(parts.subsong.value)),
  );
}

function updateTimeIndicator() {
  const total = getCurrentDuration();
  const currentPosition = Number(parts.position.value);
  const clamped =
    total > 0 ? Math.min(Math.max(currentPosition, 0), total) : Math.max(currentPosition, 0);
  parts.time.textContent = `${formatTime(clamped)} / ${total > 0 ? formatTime(total) : '--:--'}`;
}

async function* splitLines(stream: ReadableStream<string>) {
  let pendingLine = '';

  for await (const chunk of stream) {
    pendingLine += chunk;

    const lines = pendingLine.split('\n');
    pendingLine = lines.pop() ?? '';

    for (const line of lines) {
      yield line;
    }
  }

  if (pendingLine) {
    yield pendingLine;
  }
}

function parseSongLine(line: string) {
  const [relativeUrl, ...durations] = line.trim().split('\t').filter(Boolean);
  if (!relativeUrl) return null;

  const pathSep = relativeUrl.lastIndexOf('/');
  const fullName = pathSep >= 0 ? relativeUrl.slice(pathSep + 1) : relativeUrl;
  const dotSep = fullName.lastIndexOf('.');

  return {
    relativeUrl,
    path: pathSep >= 0 ? relativeUrl.slice(0, pathSep) : '',
    name: dotSep >= 0 ? fullName.slice(0, dotSep) : fullName,
    durations,
  } satisfies Song;
}

function parseDuration(value: string | undefined) {
  if (!value) return 0;
  const [min, sec] = value.trim().split(':');
  const minutes = Number(min);
  const seconds = Number(sec);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return Math.max(0, minutes * 60 + seconds);
}

function formatTime(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
