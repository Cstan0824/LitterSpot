export type V2ListPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean; totalCount: number };

const pages = new Map<string, { value?: unknown; expiresAt: number; pending?: Promise<unknown> }>();

function callerResult<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(new DOMException("The operation was aborted.", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    request.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

export function cachedPageRequest<T>(key: string, load: () => Promise<T>, freshnessMs = 30_000, signal?: AbortSignal): Promise<T> {
  const current = pages.get(key);
  if (current?.pending) return callerResult(current.pending as Promise<T>, signal);
  if (current?.value !== undefined && current.expiresAt > Date.now()) return callerResult(Promise.resolve(current.value as T), signal);
  const entry = current ?? { expiresAt: 0 };
  const pending = load().then((value) => { entry.value = value; entry.expiresAt = Date.now() + freshnessMs; return value; }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
  entry.pending = pending; pages.set(key, entry); return callerResult(pending, signal);
}

export function invalidatePagedResources(prefixes: string[]) {
  for (const key of pages.keys()) if (prefixes.some((prefix) => key.startsWith(prefix))) pages.delete(key);
}
