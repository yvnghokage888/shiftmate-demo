// Core data shapes, mirrored from the vanilla app's loadAll (see blueprint).
// Backend is unchanged — only the frontend is being rebuilt.

export interface Staff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_manager: boolean;
  user_id: string | null;
  active: boolean;
  has_pin: boolean;
  tag_ids: string[];
  min_hours: number | null;
  must_change_password: boolean;
}

export interface Shift {
  id: string;
  staff_id: string;
  job_name: string | null;
  date: string; // YYYY-MM-DD
  start_time: string | null;
  duration_hours: number | null;
  shift_type: string;
  notes: string | null;
  published: boolean;
}

export interface ClockLog {
  id: string;
  staff_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  note: string | null;
  took_break: boolean | null;
}

export interface Truck {
  id: string;
  name: string;
  registration: string | null;
  type: string | null;
  status: string | null;
  notes: string | null;
  active: boolean;
  color: string | null;
  wof_expiry: string | null;
  rego_expiry: string | null;
}

export interface TruckLog {
  id: string;
  truck_id: string;
  log_date: string;
  type: string | null;
  detail: string | null;
  cost: number | null;
  created_at: string;
}

export interface StaffTag {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
}

export interface RecurBlock {
  id: string;
  staff_id: string;
  weekday: number; // 0=Sun .. 6=Sat
  reason: string | null;
}

export interface NotificationRow {
  id: string;
  type: string; // shift_added | shift_changed | shift_removed | …
  title: string;
  body: string;
  shift_date: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Grant {
  id: string;
  subject_type: "staff" | "team";
  subject_id: string;
  resource: string;
  can_read: boolean;
  can_write: boolean;
}

export interface HrNote {
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export type ResourceKey =
  | "roster"
  | "timesheets"
  | "team"
  | "fleet"
  | "hr"
  // CRM resources (CRM-0). crm_leads is folded into crm_deals.
  | "crm_deals"
  | "crm_jobs"
  | "crm_quotes"
  | "crm_financials";

export type Perms = Partial<Record<ResourceKey, { read: boolean; write: boolean }>>;

// Row shape returned by the my_permissions() RPC.
export interface PermissionRow {
  resource: string;
  can_read: boolean;
  can_write: boolean;
}
