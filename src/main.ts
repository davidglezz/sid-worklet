import type { LogEvent, PlayerErrorEvent } from './audio-player.ts';
import { AudioPlayer } from './audio-player.ts';
import { AudioVisualizer } from './audio-visualizer.ts';
import { formatTime, parseDuration, parseSongLine } from './utils.ts';
import type { Song } from './utils.ts';

const appRoot = document.getElementById('app')!;
const el = <T extends HTMLElement>(selector: string) => appRoot.querySelector<T>(selector)!;
const parts = {
  visualizer: el<HTMLCanvasElement>('#visualizer'),
  play: el<HTMLButtonElement>('#play'),
  position: el<HTMLInputElement>('#position'),
  time: el<HTMLLabelElement>('[for=position]'),
  subsong: el<HTMLSelectElement>('#subsong'),
  title: el<HTMLSpanElement>('#title'),
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
  parts.title.textContent = songInfo.Name;
  parts.title.classList.remove('title--error');
  setupSubsongSelector(songInfo.Subsongs);
  if (typeof songInfo.Subsong === 'number') {
    parts.subsong.value = String(songInfo.Subsong);
    parts.position.max = `${getCurrentDuration()}`;
  }
  updateTimeIndicator();
  console.log(songInfo); // eslint-disable-line no-console
});
player.on('error', ({ error }: PlayerErrorEvent) => {
  parts.title.textContent = `⚠ ${error.message}`;
  parts.title.classList.add('title--error');
});
parts.visualizer.onclick = async () => visualizer.next();
parts.play.onclick = async () => player.togglePlay();
parts.volume.oninput = (event) => {
  const value = (event.target as HTMLInputElement).value;
  applyVolume(Number(value));
};

/** Clamps volume to [0,1], updates the slider, label and player gain. */
function applyVolume(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  parts.volume.value = String(clamped);
  void player.setVolume(clamped);
  parts.volumeLabel.textContent = `${Math.round(clamped * 100)}%`;
}

/** Volume level remembered before muting, restored on un-mute. */
let volumeBeforeMute = 1;

/** Returns true when the event target is an editable control. */
function isEditableTarget(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

window.addEventListener('keydown', (e) => {
  if (isEditableTarget(e)) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      void player.togglePlay();
      break;
    case 'ArrowLeft': {
      e.preventDefault();
      const pos = Math.max(0, Number(parts.position.value) - 5);
      parts.position.value = String(pos);
      updateTimeIndicator();
      player.setPosition(pos);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const max = Number(parts.position.max);
      const pos =
        max > 0
          ? Math.min(max, Number(parts.position.value) + 5)
          : Number(parts.position.value) + 5;
      parts.position.value = String(pos);
      updateTimeIndicator();
      player.setPosition(pos);
      break;
    }
    case 'ArrowUp':
      e.preventDefault();
      applyVolume(Number(parts.volume.value) + 0.1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      applyVolume(Number(parts.volume.value) - 0.1);
      break;
    case 'm':
    case 'M': {
      const current = Number(parts.volume.value);
      if (current > 0) {
        volumeBeforeMute = current;
        applyVolume(0);
      } else {
        applyVolume(volumeBeforeMute);
      }
      break;
    }
  }
});
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
  const total = Number(parts.position.max) | 0;
  const currentPosition = Number(parts.position.value) | 0;
  parts.time.textContent = `${formatTime(currentPosition)} / ${formatTime(total)}`;
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
