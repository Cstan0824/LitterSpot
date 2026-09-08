import { registerAccountScopedCleanup } from "./accountScope";
import { v2Request } from "./http";

type BlobRequest = (path: string, signal?: AbortSignal) => Promise<Blob>;

export class AuthenticatedMediaLoader {
  private readonly objectUrls = new Map<string, { path: string; url: string; lastUsedAt: number }>();
  private readonly pending = new Map<string, { path: string; promise: Promise<string> }>();
  private readonly references = new Map<string, number>();
  private readonly versions = new Map<string, number>();
  private epoch = 0;

  constructor(
    private readonly requestBlob: BlobRequest,
    private readonly createObjectUrl: (blob: Blob) => string,
    private readonly revokeObjectUrl: (url: string) => void,
    private readonly maximumEntries = 24,
  ) {}

  async load(key: string, path: string, signal?: AbortSignal) {
    this.references.set(key, (this.references.get(key) ?? 0) + 1);
    const cached = this.objectUrls.get(key);
    if (cached?.path === path) {
      cached.lastUsedAt = Date.now();
      return cached.url;
    }
    const current = this.pending.get(key);
    if (current?.path === path) return current.promise;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    const epoch = this.epoch;
    if (cached) {
      this.revokeObjectUrl(cached.url);
      this.objectUrls.delete(key);
    }
    const promise = this.requestBlob(path, undefined).then((blob) => {
      if (epoch !== this.epoch || this.versions.get(key) !== version) throw new Error("Evidence request was superseded.");
      const nextUrl = this.createObjectUrl(blob);
      const previous = this.objectUrls.get(key);
      if (previous && previous.url !== nextUrl) this.revokeObjectUrl(previous.url);
      this.objectUrls.set(key, { path, url: nextUrl, lastUsedAt: Date.now() });
      this.trim();
      return nextUrl;
    }).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    });
    this.pending.set(key, { path, promise });
    return promise;
  }

  release(key: string) {
    const count = Math.max(0, (this.references.get(key) ?? 0) - 1);
    if (count) this.references.set(key, count);
    else this.references.delete(key);
    const cached = this.objectUrls.get(key);
    if (cached) cached.lastUsedAt = Date.now();
    this.trim();
  }

  clear() {
    this.epoch += 1;
    for (const entry of this.objectUrls.values()) this.revokeObjectUrl(entry.url);
    this.objectUrls.clear();
    this.pending.clear();
    this.references.clear();
    this.versions.clear();
  }

  private trim() {
    if (this.objectUrls.size <= this.maximumEntries) return;
    const unused = [...this.objectUrls.entries()]
      .filter(([key]) => !this.references.has(key))
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    while (this.objectUrls.size > this.maximumEntries && unused.length) {
      const [key, entry] = unused.shift()!;
      this.objectUrls.delete(key);
      this.revokeObjectUrl(entry.url);
    }
  }
}

export const authenticatedMediaLoader = new AuthenticatedMediaLoader(
  (path, signal) => v2Request<Blob>(path, { signal, responseType: "blob" }),
  (blob) => URL.createObjectURL(blob),
  (url) => URL.revokeObjectURL(url),
);

registerAccountScopedCleanup(() => authenticatedMediaLoader.clear());

export const loadAuthenticatedMedia = (key: string, path: string, signal?: AbortSignal) => authenticatedMediaLoader.load(key, path, signal);
export const releaseAuthenticatedMedia = (key: string) => authenticatedMediaLoader.release(key);
export const clearAuthenticatedMedia = () => authenticatedMediaLoader.clear();
