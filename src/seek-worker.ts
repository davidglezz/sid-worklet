import type { SeekWorkerRequest, SeekWorkerResponse } from './seek-protocol.ts';
import { SIDPlayer } from './sid.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<SeekWorkerRequest>) => void) | null;
  postMessage(message: SeekWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
let player: ReturnType<typeof SIDPlayer> | null = null;

function post(message: SeekWorkerResponse) {
  scope.postMessage(message);
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    switch (message.id) {
      case 'load':
        player = SIDPlayer(message.sampleRate);
        player.load(message.songData, message.subtune);
        break;
      case 'setSubsong':
        player?.init(message.value);
        break;
      case 'seek':
        if (!player) {
          post({ id: 'error', message: 'No song loaded' });
          break;
        }
        player.seek(message.target);
        post({
          id: 'seeked',
          requestId: message.requestId,
          snapshot: player.getSnapshot(),
        });
        break;
    }
  } catch (error) {
    post({ id: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
