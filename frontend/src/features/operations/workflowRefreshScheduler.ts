type WorkflowRefreshSchedulerOptions = {
  minimumIntervalMs?: number;
  isVisible?: () => boolean;
  now?: () => number;
};

export function createWorkflowRefreshScheduler(
  refresh: () => Promise<void>,
  options: WorkflowRefreshSchedulerOptions = {},
) {
  const minimumIntervalMs = options.minimumIntervalMs ?? 5_000;
  const isVisible = options.isVisible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const now = options.now ?? Date.now;
  let nextAllowedAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;
  let running = false;
  let disposed = false;

  const runQueuedRefresh = async () => {
    timer = undefined;
    if (disposed || running || !queued || !isVisible()) return;
    queued = false;
    running = true;
    nextAllowedAt = now() + minimumIntervalMs;
    try {
      await refresh();
    } finally {
      running = false;
      arm();
    }
  };

  function arm() {
    if (disposed || running || timer || !queued || !isVisible()) return;
    const delay = Math.max(0, nextAllowedAt - now());
    if (delay === 0) void runQueuedRefresh();
    else timer = setTimeout(() => { void runQueuedRefresh(); }, delay);
  }

  return {
    notify() {
      queued = true;
      arm();
    },
    visibilityChanged() {
      if (!isVisible() && timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      arm();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      queued = false;
    },
  };
}
