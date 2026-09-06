export function cleanerGreeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function cleanerAvailabilityLabel(input: { hasActiveWork: boolean; available?: boolean; reasons?: string[] }) {
  if (input.hasActiveWork) return "Busy";
  if (input.available) return "Available";
  const reason = input.reasons?.[0];
  if (reason === "outside_schedule") return "Outside schedule";
  if (reason === "availability_override") return "Unavailable";
  if (reason === "inactive") return "Inactive";
  return reason ? reason.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unavailable";
}

export function scheduleDurationMinutes(startMinute: number, endMinute: number) {
  const duration = (endMinute - startMinute + 1440) % 1440;
  if (duration === 0 || duration >= 1439) return 1440;
  return duration;
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} hr ${remainder} min`;
}

export function notificationTone(type: string) {
  if (type.includes("rework")) return "rework";
  if (type.includes("resolved")) return "resolved";
  if (type.includes("dismissed") || type.includes("reassigned")) return "dismissed";
  return "assigned";
}

export function cleanerUsesCompletionPhoto(origin: "alert" | "manual") {
  return origin === "manual";
}

export function cleanerCompletionActionLabel(origin: "alert" | "manual", hasPhoto: boolean) {
  if (origin === "alert") return "Done cleaning";
  return hasPhoto ? "Submit photo for review" : "Add 1 completion photo";
}
