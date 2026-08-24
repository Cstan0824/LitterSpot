export class SerialJobQueue {
  private readonly pending: string[] = [];
  private readonly admitted = new Set<string>();
  private readonly rerun = new Set<string>();
  private currentJobId: string | null = null;
  private draining = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly worker: (jobId: string) => Promise<void>,
    private readonly onError: (jobId: string, error: unknown) => void = () => undefined,
  ) {}

  enqueue(jobId: string) {
    if (this.admitted.has(jobId)) return false;
    this.admitted.add(jobId);
    this.pending.push(jobId);
    void this.drain();
    return true;
  }

  /**
   * Schedule a fresh run after the current run finishes. This closes the small
   * race where a failed job is retried after its Firestore status changes but
   * before the queue worker has left its finally block.
   */
  requeue(jobId: string) {
    if (!this.admitted.has(jobId)) return this.enqueue(jobId);
    if (this.currentJobId !== jobId) return false;
    if (this.rerun.has(jobId)) return false;
    this.rerun.add(jobId);
    return true;
  }

  has(jobId: string) {
    return this.admitted.has(jobId);
  }

  async whenIdle() {
    if (!this.draining && this.pending.length === 0 && this.admitted.size === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdle() {
    if (this.draining || this.pending.length > 0 || this.admitted.size > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const jobId = this.pending.shift()!;
        this.currentJobId = jobId;
        try {
          await this.worker(jobId);
        } catch (error) {
          this.onError(jobId, error);
        } finally {
          this.currentJobId = null;
          if (this.rerun.delete(jobId)) {
            this.pending.push(jobId);
          } else {
            this.admitted.delete(jobId);
          }
        }
      }
    } finally {
      this.draining = false;
      this.resolveIdle();
    }
  }
}
