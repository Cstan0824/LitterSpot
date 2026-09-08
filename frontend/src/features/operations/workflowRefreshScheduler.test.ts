import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRefreshScheduler } from "./workflowRefreshScheduler";

describe("Camera workflow refresh scheduling", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces a workflow event burst into at most one refresh every five seconds", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkflowRefreshScheduler(refresh);

    for (let index = 0; index < 20; index += 1) scheduler.notify();
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it("queues one refresh while hidden and runs it when the tab becomes visible", async () => {
    vi.useFakeTimers();
    let visible = false;
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkflowRefreshScheduler(refresh, { isVisible: () => visible });

    for (let index = 0; index < 20; index += 1) scheduler.notify();
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    scheduler.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it("caps a continuous event stream at twelve full refreshes per minute", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkflowRefreshScheduler(refresh);

    scheduler.notify();
    for (let second = 1; second < 60; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      scheduler.notify();
    }

    expect(refresh).toHaveBeenCalledTimes(12);
    scheduler.dispose();
  });
});
