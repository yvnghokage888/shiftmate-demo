// NZ-aware date/time helpers, ported 1:1 from the vanilla app (app.js "Utils").
// All formatting is pinned to Pacific/Auckland so "today" and date strings match
// the backend regardless of the browser's local timezone.

export const TZ = "Pacific/Auckland";

/** Format a Date as YYYY-MM-DD in NZ time (en-CA yields YYYY-MM-DD). */
export function nzDateStr(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}
export function nzToday(): string {
  return nzDateStr(new Date());
}

/** Monday of the week, offset by N weeks, at local midnight (vanilla gmd). */
export function gmd(off = 0): Date {
  const n = new Date(nzToday() + "T00:00:00");
  const d = n.getDay();
  const diff = d === 0 ? -6 : 1 - d;
  const m = new Date(n);
  m.setDate(n.getDate() + diff + off * 7);
  m.setHours(0, 0, 0, 0);
  return m;
}
/** The seven Date objects (Mon..Sun) for the week at offset N (vanilla gwk). */
export function gwk(off = 0): Date[] {
  const m = gmd(off);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(m);
    d.setDate(m.getDate() + i);
    return d;
  });
}

/** YYYY-MM-DD in NZ time for a Date. */
export function ds(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}
/** "3 Jul" style short date. */
export function fd(d: Date): string {
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ });
}
/** Timestamp → "9:05 am" (NZ), or "–" when null. */
export function ft(ts: string | null | undefined): string {
  if (!ts) return "–";
  return new Date(ts).toLocaleTimeString("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

/** Decimal hours between two ISO timestamps (for calculations). */
export function ch(i: string | null, o: string | null): number | null {
  if (!i || !o) return null;
  return (new Date(o).getTime() - new Date(i).getTime()) / 3600000;
}
/** Decimal hours → "Xh Ym" string. */
export function fmtHrsNum(hrs: number): string {
  if (!hrs || hrs <= 0) return "0m";
  const totalMins = Math.round(hrs * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "HH:MM[:SS]" → "9 AM" / "9:30 AM". */
export function fmtTimeShort(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const p = h < 12 ? "AM" : "PM";
  const hr = h % 12 || 12;
  return m === 0 ? `${hr} ${p}` : `${hr}:${String(m).padStart(2, "0")} ${p}`;
}
/** Add decimal hours to a "HH:MM" time, wrapping at 24h → "HH:MM". */
export function addHoursToTime(t: string | null | undefined, hrs: number): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const tot = h * 60 + m + Math.round(hrs * 60);
  const eh = Math.floor(tot / 60) % 24;
  const em = tot % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

/** Current NZ wall-clock as "HH:MM" (24h) — for in-progress/done comparisons. */
export function nzNowHM(): string {
  return new Date().toLocaleTimeString("en-NZ", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/**
 * Pay-cycle window: Thursday → Wednesday containing `todayStr` (YYYY-MM-DD).
 * Mirrors the inline calc in vanilla renderEmployee.
 */
export function payCycleRange(todayStr: string): {
  start: Date;
  end: Date;
  startStr: string;
  endStr: string;
} {
  const dow = new Date(todayStr + "T12:00").getDay(); // 0 Sun … 4 Thu … 6 Sat
  const start = new Date(todayStr + "T12:00");
  start.setDate(start.getDate() - ((dow - 4 + 7) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end, startStr: ds(start), endStr: ds(end) };
}

/** Decimal hours → "3.5h" (timesheet totals). */
export function hDec(hrs: number): string {
  return ((+hrs || 0).toFixed(1)) + "h";
}

/** Inclusive list of Date objects between two YYYY-MM-DD strings (capped at 733). */
export function enumDates(startStr: string, endStr: string): Date[] {
  const out: Date[] = [];
  let cur = new Date(startStr + "T12:00");
  const end = new Date(endStr + "T12:00");
  let guard = 0;
  while (cur <= end && guard++ < 733) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Convert an NZ-local date + "HH:MM" into a UTC ISO string. Mirrors the vanilla
 * nzDateTimeToISO: guess UTC, measure the NZ offset at that instant, correct.
 */
export function nzDateTimeToISO(dateStr: string, timeStr: string): string {
  const guess = new Date(dateStr + "T" + timeStr + ":00.000Z");
  const nzTime = guess.toLocaleTimeString("en-NZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
  const [tH, tM] = timeStr.split(":").map(Number);
  const [nH, nM] = nzTime.split(":").map(Number);
  let diffMins = tH * 60 + tM - (nH * 60 + nM);
  if (diffMins > 0) diffMins -= 1440; // NZ is always UTC+, so offset must be negative
  return new Date(guess.getTime() + diffMins * 60000).toISOString();
}

/** ISO timestamp → "HH:MM" (24h, NZ) for a time input; "" when null. */
export function isoToNzTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-NZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

/** Calendar-month bounds for the month containing a Monday's YYYY-MM-DD. */
export function monthBounds(refMondayStr: string): {
  yy: number;
  mm: number;
  pad: (n: number) => string;
  lastDay: number;
  monthStart: string;
  monthEnd: string;
} {
  const [yy, mm] = refMondayStr.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(yy, mm, 0).getDate();
  return {
    yy,
    mm,
    pad,
    lastDay,
    monthStart: `${yy}-${pad(mm)}-01`,
    monthEnd: `${yy}-${pad(mm)}-${pad(lastDay)}`,
  };
}

/** WOF/REGO expiry status for the fleet screen (vanilla expiryInfo). */
export function expiryInfo(
  dateStr: string | null | undefined,
): { cls: "ok" | "soon" | "expired"; days: number; fmt: string } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00");
  const t = new Date(nzToday() + "T00:00");
  const days = Math.round((d.getTime() - t.getTime()) / 86400000);
  const cls = days < 0 ? "expired" : days <= 30 ? "soon" : "ok";
  return {
    cls,
    days,
    fmt: d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }),
  };
}

/** Relative time for notifications: "just now", "5m ago", "2h ago", "3d ago", date. */
export function notifRelTime(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.round(h / 24);
  if (d < 7) return d + "d ago";
  return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ });
}
