/** Complete player state transferred between the seek worker and the worklet. */
export interface SidSnapshot {
  memory: Uint8Array;
  cpu: ArrayBuffer;
  sid: ArrayBuffer;
  playtime: number;
  CPUtime: number;
  framecnt: number;
  frame_sampleperiod: number;
  finished: number;
  ended: number;
  playaddr: number;
  subtune: number;
}
