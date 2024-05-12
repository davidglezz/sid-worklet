import type { LogEvent } from './audio-player.ts';
import { AudioPlayer } from './audio-player.ts';
import { AudioVisualizer } from './audio-visualizer.ts';

const icons = {
  play: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>play</title><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>`,
  stop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>stop</title><path d="M18,18H6V6H18V18Z" /></svg>`,
};

const parts = {
  visualizer: document.querySelector<HTMLCanvasElement>('#visualizer')!,
  play: document.querySelector<HTMLButtonElement>('#play')!,
  position: document.querySelector<HTMLInputElement>('#position')!,
  positionLabel: document.querySelector<HTMLInputElement>('[for=position]')!,
  volume: document.querySelector<HTMLInputElement>('#volume')!,
  volumeLabel: document.querySelector<HTMLInputElement>('[for=volume]')!,
  songlist: document.querySelector<HTMLDivElement>('#songlist')!,
};

parts.play.innerHTML = icons.play;

const player = new AudioPlayer();
const visualizer = new AudioVisualizer(player.context, parts.visualizer, 'sinewave');

player.on('log', ({ severity, message }: LogEvent) => console[severity](message)); // eslint-disable-line no-console
player.on('ready', async () => {
  player.connectVisualizer(visualizer.getNode());
  await displaySongList();
  load(location.hash.slice(1));
});
player.on('position', e => (parts.position.value = String(e.value)));
player.on('statechange', audioCtx => {
  parts.play.innerHTML = icons[audioCtx.state === 'running' ? 'stop' : 'play'];
});
player.on('songInfo', ({ songInfo }) => {
  parts.positionLabel.textContent = songInfo.Name;
  //parts.position.step = String(1 / songInfo.Positions.length);
  console.log(songInfo); // eslint-disable-line no-console
});
parts.visualizer.onclick = async () => visualizer.next();
parts.play.onclick = async () => player.togglePlay();
parts.volume.oninput = event => {
  const value = (event.target as HTMLInputElement).value;
  player.setVolume(Number(value));
  parts.volumeLabel.textContent = `${Math.round(Number(value) * 100)}%`;
};
parts.position.oninput = event => {
  player.setPosition(Number((event.target as HTMLInputElement).value));
};
window.onhashchange = () => play(location.hash.slice(1));

async function load(songName: string) {
  if (!songName) {
    return;
  }
  parts.songlist.querySelector('.active')?.classList.remove('active');
  parts.songlist.querySelector(`[href="#${songName}"]`)?.classList.add('active');
  await player.load(`https://modland.com/pub/modules/${songName}`);
}

async function play(songName: string) {
  await load(songName);
  player.play();
}

interface Song {
  size: string;
  path: string;
  name: string;
  format: string;
}
async function loadSongList(): Promise<Song[]> {
  const regex = /^(?<size>\d+)\s(?<path>.*)\/(?<name>.+)\.(?<format>.+)/;
  const response = await fetch('songlist.txt');
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map(line => regex.exec(line)?.groups)
    .filter(Boolean) as unknown as Song[];
}

async function displaySongList() {
  const list = document.querySelector<HTMLDListElement>('#songlist')!;
  const listContent = document.createElement('div');

  const songs = await loadSongList();
  Object.entries(Object.groupBy(songs, (s: Song) => s.path)).forEach(
    ([path, songs]: [string, Song[] | undefined]) => {
      if (!songs) return;
      const section = document.createElement('section');
      list.appendChild(section);

      section.style.containIntrinsicBlockSize = `${2.75 * (songs.length + 1)}rem`;

      const title = document.createElement('h3');
      title.textContent = path;
      section.appendChild(title);

      songs.forEach(({ name, format }) => {
        const relativeUrl = `${path}/${name}.${format}`;
        const a = document.createElement('a');
        a.dataset.song = relativeUrl;
        a.textContent = name;
        a.href = `#${relativeUrl}`;
        section.appendChild(a);
      });
    },
  );
  list.appendChild(listContent);
}
