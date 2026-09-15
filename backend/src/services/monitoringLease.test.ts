import { describe, expect, it } from "vitest";
import { claimMonitoringSession, heartbeatMonitoringSession, shouldAcceptSample } from "./monitoringLease.js";

describe("monitoring lease", () => {
  it("allows expiry failover and rejects active ownership conflicts", () => {
    const first = claimMonitoringSession(null, { sessionId: "s1", ownerUid: "u1", tokenHash: "t1", nowMs: 0, leaseSeconds: 10 });
    expect(() => claimMonitoringSession(first, { sessionId: "s2", ownerUid: "u2", tokenHash: "t2", nowMs: 1, leaseSeconds: 10 })).toThrow("monitoring_session_owned");
    expect(claimMonitoringSession(first, { sessionId: "s2", ownerUid: "u2", tokenHash: "t2", nowMs: 10_000, leaseSeconds: 10 }).ownerUid).toBe("u2");
  });
  it("requires the owner token and next sequence for samples", () => {
    const lease = claimMonitoringSession(null, { sessionId: "s1", ownerUid: "u1", tokenHash: "t1", nowMs: 0, leaseSeconds: 10 });
    expect(shouldAcceptSample({ session: lease, sessionId: "s1", tokenHash: "t1", expectedSequence: 1, sequence: 1, nowMs: 1 })).toBe(true);
    expect(shouldAcceptSample({ session: lease, sessionId: "s1", tokenHash: "bad", expectedSequence: 1, sequence: 1, nowMs: 1 })).toBe(false);
    expect(heartbeatMonitoringSession(lease, { sessionId: "s1", tokenHash: "t1", nowMs: 1, leaseSeconds: 10 }).revision).toBe(2);
  });
});

