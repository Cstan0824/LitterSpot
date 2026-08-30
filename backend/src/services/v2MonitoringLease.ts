export type MonitoringLease = { sessionId: string; ownerUid: string; tokenHash: string; leaseExpiresAtMs: number; status: "active" | "released"; revision: number };

export function canClaimMonitoringSession(current: MonitoringLease | null, nowMs: number) {
  return !current || current.status === "released" || current.leaseExpiresAtMs <= nowMs;
}

export function claimMonitoringSession(current: MonitoringLease | null, input: { sessionId: string; ownerUid: string; tokenHash: string; nowMs: number; leaseSeconds: number }) {
  if (!canClaimMonitoringSession(current, input.nowMs)) throw new Error("monitoring_session_owned");
  return { sessionId: input.sessionId, ownerUid: input.ownerUid, tokenHash: input.tokenHash, leaseExpiresAtMs: input.nowMs + input.leaseSeconds * 1000, status: "active" as const, revision: (current?.revision ?? 0) + 1 };
}

export function heartbeatMonitoringSession(current: MonitoringLease, input: { sessionId: string; tokenHash: string; nowMs: number; leaseSeconds: number }) {
  if (current.status !== "active" || current.sessionId !== input.sessionId || current.tokenHash !== input.tokenHash || current.leaseExpiresAtMs <= input.nowMs) throw new Error("monitoring_session_invalid");
  return { ...current, leaseExpiresAtMs: input.nowMs + input.leaseSeconds * 1000, revision: current.revision + 1 };
}

export function shouldAcceptSample(input: { session: MonitoringLease; sessionId: string; tokenHash: string; expectedSequence: number; sequence: number; nowMs: number }) {
  return input.session.status === "active" && input.session.sessionId === input.sessionId && input.session.tokenHash === input.tokenHash && input.session.leaseExpiresAtMs > input.nowMs && input.sequence === input.expectedSequence;
}

