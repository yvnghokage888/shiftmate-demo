// React Query data layer. Replaces store.tsx's AppDataProvider/loadAll with
// per-resource hooks. Selects/filters are ported VERBATIM from the old loadAll
// so behaviour is identical; realtime invalidation (useRealtime) keeps them live.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./store";
import { supabase } from "./supabase";
import { qk } from "./queryClient";
import type {
  ClockLog,
  Grant,
  HrNote,
  NotificationRow,
  Perms,
  PermissionRow,
  RecurBlock,
  ResourceKey,
  Shift,
  Staff,
  StaffTag,
  Truck,
  TruckLog,
} from "./types";

// "Mark all read" clears the feed up to this time so cleared items don't reappear
// on reopen (only newer changes repopulate). Mirrors the vanilla localStorage key.
export const NOTIF_CLEARED_KEY = "shiftmate_notifs_cleared_at";

/* --------------------------------------------------------------- date window */
// ±5 weeks around today, as YYYY-MM-DD (the roster view will refine alignment).
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function shiftWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 35);
  const end = new Date(now);
  end.setDate(end.getDate() + 35);
  return { start: ymd(start), end: ymd(end) };
}

function useUid(): string | null {
  const { session } = useAuth();
  return session?.user.id ?? null;
}

/* ------------------------------------------------------------------ identity */

export type Me = Pick<Staff, "id" | "name" | "is_manager" | "user_id">;

export function useMe() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.me(uid),
    enabled: !!uid,
    queryFn: async (): Promise<Me> => {
      const { data, error } = await supabase
        .from("staff")
        .select("id,name,is_manager,user_id")
        .eq("user_id", uid)
        .single();
      if (error) throw error;
      return data as Me;
    },
  });
}

/* --------------------------------------------------------------- permissions */

export function usePermissions() {
  const uid = useUid();
  const { data: me } = useMe();
  const isManager = !!me?.is_manager;

  const query = useQuery({
    queryKey: qk.permissions(uid),
    enabled: !!me,
    queryFn: async (): Promise<Perms> => {
      const { data, error } = await supabase.rpc("my_permissions");
      if (error) throw error;
      const pm: Perms = {};
      for (const row of (data ?? []) as PermissionRow[]) {
        pm[row.resource as ResourceKey] = {
          read: !!row.can_read,
          write: !!row.can_write,
        };
      }
      return pm;
    },
  });

  const perms = query.data ?? {};
  const canRead = (r: ResourceKey) => isManager || !!perms[r]?.read;
  const canWrite = (r: ResourceKey) => isManager || !!perms[r]?.write;
  return { perms, isManager, canRead, canWrite, query };
}

/* ----------------------------------------------------------------- resources */

export function useStaff() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.staff(),
    enabled: !!uid,
    queryFn: async (): Promise<Staff[]> => {
      const { data, error } = await supabase
        .from("staff")
        .select(
          "id,name,email,phone,is_manager,user_id,active,has_pin,tag_ids,min_hours,must_change_password",
        )
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });
}

export function useShifts(range?: { start: string; end: string }) {
  const uid = useUid();
  const { start, end } = range ?? shiftWindow();
  return useQuery({
    queryKey: qk.shifts(start, end),
    enabled: !!uid,
    queryFn: async (): Promise<Shift[]> => {
      const { data, error } = await supabase
        .from("shifts")
        .select(
          "id,staff_id,job_name,date,start_time,duration_hours,shift_type,notes,published",
        )
        .gte("date", start)
        .lte("date", end)
        .order("date")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });
}

export function useClockLogs() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.clockLogs(),
    enabled: !!uid,
    queryFn: async (): Promise<ClockLog[]> => {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data, error } = await supabase
        .from("clock_logs")
        .select("id,staff_id,date,clock_in,clock_out,note,took_break")
        .gte("date", ymd(since))
        .order("date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ClockLog[];
    },
  });
}

export function useTrucks() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.trucks(),
    enabled: !!uid,
    queryFn: async (): Promise<Truck[]> => {
      const { data, error } = await supabase
        .from("trucks")
        .select(
          "id,name,registration,type,status,notes,active,color,wof_expiry,rego_expiry",
        )
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Truck[];
    },
  });
}

export function useTruckLogs() {
  const { data: me } = useMe();
  const isManager = !!me?.is_manager;
  return useQuery({
    queryKey: qk.truckLogs(),
    enabled: isManager, // manager-only fetch, mirroring loadAll
    queryFn: async (): Promise<TruckLog[]> => {
      const { data, error } = await supabase
        .from("truck_logs")
        .select("id,truck_id,log_date,type,detail,cost,created_at")
        .order("log_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TruckLog[];
    },
  });
}

export function useStaffTags() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.staffTags(),
    enabled: !!uid,
    queryFn: async (): Promise<StaffTag[]> => {
      const { data, error } = await supabase
        .from("staff_tags")
        .select("id,name,color,sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as StaffTag[];
    },
  });
}

