export type SystemEventSeverity = "warning" | "critical";

export function systemEventKey(input: { siteId?: string | null; component: string; code: string }) {
  return [input.siteId ?? "global", input.component, input.code].join(":");
}

export function nextSystemEventState(current: { status: "open" | "recovered"; occurrenceCount: number; severity: SystemEventSeverity } | null, input: { severity: SystemEventSeverity; recovered: boolean }) {
  if (input.recovered) return { status: "recovered" as const, occurrenceCount: current?.occurrenceCount ?? 0, severity: current?.severity ?? input.severity };
  return { status: "open" as const, occurrenceCount: (current?.occurrenceCount ?? 0) + 1, severity: current?.severity === "critical" || input.severity === "critical" ? "critical" as const : "warning" as const };
}

