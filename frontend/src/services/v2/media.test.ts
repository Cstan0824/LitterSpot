import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/firebase", () => ({ firebaseAuth: { currentUser: null } }));

import { AuthenticatedMediaLoader } from "./media";

describe("authenticated media loading", () => {
  it("creates object URLs, revokes replacements, and never returns the protected path", async () => {
    const request = vi.fn(async () => new Blob(["image"], { type: "image/jpeg" }));
    const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revoke = vi.fn();
    const loader = new AuthenticatedMediaLoader(request, create, revoke);

    expect(await loader.load("alert-1", "/api/media/media-1/content")).toBe("blob:first");
    expect(await loader.load("alert-1", "/api/media/media-2/content")).toBe("blob:second");
    expect(request).toHaveBeenNthCalledWith(1, "/api/media/media-1/content", undefined);
    expect(revoke).toHaveBeenCalledWith("blob:first");
    expect(create.mock.results[0].value).not.toContain("/api/media/");

    loader.clear();
    expect(revoke).toHaveBeenCalledWith("blob:second");
  });

  it("reuses unchanged evidence after a component unmounts", async () => {
    const request = vi.fn(async () => new Blob(["image"], { type: "image/jpeg" }));
    const create = vi.fn().mockReturnValue("blob:cached");
    const revoke = vi.fn();
    const loader = new AuthenticatedMediaLoader(request, create, revoke);

    expect(await loader.load("alert-1", "/api/media/media-1/content")).toBe("blob:cached");
    loader.release("alert-1");
    expect(await loader.load("alert-1", "/api/media/media-1/content")).toBe("blob:cached");
    expect(request).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();

    loader.clear();
    expect(revoke).toHaveBeenCalledWith("blob:cached");
  });

  it("deduplicates concurrent downloads and evicts the oldest unused evidence", async () => {
    let resolve!: (blob: Blob) => void;
    const request = vi.fn(() => new Promise<Blob>((done) => { resolve = done; }));
    const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revoke = vi.fn();
    const loader = new AuthenticatedMediaLoader(request, create, revoke, 1);

    const first = loader.load("alert-1", "/api/media/media-1/content");
    const duplicate = loader.load("alert-1", "/api/media/media-1/content");
    expect(request).toHaveBeenCalledTimes(1);
    resolve(new Blob(["first"]));
    await expect(Promise.all([first, duplicate])).resolves.toEqual(["blob:first", "blob:first"]);
    loader.release("alert-1");
    loader.release("alert-1");

    request.mockResolvedValueOnce(new Blob(["second"]));
    await expect(loader.load("alert-2", "/api/media/media-2/content")).resolves.toBe("blob:second");
    expect(revoke).toHaveBeenCalledWith("blob:first");
  });

  it("does not retain an evidence download that finishes after account cleanup", async () => {
    let resolve!: (blob: Blob) => void;
    const request = vi.fn(() => new Promise<Blob>((done) => { resolve = done; }));
    const create = vi.fn().mockReturnValue("blob:stale");
    const loader = new AuthenticatedMediaLoader(request, create, vi.fn());

    const pending = loader.load("alert-1", "/api/media/media-1/content");
    loader.clear();
    resolve(new Blob(["stale"]));

    await expect(pending).rejects.toThrow("superseded");
    expect(create).not.toHaveBeenCalled();
  });
});
