import { HttpError } from "../shared/httpError.js";

/** One executing sample and one waiting sample per Camera, bounded across Cameras.
 * Replacing a waiting sample retains its place in line, preventing noisy sources
 * from starving other Cameras. Sequence numbers are consumed only on execution. */
export class CameraSampleQueue {
  private waiting = new Map<string, { run: () => Promise<void>; reject: (error: unknown) => void }>();
  private running = false;
  skipped = 0;
  constructor(private maximum = 32) {}
  submit<T>(key: string, work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const old = this.waiting.get(key);
      if (old) { old.reject(new HttpError(429, "A newer Camera frame replaced this queued frame.", { code: "frame_superseded" })); this.skipped++; }
      else if (this.waiting.size >= this.maximum) { this.skipped++; reject(new HttpError(429, "Camera processing queue is full. Submit a fresh frame later.", { code: "camera_queue_full" })); return; }
      this.waiting.set(key, { reject, run: async () => { try { resolve(await work()); } catch (error) { reject(error); } } });
      void this.drain();
    });
  }
  get pending() { return this.waiting.size; }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try { while (this.waiting.size) { const [key, task] = this.waiting.entries().next().value!; this.waiting.delete(key); await task.run(); } }
    finally { this.running = false; }
  }
}
export const cameraSampleQueue = new CameraSampleQueue();
