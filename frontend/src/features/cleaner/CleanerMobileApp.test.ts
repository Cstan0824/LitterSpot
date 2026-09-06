import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/v2/cleaner", () => ({
  getV2CleanerMap: vi.fn(), getV2CleanerNotifications: vi.fn(), getV2CleanerSelf: vi.fn(), getV2CleanerWorkOrder: vi.fn(), getV2CleanerWorkOrders: vi.fn(),
  startV2CleanerWork: vi.fn(), submitV2CleanerForReview: vi.fn(), subscribeV2CleanerNotifications: vi.fn(), uploadV2CleanerCompletionEvidence: vi.fn(),
}));

import { CleanerMobileApp } from "./CleanerMobileApp";

describe("CleanerMobileApp", () => {
  it("renders its loading state before the Cleaner profile has arrived", () => {
    const app = createElement(CleanerMobileApp, { session: { uid: "cleaner-auth", cleanerId: "cleaner-1", email: "cleaner@example.test", displayName: "Test Cleaner", assignedSiteId: "site-1" }, onLogout: () => undefined });
    expect(() => renderToStaticMarkup(app)).not.toThrow();
  });
});
