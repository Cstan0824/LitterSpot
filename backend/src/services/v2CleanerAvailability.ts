export type WeeklyRange = { startMinute: number; endMinute: number } | null;
export type WeeklySchedule = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", WeeklyRange>>;

const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return { weekday: weekdayKeys.find((key) => key.slice(0, 3) === get("weekday").toLowerCase().slice(0, 3)) ?? "sun", minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isWithinWeeklySchedule(schedule: WeeklySchedule, at: Date, timeZone: string) {
  const current = localParts(at, timeZone);
  const range = schedule[current.weekday];
  if (range && range.endMinute > range.startMinute) return current.minute >= range.startMinute && current.minute < range.endMinute;
  if (range && range.endMinute === range.startMinute) return true;
  if (range && current.minute >= range.startMinute) return true;
  const previousIndex = (weekdayKeys.indexOf(current.weekday) + weekdayKeys.length - 1) % weekdayKeys.length;
  const previousKey = weekdayKeys[previousIndex];
  const previousRange = schedule[previousKey];
  return Boolean(previousRange && previousRange.endMinute < previousRange.startMinute && current.minute < previousRange.endMinute);
}

export function deriveCleanerAvailability(input: { siteActive: boolean; accountActive: boolean; cleanerActive: boolean; availabilityOverride: "none" | "unavailable"; activeWorkOrderId: string | null; stationPointValid: boolean; schedule: WeeklySchedule; scheduleTimeZone: string; at?: Date }) {
  const reasons: string[] = [];
  if (!input.siteActive) reasons.push("site_inactive");
  if (!input.accountActive) reasons.push("account_inactive");
  if (!input.cleanerActive) reasons.push("cleaner_inactive");
  if (input.availabilityOverride !== "none") reasons.push("availability_override");
  if (input.activeWorkOrderId) reasons.push("active_work_order");
  if (!input.stationPointValid) reasons.push("invalid_station_point");
  if (!isWithinWeeklySchedule(input.schedule, input.at ?? new Date(), input.scheduleTimeZone)) reasons.push("outside_schedule");
  return { available: reasons.length === 0, reasons };
}
