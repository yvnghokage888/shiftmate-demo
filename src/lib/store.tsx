// Auth + app-data providers for the React rewrite.
// Mirrors the vanilla app's doLogin / loadAll / canRead-canWrite (see blueprint).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  ClockLog,
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

/* ------------------------------------------------------------------ auth */

interface AuthValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, loading, signIn, signOut }),
    [session, loading, signIn, signOut],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

/* ------------------------------------------------------- app data + perms */

// ±5 weeks around today, as YYYY-MM-DD (roster view will refine alignment later).
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shiftWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 35);
  const end = new Date(now);
  end.setDate(end.getDate() + 35);
  return { start: ymd(start), end: ymd(end) };
}

interface AppData {
  ready: boolean;
  error: string | null;
  me: Pick<Staff, "id" | "name" | "is_manager" | "user_id"> | null;
  isManager: boolean;
  perms: Perms;
  staff: Staff[];
  shifts: Shift[];
  logs: ClockLog[];
  trucks: Truck[];
  truckLogs: TruckLog[];
  staffTags: StaffTag[];
  recurBlocks: RecurBlock[];
  canRead: (r: ResourceKey) => boolean;
  canWrite: (r: ResourceKey) => boolean;
  reload: () => void;
}

const AppCtx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<AppData["me"]>(null);
  const [isManager, setIsManager] = useState(false);
  const [perms, setPerms] = useState<Perms>({});
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<ClockLog[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [truckLogs, setTruckLogs] = useState<TruckLog[]>([]);
  const [staffTags, setStaffTags] = useState<StaffTag[]>([]);
  const [recurBlocks, setRecurBlocks] = useState<RecurBlock[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    (async () => {
      // Identify the signed-in staff member (drives manager gating).
      const { data: meRow, error: meErr } = await supabase
        .from("staff")
        .select("id,name,is_manager,user_id")
        .eq("user_id", userId)
        .single();

      if (cancelled) return;
      if (meErr || !meRow) {
        setError(
          "No staff record is linked to this login (staff.user_id). " +
            "Run scripts/make-test-login.mjs to link one.",
        );
        setReady(true);
        return;
      }
      setMe(meRow);
      setIsManager(!!meRow.is_manager);

      const { start, end } = shiftWindow();
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const [
        staffRes,
        shiftsRes,
        logsRes,
        trucksRes,
        tagsRes,
        permsRes,
        truckLogsRes,
        recurRes,
      ] = await Promise.all([
        supabase
          .from("staff")
          .select(
            "id,name,email,phone,is_manager,user_id,active,has_pin,tag_ids,min_hours,must_change_password",
          )
          .eq("active", true)
          .order("name"),
        supabase
          .from("shifts")
          .select(
            "id,staff_id,job_name,date,start_time,duration_hours,shift_type,notes,published",
          )
          .gte("date", start)
          .lte("date", end)
          .order("date")
          .order("start_time"),
        supabase
          .from("clock_logs")
          .select("id,staff_id,date,clock_in,clock_out,note,took_break")
          .gte("date", ymd(since))
          .order("date", { ascending: false })
          .limit(500),
        supabase
          .from("trucks")
          .select(
            "id,name,registration,type,status,notes,active,color,wof_expiry,rego_expiry",
          )
          .eq("active", true)
          .order("name"),
        supabase.from("staff_tags").select("id,name,color,sort_order").order("sort_order"),
        supabase.rpc("my_permissions"),
        meRow.is_manager
          ? supabase
              .from("truck_logs")
              .select("id,truck_id,log_date,type,detail,cost,created_at")
              .order("log_date", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("staff_recurring_unavailable")
          .select("id,staff_id,weekday,reason"),
      ]);

      if (cancelled) return;

      if (staffRes.error) {
        setError(`Failed to load staff: ${staffRes.error.message}`);
        setReady(true);
        return;
      }
      setStaff((staffRes.data ?? []) as Staff[]);
      setShifts((shiftsRes.data ?? []) as Shift[]);
      setLogs((logsRes.data ?? []) as ClockLog[]);
      setTrucks((trucksRes.data ?? []) as Truck[]);
      setStaffTags((tagsRes.data ?? []) as StaffTag[]);
      setTruckLogs((truckLogsRes.data ?? []) as TruckLog[]);
      setRecurBlocks((recurRes.data ?? []) as RecurBlock[]);

      // Build the permission matrix from my_permissions() rows (non-fatal).
      const pm: Perms = {};
      for (const row of (permsRes.data ?? []) as PermissionRow[]) {
        pm[row.resource as ResourceKey] = {
          read: !!row.can_read,
          write: !!row.can_write,
        };
      }
      setPerms(pm);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  const canRead = useCallback(
    (r: ResourceKey) => isManager || !!perms[r]?.read,
    [isManager, perms],
  );
  const canWrite = useCallback(
    (r: ResourceKey) => isManager || !!perms[r]?.write,
    [isManager, perms],
  );
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const value: AppData = {
    ready,
    error,
    me,
    isManager,
    perms,
    staff,
    shifts,
    logs,
    trucks,
    truckLogs,
    staffTags,
    recurBlocks,
    canRead,
    canWrite,
    reload,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be used within AppDataProvider");
  return v;
}
