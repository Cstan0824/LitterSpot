import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateLimitStateForTests, rateLimit } from "./rateLimit.js";

function harness(uid = "supervisor-1") {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) { this.statusCode = code; return this; },
    json: vi.fn(),
  };
  return {
    request: { authUser: { uid, role: "supervisor" }, supervisor: { uid }, requestId: "request-1", ip: "127.0.0.1" },
    response,
    headers,
  };
}

describe("rateLimit", () => {
  beforeEach(() => clearRateLimitStateForTests());

  it("allows up to the configured supervisor limit and returns retry metadata", () => {
    const middleware = rateLimit({ namespace: "test", maximum: 2 });
    const first = harness();
    const second = harness();
    const third = harness();
    const next = vi.fn();
    middleware(first.request as never, first.response as never, next);
    middleware(second.request as never, second.response as never, next);
    middleware(third.request as never, third.response as never, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(third.response.statusCode).toBe(429);
    expect(third.headers.get("Retry-After")).toBeTruthy();
    expect(third.response.json).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-1" }));
  });

  it("keeps namespaces and supervisors independent", () => {
    const upload = rateLimit({ namespace: "upload", maximum: 1 });
    const process = rateLimit({ namespace: "process", maximum: 1 });
    const next = vi.fn();
    upload(harness("one").request as never, harness("one").response as never, next);
    upload(harness("two").request as never, harness("two").response as never, next);
    process(harness("one").request as never, harness("one").response as never, next);
    expect(next).toHaveBeenCalledTimes(3);
  });
});
