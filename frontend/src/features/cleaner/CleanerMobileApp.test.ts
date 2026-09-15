import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/api/cleaner", () => ({
  getCleanerMap: vi.fn(), getCleanerNotifications: vi.fn(), getCleanerSelf: vi.fn(), getCleanerWorkOrder: vi.fn(), getCleanerWorkOrders: vi.fn(),
  startCleanerWork: vi.fn(), submitCleanerForReview: vi.fn(), subscribeCleanerNotifications: vi.fn(), uploadCleanerCompletionEvidence: vi.fn(),
}));

import { CleanerMobileApp } from "./CleanerMobileApp";

describe("CleanerMobileApp", () => {
  it("renders its loading state before the Cleaner profile has arrived", () => {
    const app = createElement(CleanerMobileApp, { session: { uid: "cleaner-auth", cleanerId: "cleaner-1", email: "cleaner@example.test", displayName: "Test Cleaner", assignedSiteId: "site-1" }, onLogout: () => undefined });
    expect(() => renderToStaticMarkup(app)).not.toThrow();
  });
});
