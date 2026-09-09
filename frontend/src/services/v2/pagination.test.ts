import { describe, expect, it } from "vitest";
import { cachedPageRequest, invalidatePagedResources } from "./pagination";

describe("paged resource cache", () => {
  it("shares a pending page request and reuses the fresh result", async () => {
    let loads = 0;
    const load = async () => { loads += 1; return { items: [1], nextCursor: "next", hasMore: true, totalCount: 2 }; };
    const [left, right] = await Promise.all([cachedPageRequest("/api/work-orders?limit=25", load), cachedPageRequest("/api/work-orders?limit=25", load)]);
    expect(left).toEqual(right);
    expect(loads).toBe(1);
    await cachedPageRequest("/api/work-orders?limit=25", load);
    expect(loads).toBe(1);
  });

  it("invalidates only matching resource pages", async () => {
    let workLoads = 0, alertLoads = 0;
    await cachedPageRequest("/api/work-orders?status=all", async () => ++workLoads);
    await cachedPageRequest("/api/alerts?status=all", async () => ++alertLoads);
    invalidatePagedResources(["/api/work-orders"]);
    await cachedPageRequest("/api/work-orders?status=all", async () => ++workLoads);
    await cachedPageRequest("/api/alerts?status=all", async () => ++alertLoads);
    expect(workLoads).toBe(2);
    expect(alertLoads).toBe(1);
  });

  it("lets one caller cancel without aborting the shared request for another caller", async () => {
    let resolve!: (value: { items: number[]; nextCursor: null; hasMore: false; totalCount: number }) => void;
    const load = async () => new Promise<{ items: number[]; nextCursor: null; hasMore: false; totalCount: number }>((done) => { resolve = done; });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = cachedPageRequest("/api/alerts?abort-isolation", load, 30_000, firstController.signal);
    const second = cachedPageRequest("/api/alerts?abort-isolation", load, 30_000, secondController.signal);
    firstController.abort();
    resolve({ items: [1], nextCursor: null, hasMore: false, totalCount: 1 });

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ totalCount: 1 });
  });
});
