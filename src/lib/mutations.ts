// Write paths for the crew screens. Mutations invalidate the relevant query keys
// on success so the UI refreshes from the server (realtime also invalidates, but
// the explicit invalidation makes the actor's own change feel instant).
import { useMutation } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { queryClient, qk } from "./queryClient";
import { useMe } from "./queries";
import { nzToday } from "./dates";
import { friendlyError } from "./format";
import type { ClockLog, Grant, Staff, ServiceType, JobStatus, CleaningType, InvoiceStatus } from "./types";

/**
 * Clock in (no open log) or clock out (close the open log). Ported from vanilla
 * submitClockAction: clock-in INSERTs a row; clock-out UPDATEs clock_out and
 * appends any note to the existing one. The "already clocked in" guard lives in
 * the DB/RLS, surfaced here as a thrown error.
 */
export function useClockMutation() {
  return useMutation({
    mutationFn: async (v: {
      staffId: string;
      openLog: ClockLog | null;
      note: string | null;
    }): Promise<"in" | "out"> => {
      const now = new Date().toISOString();
      if (!v.openLog) {
        const payload: Record<string, unknown> = {
          staff_id: v.staffId,
          date: nzToday(),
          clock_in: now,
        };
        if (v.note) payload.note = v.note;
        const { error } = await supabase.from("clock_logs").insert(payload);
        if (error) throw error;
        return "in";
      }
      const payload: Record<string, unknown> = { clock_out: now };
      if (v.note) payload.note = (v.openLog.note ? v.openLog.note + " | " : "") + v.note;
      const { error } = await supabase.from("clock_logs").update(payload).eq("id", v.openLog.id);
      if (error) throw error;
      return "out";
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.clockLogs() }),
  });
}

/**
 * Add or edit a clock_logs entry from the timesheet log-edit modal. Ported from
 * vanilla saveLog: edit UPDATEs in/out/note; add INSERTs (clock_out omitted when
 * blank so the DB default applies). Invalidates the week logs and any range query.
 */
export function useSaveLog() {
  return useMutation({
    mutationFn: async (v: {
      logId: string | null;
      staffId: string;
      date: string;
      clockIn: string;
      clockOut: string | null;
      note: string | null;
    }) => {
      if (v.logId) {
        const { error } = await supabase
          .from("clock_logs")
          .update({ clock_in: v.clockIn, clock_out: v.clockOut, note: v.note })
          .eq("id", v.logId);
        if (error) throw error;
      } else {
        const payload: Record<string, unknown> = {
          staff_id: v.staffId,
          date: v.date,
          clock_in: v.clockIn,
          note: v.note,
        };
        if (v.clockOut) payload.clock_out = v.clockOut;
        const { error } = await supabase.from("clock_logs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.clockLogs() });
      queryClient.invalidateQueries({ queryKey: ["ts_range"] });
    },
  });
}

/** Delete a clock_logs entry (vanilla deleteLog). */
export function useDeleteLog() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clock_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.clockLogs() });
      queryClient.invalidateQueries({ queryKey: ["ts_range"] });
    },
  });
}

