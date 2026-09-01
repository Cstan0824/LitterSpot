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
});
