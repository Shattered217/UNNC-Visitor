import { beijingDate, schoolDate } from "./visitor-model.ts";

export interface CalendarYear { year: number; days: { date: string; isOffDay: boolean }[]; papers: string[] }
export type Calendars = Record<string, CalendarYear>;
export interface BookingConfig {
  enabled: boolean;
  calendar: "china" | "weekdays";
  leadWorkdays: number;
  hour: number;
  dateMode: "max_span" | "after_expiry";
  gate: string;
  purpose: string;
  purposeExtra: string;
  hostEmail: string;
  driving: boolean;
  plate: string;
}
export interface SchoolLimits { maxSpanDays: number; maxAdvanceDays: number; banToday: boolean; banWeek: number[]; banDates: string[] }
export interface RenewalPlan {
  state: "disabled" | "unconfigured" | "waiting" | "pending_approval" | "ready" | "calendar_missing" | "school_limit";
  expiry: string | null;
  trigger: string | null;
  start: string | null;
  end: string | null;
}
export const defaultConfig: BookingConfig = { enabled: true, calendar: "china", leadWorkdays: 3, hour: 9,
  dateMode: "max_span", gate: "", purpose: "", purposeExtra: "", hostEmail: "", driving: false, plate: "" };

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function isWorkday(date: string, mode: BookingConfig["calendar"], calendars: Calendars): boolean {
  if (mode === "china") {
    const year = calendars[date.slice(0, 4)];
    if (!year) throw new Error("calendar_missing");
    const override = year.days.find(day => day.date === date);
    if (override) return !override.isOffDay;
  }
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function beforeWorkdays(date: string, count: number, mode: BookingConfig["calendar"], calendars: Calendars): string {
  let cursor = date;
  for (let i = 0; i < count;) {
    cursor = shiftDate(cursor, -1);
    if (isWorkday(cursor, mode, calendars)) i++;
  }
  return cursor;
}

export function renewalPlan(records: Record<string, unknown>[], config: BookingConfig, limits: SchoolLimits, calendars: Calendars, now = Date.now()): RenewalPlan {
  const plan: RenewalPlan = { state: "waiting", expiry: null, trigger: null, start: null, end: null };
  if (!config.enabled) return { ...plan, state: "disabled" };
  if (!config.gate || !config.purpose || !/^[^\s@]+@nottingham\.edu\.cn$/i.test(config.hostEmail) || config.driving && !config.plate) return { ...plan, state: "unconfigured" };
  const today = beijingDate(now);
  const same = matchingRecords(records, config);
  const approvedDates = same.filter(r => r.approved === 0).map(r => schoolDate(r.Vdate)).filter((d): d is string => Boolean(d)).sort();
  plan.expiry = approvedDates.at(-1) || null;
  // A pending application prevents resubmission while the host is approving it.
  if (same.some(r => [2, 100].includes(Number(r.approved)) && (schoolDate(r.Vdate) || "") >= today)) return { ...plan, state: "pending_approval" };
  try {
    plan.trigger = plan.expiry ? beforeWorkdays(plan.expiry, config.leadWorkdays, config.calendar, calendars) : today;
    if (today < plan.trigger || !isWorkday(today, config.calendar, calendars) || Number(new Date(now + 8 * 3600000).getUTCHours()) < config.hour) return plan;
  } catch { return { ...plan, state: "calendar_missing" }; }
  const allowed = (date: string) => !limits.banWeek.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !limits.banDates.includes(date);
  if (!Number.isInteger(limits.maxSpanDays) || limits.maxSpanDays < 1 || !Number.isInteger(limits.maxAdvanceDays) || limits.maxAdvanceDays < 0 || limits.maxAdvanceDays > 366 || new Set(limits.banWeek).size >= 7) return { ...plan, state: "school_limit" };
  let horizon = shiftDate(today, limits.maxAdvanceDays);
  // Match the official date picker: banned weekdays extend the advance window.
  for (let d = today; d <= horizon; d = shiftDate(d, 1)) {
    if (limits.banWeek.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) horizon = shiftDate(horizon, 1);
    if (Date.parse(horizon) - Date.parse(today) > 366 * 86400000) return { ...plan, state: "school_limit" };
  }
  plan.start = config.dateMode === "after_expiry" && plan.expiry && plan.expiry >= today ? shiftDate(plan.expiry, 1) : shiftDate(today, limits.banToday ? 1 : 0);
  while (!allowed(plan.start) && plan.start <= horizon) plan.start = shiftDate(plan.start, 1);
  plan.end = [shiftDate(plan.start, limits.maxSpanDays - 1), horizon].sort()[0];
  while (!allowed(plan.end) && plan.end >= plan.start) plan.end = shiftDate(plan.end, -1);
  if (plan.start > plan.end) return { ...plan, state: "school_limit" };
  // A fully covered range does not need another application.
  if (plan.expiry && plan.end <= plan.expiry) return plan;
  return { ...plan, state: "ready" };
}

export function matchingRecords(records: Record<string, unknown>[], config: BookingConfig): Record<string, unknown>[] {
  return records.filter(r => String(r.Vbranch) === config.gate && String(r.Vpurpose) === config.purpose
    && String(r.Eemail || "").toLowerCase() === config.hostEmail.toLowerCase());
}
