import { describe, expect, it } from "vitest";
import { isFirestoreQuotaError, safeFirestoreError } from "./firestoreErrors.js";

describe("Firestore error classification", () => {
  it("recognizes gRPC and HTTP quota errors without exposing provider details", () => {
    expect(isFirestoreQuotaError(Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 }))).toBe(true);
    expect(isFirestoreQuotaError({ response: { status: 429 } })).toBe(true);
    expect(safeFirestoreError(Object.assign(new Error("secret provider details"), { code: 8 }))).toEqual({ errorCode: "8", quotaExceeded: true });
  });

  it("does not classify index errors as quota exhaustion", () => {
    expect(isFirestoreQuotaError(Object.assign(new Error("FAILED_PRECONDITION"), { code: 9 }))).toBe(false);
  });
});
