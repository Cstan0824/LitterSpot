import { describe, expect, it } from "vitest";
import { rewriteSuperadminSiteMediaUrls } from "./v2SuperadminReadService.js";

describe("Superadmin Site View media projection", () => {
  it("rewrites nested Supervisor media URLs into the selected Site route", () => {
    expect(rewriteSuperadminSiteMediaUrls("site/one", {
      evidence: { contentUrl: "/api/media/media%2Fone/content" },
      history: [{ contentUrl: "/api/media/media-two/content" }],
      unrelated: "/api/health",
    })).toEqual({
      evidence: { contentUrl: "/api/superadmin/sites/site%2Fone/view/media/media%2Fone/content" },
      history: [{ contentUrl: "/api/superadmin/sites/site%2Fone/view/media/media-two/content" }],
      unrelated: "/api/health",
    });
  });
});
