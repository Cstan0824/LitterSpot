import { describe, expect, it } from "vitest";
import { HttpError } from "../shared/httpError.js";
import { assertExpectedRevision, assertIdempotencyReplay, assertSiteScope, operationKeyId, recordKeyHash, requestBodyHash, sanitizeAuditSummary } from "./persistence.js";

describe("persistence foundation", () => {
  it("fails closed when a resource belongs to another Site", () => {
    expect(assertSiteScope("site-a", { siteId: "site-a", value: 1 })).toMatchObject({ value: 1 });
    expect(() => assertSiteScope("site-a", { siteId: "site-b" })).toThrow(HttpError);
    try { assertSiteScope("site-a", { siteId: "site-b" }); } catch (error) { expect((error as HttpError).status).toBe(404); }
  });

  it("enforces optimistic revisions", () => {
    expect(() => assertExpectedRevision({ revision: 3 }, 3)).not.toThrow();
    expect(() => assertExpectedRevision({ revision: 4 }, 3)).toThrow(/changed/i);
  });

  it("creates stable scoped idempotency identities and rejects body changes", () => {
    expect(operationKeyId("actor", "create", "request-1")).toBe(operationKeyId("actor", "create", "request-1"));
    expect(operationKeyId("actor", "create", "request-1")).not.toBe(operationKeyId("other", "create", "request-1"));
    const hash = requestBodyHash({ name: "Sunway", values: [1, 2] });
    expect(assertIdempotencyReplay({ requestBodyHash: hash, resourceType: "Site", resourceId: "site-1", responseStatus: 201 }, hash)).toEqual({ resourceType: "Site", resourceId: "site-1", responseStatus: 201 });
    expect(() => assertIdempotencyReplay({ requestBodyHash: hash }, requestBodyHash({ name: "Other" }))).toThrow(/different input/i);
  });

  it("preserves existing stored record identities while using domain namespaces", () => {
    expect(recordKeyHash("active-alert", "site", "camera", "floor_litter")).toBe("1748bc220fc6d35d91d428e1d1f94cdd996978597ddaeafb6a94ffc374bf1bea");
  });

  it("bounds audit summaries and rejects secret-bearing keys at any depth", () => {
    expect(sanitizeAuditSummary({ name: "x".repeat(1200), nested: { status: "active" } })).toEqual({ name: "x".repeat(1000), nested: { status: "active" } });
    expect(() => sanitizeAuditSummary({ nested: { accessToken: "secret" } })).toThrow(/not allowed/i);
    expect(() => sanitizeAuditSummary({ password: "secret" })).toThrow(/not allowed/i);
  });
});
