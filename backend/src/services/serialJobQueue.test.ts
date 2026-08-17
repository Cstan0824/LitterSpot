import { describe, expect, it, vi } from "vitest";
import { SerialJobQueue } from "./serialJobQueue.js";

describe("serial video job queue", () => {
  it("deduplicates a job while it is queued and in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const worker = vi.fn(async () => gate);
    const queue = new SerialJobQueue(worker);

    expect(queue.enqueue("job-1")).toBe(true);
    expect(queue.enqueue("job-1")).toBe(false);
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(1));
    expect(queue.has("job-1")).toBe(true);
    expect(queue.enqueue("job-1")).toBe(false);

    release();
    await queue.whenIdle();
    expect(queue.has("job-1")).toBe(false);
    expect(queue.enqueue("job-1")).toBe(true);
    await queue.whenIdle();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("continues with later jobs after a worker failure", async () => {
    const handled: string[] = [];
    const errors: string[] = [];
    const queue = new SerialJobQueue(async (jobId) => {
      handled.push(jobId);
      if (jobId === "bad") throw new Error("failed");
    }, (jobId) => errors.push(jobId));

    queue.enqueue("bad");
    queue.enqueue("good");
    await queue.whenIdle();
    expect(handled).toEqual(["bad", "good"]);
    expect(errors).toEqual(["bad"]);
  });

  it("can explicitly schedule a retry after an in-flight worker exits", async () => {
    let release!: () => void;
    const firstRun = new Promise<void>((resolve) => { release = resolve; });
    const worker = vi.fn(async () => {
      if (worker.mock.calls.length === 1) await firstRun;
    });
    const queue = new SerialJobQueue(worker);

    queue.enqueue("job-1");
    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(1));
    expect(queue.requeue("job-1")).toBe(true);
    expect(queue.requeue("job-1")).toBe(false);
    release();
    await queue.whenIdle();
    expect(worker).toHaveBeenCalledTimes(2);
  });
});
