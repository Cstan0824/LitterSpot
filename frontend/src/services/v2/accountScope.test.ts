import { describe, expect, it, vi } from "vitest";
import { AccountScopeRegistry } from "./accountScope";

describe("account-scoped cleanup", () => {
  it("clears listeners and caches on logout and account switch only", () => {
    const registry = new AccountScopeRegistry();
    const cleanup = vi.fn();
    registry.register(cleanup);

    expect(registry.transition("account-a")).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(registry.transition("account-a")).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(registry.transition("account-b")).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(registry.transition(null)).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("continues cleanup when one listener throws", () => {
    const registry = new AccountScopeRegistry();
    const cleanup = vi.fn();
    registry.register(() => { throw new Error("stale listener"); });
    registry.register(cleanup);
    registry.transition("account-a");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
