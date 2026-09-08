import { describe, expect, it } from "vitest";
import { CameraSampleQueue } from "./cameraSampleQueue.js";

describe("Camera queue", () => {
  it("replaces stale pending frames and gives other Cameras a turn", async () => {
    const queue = new CameraSampleQueue(2); const order: string[] = [];
    let release!: () => void;
    const first = queue.submit("a", () => new Promise<void>(r => { release = r; }));
    const stale = queue.submit("a", async () => { order.push("stale"); }).catch(e => e.status);
    const b = queue.submit("b", async () => { order.push("b"); });
    const newest = queue.submit("a", async () => { order.push("new"); });
    expect(await stale).toBe(429); expect(queue.pending).toBe(2);
    release(); await Promise.all([first, b, newest]);
    expect(order).toEqual(["new", "b"]); expect(queue.skipped).toBe(1);
  });
});
