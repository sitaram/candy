/**
 * Level meter over two streams, for the voice button's ring. RMS of the time-domain signal, scaled
 * so normal speech lands near 1. `mixed` is whoever is louder — the ring; `local` is the mic alone —
 * "hearing you". No React: returns a stop function.
 */

export interface Levels { mixed: number; local: number }

const GAIN = 4;

export function rmsOf(buf: Uint8Array): number {
  let s = 0;
  for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
  return Math.sqrt(s / buf.length);
}

export function toLevels(remoteRms: number, localRms: number): Levels {
  return { mixed: Math.min(1, Math.max(remoteRms, localRms) * GAIN), local: Math.min(1, localRms * GAIN) };
}

export function startMeter(remote: MediaStream, local: MediaStream, onLevels: (l: Levels) => void): () => void {
  const ac = new AudioContext();
  const mk = (s: MediaStream) => { const a = ac.createAnalyser(); a.fftSize = 256; ac.createMediaStreamSource(s).connect(a); return a; };
  const ar = mk(remote), al = mk(local);
  const buf = new Uint8Array(128);
  const read = (a: AnalyserNode) => { a.getByteTimeDomainData(buf); return rmsOf(buf); };
  let raf = 0;
  const tick = () => { onLevels(toLevels(read(ar), read(al))); raf = requestAnimationFrame(tick); };
  tick();
  return () => { cancelAnimationFrame(raf); void ac.close(); };
}
