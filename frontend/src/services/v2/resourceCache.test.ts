import { describe, expect, it, vi } from "vitest";
import { TimedResourceCache } from "./resourceCache";

describe("timed request resource cache", () => {
  it("deduplicates concurrent reads and reuses fresh data", async () => {
    let resolve!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const cache = new TimedResourceCache({ alerts: loader }, { freshnessMs: 30_000, now: () => 1_000 });

    const first = cache.read("alerts");
    const second = cache.read("alerts");
    expect(loader).toHaveBeenCalledTimes(1);
    resolve("current");
    await expect(Promise.all([first, second])).resolves.toEqual(["current", "current"]);
    await expect(cache.read("alerts")).resolves.toBe("current");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refreshes stale or invalidated data and still deduplicates forced callers", async () => {
    let now = 1_000;
    const loader = vi.fn(async () => `value-${loader.mock.calls.length}`);
    const cache = new TimedResourceCache({ workOrders: loader }, { freshnessMs: 30_000, now: () => now });

    await expect(cache.read("workOrders")).resolves.toBe("value-1");
    now += 30_001;
    await expect(cache.read("workOrders")).resolves.toBe("value-2");
    cache.invalidate(["workOrders"]);
    const [left, right] = await Promise.all([cache.read("workOrders", { force: true }), cache.read("workOrders", { force: true })]);
    expect([left, right]).toEqual(["value-3", "value-3"]);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("does not let a response started before a mutation overwrite the post-mutation refresh", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const loader = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)));
    const cache = new TimedResourceCache({ alerts: loader });

    const stale = cache.read("alerts");
    cache.invalidate(["alerts"]);
    const fresh = cache.read("alerts", { force: true });
    expect(loader).toHaveBeenCalledTimes(2);
    resolvers[1]("after-write");
    await expect(fresh).resolves.toBe("after-write");
    resolvers[0]("before-write");
    await expect(stale).resolves.toBe("after-write");
    await expect(cache.read("alerts")).resolves.toBe("after-write");
  });
});
