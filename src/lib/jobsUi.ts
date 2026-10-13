// Labels, colours and small pure helpers shared by the Dispatch, Cleaning and
// Invoices screens.
import type { CleaningType, InvoiceStatus, Job, JobStatus, ServiceType } from "./types";

export const SERVICE_LABEL: Record<ServiceType, string> = {
  house_move: "House move",
  piano: "Piano",
  commercial: "Commercial",
  cleaning: "Cleaning",
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Quoted",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_CLS: Record<JobStatus, string> = {
  quoted: "bg-slate-500/15 text-slate-500",
  scheduled: "bg-blue-500/15 text-blue-500",
  in_progress: "bg-amber-500/15 text-amber-600",
  completed: "bg-green-500/15 text-green-600",
  cancelled: "bg-red-500/15 text-red-500",
};

export const CLEAN_LABEL: Record<CleaningType, string> = {
  end_of_tenancy: "End of tenancy",
  regular: "Regular",
  deep: "Deep clean",
};

export const INVOICE_CLS: Record<InvoiceStatus | "overdue", string> = {
  draft: "bg-slate-500/15 text-slate-500",
  sent: "bg-blue-500/15 text-blue-500",
  paid: "bg-green-500/15 text-green-600",
  overdue: "bg-red-500/15 text-red-500",
};

export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-NZ", { style: "currency", currency: "NZD" });
}

/** "Tue 14 Oct" from a YYYY-MM-DD string. */
export function fmtDay(dateStr: string): string {
  // Midnight UTC formatted in UTC, so the calendar day never shifts with the viewer's timezone.
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** YYYY-MM-DD plus n days, by calendar arithmetic (timezone independent). */
export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function toMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** [start, end] in minutes since midnight, or null when the job has no start time. */
function window(j: Job): [number, number] | null {
  const s = toMin(j.start_time);
  if (s == null) return null;
  return [s, s + Math.round((j.est_hours ?? 2) * 60)];
}

/**
 * Double-booking check for one job against the others on the same day: does it
 * share a truck, or any crew member, with a job whose time window overlaps?
 */
export function clashFor(job: Job, sameDay: Job[]): { truck: boolean; crewIds: string[] } {
  const w = window(job);
  const result = { truck: false, crewIds: [] as string[] };
  if (!w || job.status === "cancelled") return result;
  for (const other of sameDay) {
    if (other.id === job.id || other.status === "cancelled") continue;
    const ow = window(other);
    if (!ow || ow[0] >= w[1] || w[0] >= ow[1]) continue;
    if (job.truck_id && other.truck_id === job.truck_id) result.truck = true;
    for (const id of job.crew_ids) {
      if (other.crew_ids.includes(id) && !result.crewIds.includes(id)) result.crewIds.push(id);
    }
  }
  return result;
}
