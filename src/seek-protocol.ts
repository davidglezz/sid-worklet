import type { SidSnapshot } from './sid-snapshot.ts';

export type SeekWorkerRequest =
  | { id: 'load'; songData: ArrayBuffer; sampleRate: number; subtune?: number }
  | { id: 'setSubsong'; value: number }
  | { id: 'seek'; requestId: number; target: number };

export type SeekWorkerResponse =
  | { id: 'seeked'; requestId: number; snapshot: SidSnapshot }
  | { id: 'error'; message: string };
