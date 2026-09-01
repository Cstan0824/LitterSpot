import { registerAccountScopedCleanup } from "./accountScope";
import { v2Request } from "./http";

type BlobRequest = (path: string, signal?: AbortSignal) => Promise<Blob>;

export class AuthenticatedMediaLoader {
  private readonly objectUrls = new Map<string, string>();

  constructor(
    private readonly requestBlob: BlobRequest,
    private readonly createObjectUrl: (blob: Blob) => string,
    private readonly revokeObjectUrl: (url: string) => void,
  ) {}

  async load(key: string, path: string, signal?: AbortSignal) {
    const blob = await this.requestBlob(path, signal);
    const nextUrl = this.createObjectUrl(blob);
    const previousUrl = this.objectUrls.get(key);
    if (previousUrl && previousUrl !== nextUrl) this.revokeObjectUrl(previousUrl);
    this.objectUrls.set(key, nextUrl);
    return nextUrl;
  }

  release(key: string) {
    const url = this.objectUrls.get(key);
    if (!url) return;
    this.objectUrls.delete(key);
    this.revokeObjectUrl(url);
  }

  clear() {
    for (const url of this.objectUrls.values()) this.revokeObjectUrl(url);
    this.objectUrls.clear();
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
