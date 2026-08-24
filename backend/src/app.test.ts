import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("./services/aiServiceClient.js", () => ({
  checkAiHealth: vi.fn(async () => ({ modelReady: true, binLocalizerReady: true, floorAnalyzerReady: true })),
}));

const { app } = await import("./app.js");

const describeHttp = process.env.RUN_HTTP_TESTS === "1" ? describe : describe.skip;

describeHttp("HTTP application shell", () => {
  it("provides public liveness with security and request-ID headers", async () => {
    const response = await request(app).get("/api/health/live").set("X-Request-ID", "test-request-id");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toBe("test-request-id");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("exposes only a generic readiness contract, not model internals", async () => {
    const response = await request(app).get("/api/health/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", dependencies: { aiInference: "ready" } });
    expect(response.text).not.toContain("modelVersion");
  });

  it("protects application routes and includes a traceable request ID", async () => {
    const response = await request(app).get("/api/sites");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication required.");
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("includes a traceable request ID on unknown routes", async () => {
    const response = await request(app).get("/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Route not found.", requestId: response.headers["x-request-id"] });
  });

  it("allows non-browser clients but rejects browser origins outside the configured allowlist", async () => {
    expect((await request(app).get("/api/health/live")).status).toBe(200);
    const rejected = await request(app).get("/api/health/live").set("Origin", "https://untrusted.example");
    expect(rejected.status).toBe(403);
    expect(rejected.body.error).toBe("This web origin is not allowed.");
  });
});
