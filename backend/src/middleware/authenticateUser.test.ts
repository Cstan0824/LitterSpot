import { describe, expect, it, vi } from "vitest";

const quotaError = Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 });
const verifyIdToken = vi.fn(async () => ({ uid: "valid-user", email: "valid@example.test" }));
const get = vi.fn(async () => { throw quotaError; });

vi.mock("../config/firebase.js", () => ({
  firebaseAuth: { verifyIdToken },
  firestore: {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ get })) })),
  },
}));

const { authenticateUser } = await import("./authenticateUser.js");

describe("authentication dependency failures", () => {
  it("passes a Firestore quota error to the application error handler instead of reporting an invalid token", async () => {
    const request = {
      header: vi.fn(() => "Bearer valid-token"),
      requestId: "request-1",
    } as any;
    const response = {
      status: vi.fn(function (this: any) { return this; }),
      json: vi.fn(function (this: any) { return this; }),
    } as any;
    const next = vi.fn();

    await authenticateUser(request, response, next);

    expect(verifyIdToken).toHaveBeenCalledWith("valid-token", true);
    expect(next).toHaveBeenCalledWith(quotaError);
    expect(response.status).not.toHaveBeenCalledWith(401);
  });
});