/** Mark notifications read (all, or a subset of ids) via the mark_notifications_read RPC. */
export function useMarkNotifsRead() {
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_ids: ids ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/* ============================================================ Phase E: roster */

export interface ShiftPayload {
  staff_id: string;
  date: string;
  job_name: string | null;
  shift_type: string;
  start_time: string | null;
  duration_hours: number | null;
  notes: string | null;
  published: boolean;
}

export function useSaveShift() {
  return useMutation({
    mutationFn: async (v: { editId: string | null; payload: ShiftPayload }) => {
      if (v.editId) {
        const { error } = await supabase.from("shifts").update(v.payload).eq("id", v.editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert(v.payload);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useDeleteShift() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

/** Reschedule a shift onto another staff/day (drag-drop move). */
export function useMoveShift() {
  return useMutation({
    mutationFn: async (v: { id: string; staff_id: string; date: string }) => {
      const { error } = await supabase
        .from("shifts")
        .update({ staff_id: v.staff_id, date: v.date })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

/** Swap two shifts' staff/day (drag a block onto another block). */
export function useSwapShifts() {
  return useMutation({
    mutationFn: async (v: {
      a: { id: string; staff_id: string; date: string };
      b: { id: string; staff_id: string; date: string };
    }) => {
      const [r1, r2] = await Promise.all([
        supabase.from("shifts").update({ staff_id: v.b.staff_id, date: v.b.date }).eq("id", v.a.id),
        supabase.from("shifts").update({ staff_id: v.a.staff_id, date: v.a.date }).eq("id", v.b.id),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

/** Persist this user's crew row ordering (roster_prefs upsert). */
export function useSaveRosterOrder() {
  const { data: me } = useMe();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!me?.id) return;
      const { error } = await supabase
        .from("roster_prefs")
        .upsert(
          { staff_id: me.id, crew_order: ids, updated_at: new Date().toISOString() },
          { onConflict: "staff_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roster_order"] }),
  });
}

/* ========================================================== Phase D: managers */

export interface StaffPayload {
  name: string;
  phone: string | null;
  email: string | null;
  min_hours: number | null;
  tag_ids: string[];
}

/**
 * Add or edit a staff member. Ported from vanilla saveStaff: updates/inserts the
 * staff row, keeps the LOGIN email in lockstep (admin_set_login_email or
 * admin_create_staff_login), sets a PIN via update_staff_pin, upserts HR notes
 * when changed (hr write only), and on insert seeds a default roster-read grant.
 * Login/email-sync failures are non-fatal (returned as warnings); PIN failure
 * throws. Returns warnings + a login-ready message for the caller to toast.
 */
export function useSaveStaff() {
  const { data: me } = useMe();
  return useMutation({
    mutationFn: async (v: {
      editingId: string | null;
      before: Staff | null;
      payload: StaffPayload;
      newPin: string | null;
      hr: { changed: boolean; value: string | null } | null;
    }): Promise<{ warnings: string[]; loginMsg: string }> => {
      const warnings: string[] = [];
      let loginMsg = "";

      if (v.editingId) {
        const oldEmail = (v.before?.email || "").toLowerCase() || null;
        const newEmail = (v.payload.email || "").toLowerCase() || null;
        const emailChanged = newEmail !== oldEmail;

        const { error } = await supabase.from("staff").update(v.payload).eq("id", v.editingId);
        if (error) throw error;

        if (emailChanged) {
          if (v.before?.user_id) {
            if (newEmail) {
              const { error: e } = await supabase.rpc("admin_set_login_email", {
                p_staff_id: v.editingId,
                p_email: newEmail,
              });
              if (e) warnings.push("Saved, but login email not updated: " + friendlyError(e));
            }
          } else if (newEmail) {
            const { error: e } = await supabase.rpc("admin_create_staff_login", {
              p_staff_id: v.editingId,
            });
            if (e) warnings.push("Saved, but login could not be created: " + friendlyError(e));
          }
        }
        if (v.newPin) {
          const { error: e } = await supabase.rpc("update_staff_pin", {
            p_staff_id: v.editingId,
            p_pin: v.newPin,
          });
          if (e) throw e;
        }
        if (v.hr && v.hr.changed) {
          const { error: e } = await supabase.from("staff_hr_notes").upsert(
            {
              staff_id: v.editingId,
              notes: v.hr.value,
              updated_at: new Date().toISOString(),
              updated_by: me?.id ?? null,
            },
            { onConflict: "staff_id" },
          );
          if (e) throw e;
        }
      } else {
        const { data, error } = await supabase
          .from("staff")
          .insert({ ...v.payload, active: true })
          .select("id,email")
          .single();
        if (error) throw error;
        const row = data as { id: string; email: string | null } | null;
        const newId = row?.id;
        if (v.newPin && newId) {
          const { error: e } = await supabase.rpc("update_staff_pin", {
            p_staff_id: newId,
            p_pin: v.newPin,
          });
          if (e) throw e;
        }
        if (row?.email && newId) {
          const { data: prov, error: e } = await supabase.rpc("admin_create_staff_login", {
            p_staff_id: newId,
          });
          if (e) warnings.push("Staff added, but login could not be created: " + friendlyError(e));
          else if ((prov as { status?: string })?.status === "created")
            loginMsg = " — login ready (default password set)";
        }
        if (newId) {
          // Default access: roster read only. Non-fatal on error (vanilla behaviour).
          await supabase
            .from("access_grants")
            .insert({
              subject_type: "staff",
              subject_id: newId,
              resource: "roster",
              can_read: true,
              can_write: false,
            });
        }
      }
      return { warnings, loginMsg };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staff() });
      queryClient.invalidateQueries({ queryKey: qk.grants() });
      queryClient.invalidateQueries({ queryKey: ["hr_note"] });
    },
  });
}

/** Soft-delete a staff member (active:false). Vanilla removeStaff. */
export function useRemoveStaff() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staff() });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

/** Generate/regenerate a unique 4-digit PIN (DB returns it once for display). */
export function useGeneratePin() {
  return useMutation({
    mutationFn: async (staffId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("generate_staff_pin", { p_staff_id: staffId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.staff() }),
  });
}

/** Reset a staff login to the default password (forces change on next sign-in). */
export function useResetPassword() {
  return useMutation({
    mutationFn: async (staffId: string) => {
      const { error } = await supabase.rpc("admin_reset_password", { p_staff_id: staffId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.staff() }),
  });
}

/** Add/update a recurring-unavailable weekday rule (upsert on staff_id,weekday). */
export function useAddRecurBlock() {
  const { data: me } = useMe();
  return useMutation({
    mutationFn: async (v: { staffId: string; weekday: number; reason: string | null }) => {
      const { error } = await supabase.from("staff_recurring_unavailable").upsert(
        { staff_id: v.staffId, weekday: v.weekday, reason: v.reason, created_by: me?.id ?? null },
        { onConflict: "staff_id,weekday" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.recurBlocks() }),
  });
}

export function useDelRecurBlock() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_recurring_unavailable").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.recurBlocks() }),
  });
}

/* ------------------------------------------------------------------ fleet (D) */

export interface TruckPayload {
  name: string;
  type: string | null;
  registration: string | null;
  status: string;
  notes: string | null;
  color: string;
  wof_expiry: string | null;
  rego_expiry: string | null;
}

export function useSaveTruck() {
  return useMutation({
    mutationFn: async (v: { editingId: string | null; payload: TruckPayload }) => {
      if (v.editingId) {
        const { error } = await supabase.from("trucks").update(v.payload).eq("id", v.editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("trucks").insert({ ...v.payload, active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.trucks() }),
  });
}

export function useDeleteTruck() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("trucks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.trucks() }),
  });
}

export function useSaveTruckLog() {
  return useMutation({
    mutationFn: async (v: {
      truckId: string;
      logDate: string;
      type: string;
      detail: string | null;
      cost: number | null;
    }) => {
      const { error } = await supabase.from("truck_logs").insert({
        truck_id: v.truckId,
        log_date: v.logDate,
        type: v.type,
        detail: v.detail,
        cost: v.cost,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.truckLogs() }),
  });
}

export function useDelTruckLog() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("truck_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.truckLogs() }),
  });
}

/* ------------------------------------------------------------- privileges (D) */

export interface PrivSaveInput {
  subject: { type: "staff" | "team"; id: string; name: string };
  draft: { perms: Record<string, { read: boolean; write: boolean }>; admin: boolean };
  grants: Grant[];
  staffRow: Staff | null; // for is_manager compare on staff subjects
  resources: string[];
}

/**
 * Commit the staged privilege draft. Ported from vanilla privSave: per-resource,
 * delete the grant when both flags are off, else upsert; then sync is_manager for
 * staff subjects. Returns the list of changed resource labels for the activity log.
 */
export function usePrivSave() {
  return useMutation({
    mutationFn: async (v: PrivSaveInput): Promise<string[]> => {
      const changed: string[] = [];
      const grantFor = (res: string) =>
        v.grants.find(
          (g) =>
            g.subject_type === v.subject.type &&
            g.subject_id === v.subject.id &&
            g.resource === res,
        );

      for (const res of v.resources) {
        const g = grantFor(res);
        const cr = !!(g && g.can_read);
        const cw = !!(g && g.can_write);
        const d = v.draft.perms[res];
        if (d.read === cr && d.write === cw) continue;
        if (!d.read && !d.write) {
          if (g) {
            const { error } = await supabase.from("access_grants").delete().eq("id", g.id);
            if (error) throw error;
          }
        } else {
          const { error } = await supabase.from("access_grants").upsert(
            {
              subject_type: v.subject.type,
              subject_id: v.subject.id,
              resource: res,
              can_read: d.read,
              can_write: d.write,
            },
            { onConflict: "subject_type,subject_id,resource" },
          );
          if (error) throw error;
        }
        changed.push(res);
      }

      if (v.subject.type === "staff" && v.staffRow) {
        const wantAdmin = !!v.draft.admin;
        if (wantAdmin !== !!v.staffRow.is_manager) {
          const { error } = await supabase
            .from("staff")
            .update({ is_manager: wantAdmin })
            .eq("id", v.subject.id);
          if (error) throw error;
          changed.push("Admin Access");
        }
      }
      return changed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.grants() });
      queryClient.invalidateQueries({ queryKey: qk.staff() });
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
    },
  });
}

/* ------------------------------------------------------------- jobs + invoices */

export interface JobPayload {
  customer_name: string;
  customer_phone: string | null;
  service_type: ServiceType;
  job_date: string;
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

export function useSaveJob() {
  return useMutation({
    mutationFn: async (v: { editingId: string | null; payload: JobPayload }) => {
      if (v.editingId) {
        const { error } = await supabase.from("jobs").update(v.payload).eq("id", v.editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("jobs").insert(v.payload);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.jobs() }),
  });
}

export function useSetJobStatus() {
  return useMutation({
    mutationFn: async (v: { id: string; status: JobStatus }) => {
      const { error } = await supabase.from("jobs").update({ status: v.status }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.jobs() }),
  });
}

export function useDeleteJob() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.jobs() });
      queryClient.invalidateQueries({ queryKey: qk.invoices() });
    },
  });
}

/** Create a draft invoice for a job. The number and GST are generated by the database. */
export function useCreateInvoice() {
  return useMutation({
    mutationFn: async (v: { jobId: string; subtotal: number; dueOn: string }) => {
      const { error } = await supabase
        .from("invoices")
        .insert({ job_id: v.jobId, subtotal: v.subtotal, due_on: v.dueOn });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoices() }),
  });
}

export function useSetInvoiceStatus() {
  return useMutation({
    mutationFn: async (v: { id: string; status: InvoiceStatus }) => {
      const paid_on = v.status === "paid" ? nzToday() : null;
      const { error } = await supabase.from("invoices").update({ status: v.status, paid_on }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoices() }),
  });
}

export function useDeleteInvoice() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoices() }),
  });
}
