import { describe, expect, it } from "vitest";
import { V2ApiError, loginErrorMessage, parseApiError, sessionErrorCopy } from "./errors";

describe("structured V2 API errors", () => {
  it("parses validation details and request identity", async () => {
    const error = await parseApiError(new Response(JSON.stringify({ error: "Invalid request.", details: { fieldErrors: { name: ["Required"] } }, requestId: "req-1" }), { status: 400 }));
    expect(error.kind).toBe("bad_request");
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ fieldErrors: { name: ["Required"] } });
    expect(error.requestId).toBe("req-1");
  });

  it("keeps an authentication failure separate from Firestore quota failure", async () => {
    const unauthorized = await parseApiError(new Response(JSON.stringify({ error: "Invalid or expired authentication token." }), { status: 401 }));
    const quota = await parseApiError(new Response(JSON.stringify({ error: "Cloud database quota is temporarily unavailable.", code: "firestore_quota_exceeded" }), { status: 503 }));
    expect(unauthorized.kind).toBe("unauthenticated");
    expect(unauthorized.isFirestoreQuotaExceeded).toBe(false);
    expect(quota.kind).toBe("unavailable");
    expect(quota.isFirestoreQuotaExceeded).toBe(true);
  });

  it.each([403, 409, 429, 500, 503])("classifies status %s", async (status) => {
    const error = await parseApiError(new Response("{}", { status }));
    expect(error.status).toBe(status);
  });

  it("uses a specific invalid-credential message", () => {
    expect(loginErrorMessage({ code: "auth/invalid-credential" })).toBe("The email or password is incorrect.");
  });

  it("separates inactive access, forbidden access, and backend unavailability", () => {
    expect(sessionErrorCopy(new V2ApiError({ status: 403, message: "Application access is inactive." })).title).toBe("Application access is inactive");
    expect(sessionErrorCopy(new V2ApiError({ status: 403, message: "Supervisor access is required." })).title).toBe("Application access is forbidden");
    expect(sessionErrorCopy(new V2ApiError({ status: 503, message: "Service unavailable." })).title).toBe("Backend unavailable");
  });
});