export function useRecurBlocks() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.recurBlocks(),
    enabled: !!uid,
    queryFn: async (): Promise<RecurBlock[]> => {
      const { data, error } = await supabase
        .from("staff_recurring_unavailable")
        .select("id,staff_id,weekday,reason");
      if (error) throw error;
      return (data ?? []) as RecurBlock[];
    },
  });
}

/* -------------------------------------------------------------- notifications */
// Own feed (latest 40), keyed by staff id. The localStorage "cleared at" cut is
// applied here so a Mark-all-read hides older items without deleting them — same
// behaviour as vanilla loadNotifications. Fails quiet (→ []) if the table is
// missing, matching the vanilla pre-migration guard.

export function useNotifications() {
  const { data: me } = useMe();
  const staffId = me?.id ?? null;
  return useQuery({
    queryKey: qk.notifications(staffId),
    enabled: !!staffId,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,type,title,body,shift_date,created_at,read_at")
        .eq("staff_id", staffId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) return [];
      const clearedAt = localStorage.getItem(NOTIF_CLEARED_KEY);
      const cut = clearedAt ? new Date(clearedAt).getTime() : 0;
      return ((data ?? []) as NotificationRow[]).filter(
        (n) => new Date(n.created_at).getTime() > cut,
      );
    },
  });
}

/* ----------------------------------------------------------------- timesheets */
// The week view reuses the in-memory ±5wk window (useShifts/useClockLogs). A
// custom From–To range, and the whole-month CSV export, are fetched fresh since
// they can fall outside that window. Both respect the timesheets read grant:
// without it, the query is scoped to the current user's own rows.

export interface TimesheetData {
  shifts: Shift[];
  logs: ClockLog[];
}

async function fetchTimesheet(
  from: string,
  to: string,
  canT: boolean,
  staffId: string | null,
): Promise<TimesheetData> {
  let shiftsQ = supabase
    .from("shifts")
    .select("id,staff_id,job_name,date,start_time,duration_hours,shift_type,notes,published")
    .gte("date", from)
    .lte("date", to)
    .eq("shift_type", "shift");
  let logsQ = supabase
    .from("clock_logs")
    .select("id,staff_id,date,clock_in,clock_out,note,took_break")
    .gte("date", from)
    .lte("date", to);
  if (!canT) {
    shiftsQ = shiftsQ.eq("staff_id", staffId);
    logsQ = logsQ.eq("staff_id", staffId);
  }
  const [sh, lg] = await Promise.all([shiftsQ, logsQ]);
  if (sh.error) throw sh.error;
  if (lg.error) throw lg.error;
  return { shifts: (sh.data ?? []) as Shift[], logs: (lg.data ?? []) as ClockLog[] };
}

export function useTimesheetRange(from: string | null, to: string | null) {
  const { canRead } = usePermissions();
  const { data: me } = useMe();
  const canT = canRead("timesheets");
  const staffId = me?.id ?? null;
  return useQuery({
    queryKey: ["ts_range", from, to, canT, staffId],
    enabled: !!(from && to),
    queryFn: () => fetchTimesheet(from!, to!, canT, staffId),
  });
}

/** One-shot month fetch for CSV export (not a hook). */
export function fetchTimesheetMonth(
  monthStart: string,
  monthEnd: string,
  canT: boolean,
  staffId: string | null,
): Promise<TimesheetData> {
  return fetchTimesheet(monthStart, monthEnd, canT, staffId);
}

/* -------------------------------------------------------- grants (privileges) */
// All access_grants rows — manager-only (RLS enforces, and the screen is
// manager-gated). Drives the Privileges matrix and team-inheritance display.

export function useGrants() {
  const { data: me } = useMe();
  const isManager = !!me?.is_manager;
  return useQuery({
    queryKey: qk.grants(),
    enabled: isManager,
    queryFn: async (): Promise<Grant[]> => {
      const { data, error } = await supabase
        .from("access_grants")
        .select("id,subject_type,subject_id,resource,can_read,can_write");
      if (error) throw error;
      return (data ?? []) as Grant[];
    },
  });
}

/* --------------------------------------------------------------- roster order */
// Per-user crew row ordering for the roster grid (roster_prefs.crew_order).

export function useRosterOrder() {
  const { data: me } = useMe();
  const staffId = me?.id ?? null;
  return useQuery({
    queryKey: ["roster_order", staffId],
    enabled: !!staffId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("roster_prefs")
        .select("crew_order")
        .eq("staff_id", staffId)
        .maybeSingle();
      if (error) return [];
      return ((data?.crew_order as string[] | undefined) ?? []) as string[];
    },
  });
}

/* ------------------------------------------------------------------- HR notes */
// Per-staff confidential note (RLS-gated to hr read). Fetched when the staff
// modal's HR tab opens. maybeSingle → null when no row yet.

export function useHrNote(staffId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.hrNote(staffId),
    enabled: !!staffId && enabled,
    queryFn: async (): Promise<HrNote | null> => {
      const { data, error } = await supabase
        .from("staff_hr_notes")
        .select("notes,updated_at,updated_by")
        .eq("staff_id", staffId)
        .maybeSingle();
      if (error) return null;
      return (data as HrNote) ?? null;
    },
  });
}
