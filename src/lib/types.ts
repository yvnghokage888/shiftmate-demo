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
  // Demo CRM-style screens
  | "dispatch"
  | "cleaning"
  | "invoicing"
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

export type ServiceType = "house_move" | "piano" | "commercial" | "cleaning";
export type JobStatus = "quoted" | "scheduled" | "in_progress" | "completed" | "cancelled";
export type CleaningType = "end_of_tenancy" | "regular" | "deep";

export interface Job {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  service_type: ServiceType;
  job_date: string; // YYYY-MM-DD
  start_time: string | null;
  est_hours: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  cleaning_type: CleaningType | null;
  truck_id: string | null;
  crew_ids: string[];
  status: JobStatus;
  quote_amount: number | null;
  notes: string | null;
}

export type InvoiceStatus = "draft" | "sent" | "paid";

export interface Invoice {
  id: string;
  job_id: string;
  number: string;
  issued_on: string;
  due_on: string;
  subtotal: number;
  gst: number;
  total: number;
  status: InvoiceStatus;
  paid_on: string | null;
  // Embedded via the job_id foreign key. Null when the viewer has no access to that job.
  jobs: { customer_name: string; service_type: ServiceType; job_date: string } | null;
}
