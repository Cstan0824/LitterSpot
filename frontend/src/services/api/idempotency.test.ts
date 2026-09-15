import { describe, expect, it } from "vitest";
import { MutationIdempotencyKey } from "./idempotency";

describe("mutation idempotency keys", () => {
  it("stays stable for retries and rotates for a new logical mutation", () => {
    const key = new MutationIdempotencyKey("manual work create");
    const first = key.value();
    expect(key.value()).toBe(first);
    expect(first.startsWith("manual-work-create-")).toBe(true);
    expect(key.rotate()).not.toBe(first);
  });
});
