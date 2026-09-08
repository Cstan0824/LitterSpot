import { HttpError } from "../shared/httpError.js";

export function validLocalDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function shiftDate(value: string, days: number) {
  if (!validLocalDate(value)) throw new HttpError(400, "Invalid calendar date.");
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const formatters = new Map<string, Intl.DateTimeFormat>();
export function siteLocalDate(at: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); formatters.set(timeZone, formatter); }
  const parts = formatter.formatToParts(at);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
const midnights = new Map<string, number>();
/** First instant in a local date; supports DST and fractional-hour offsets. */
export function siteMidnight(date: string, timeZone: string) {
  if (!validLocalDate(date)) throw new HttpError(400, "Invalid calendar date.");
  const key = `${timeZone}:${date}`;
  if (midnights.has(key)) return new Date(midnights.get(key)!);
  const center = Date.parse(`${date}T00:00:00Z`);
  let low = center - 48 * 3600000, high = center + 48 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (siteLocalDate(new Date(middle), timeZone) < date) low = middle + 1; else high = middle;
  }
  if (siteLocalDate(new Date(low), timeZone) !== date) throw new HttpError(400, "This local date does not exist in the Site timezone.");
  if (midnights.size > 5000) midnights.clear();
  midnights.set(key, low);
  return new Date(low);
}
export function fullDayExclusion(at: Date, timeZone: string) {
  const today = siteLocalDate(at, timeZone);
  const atMidnight = siteMidnight(today, timeZone).getTime() === at.getTime();
  return siteMidnight(shiftDate(today, atMidnight ? 2 : 3), timeZone);
}
export function validateDays(days: number) {
  if (!Number.isSafeInteger(days) || days < 2 || days > 3660) throw new HttpError(400, "days must be an integer from 2 to 3660.");
}

/** Preserve local wall-clock time when moving a comparison boundary by calendar days. */
export function shiftSiteInstant(at: Date, days: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const wall = (instant: Date) => {
    const values = parts.formatToParts(instant), get = (key: string) => Number(values.find(p => p.type === key)!.value);
    return Date.UTC(get("year"),get("month")-1,get("day"),get("hour"),get("minute"),get("second"),instant.getUTCMilliseconds());
  };
  const target = wall(at) + days * 86400000;
  let guess = +at + days * 86400000;
  for (let i=0;i<5;i++) { const delta = target - wall(new Date(guess)); if (!delta) return new Date(guess); guess += delta; }
  return new Date(Math.max(guess, guess + target - wall(new Date(guess))));
}
