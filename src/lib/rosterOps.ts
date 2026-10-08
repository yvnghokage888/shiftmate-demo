// Imperative shift operations backing the roster power-features (copy / cut /
// paste / delete / block-out-day + undo). Unlike the useMutation hooks in
// mutations.ts these are plain async functions called from keyboard and
// context-menu handlers: each persists to Supabase then invalidates the shifts
// query so the grid refetches (realtime also invalidates). Ported 1:1 from the
// vanilla copySelected / pasteSelected / cutSelected / deleteSelected /
// applyBlockDay / undoLast logic — same table (shifts) and columns.
import { supabase } from "./supabase";
import { queryClient } from "./queryClient";
import type { Shift } from "./types";

const invalidate = () => queryClient.invalidateQueries({ queryKey: ["shifts"] });

/** Insert payload — the columns the vanilla app writes to `shifts`. */
export interface ShiftInsert {
  staff_id: string;
  date: string;
  job_name: string | null;
  shift_type: string;
  start_time: string | null;
  duration_hours: number | null;
  notes: string | null;
  published: boolean;
}

/** A copied single shift (vanilla _copiedShift). */
export interface CopiedShift {
  job_name: string | null;
  start_time: string | null;
  shift_type: string;
  notes: string | null;
}

/** A copied rectangular block (vanilla _copiedBlock). */
export interface CopiedCell {
  rowOff: number;
  colOff: number;
  shifts: {
    job_name: string | null;
    start_time: string | null;
    shift_type: string;
    notes: string | null;
    duration_hours: number | null;
  }[];
}
export interface CopiedBlock {
  rows: number;
  cols: number;
  cells: CopiedCell[];
}

/** Undo-stack entry shapes (vanilla _undoStack). */
export type UndoEntry =
  | { type: "paste"; ids: string[] }
  | { type: "blockPaste"; insertedIds: string[]; overwriteSnapshots: Shift[] }
  | { type: "delete"; snapshots: Shift[] }
  | {
      type: "swap";
      a: { id: string; staff_id: string; date: string };
      b: { id: string; staff_id: string; date: string };
    };

export async function insertShifts(rows: ShiftInsert[]): Promise<Shift[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase.from("shifts").insert(rows).select();
  if (error) throw error;
  await invalidate();
  return (data ?? []) as Shift[];
}

export async function deleteShiftIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("shifts").delete().in("id", ids);
  if (error) throw error;
  await invalidate();
}

/** Re-insert full shift rows preserving their ids (undo of a delete/overwrite). */
export async function restoreShifts(rows: Shift[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("shifts").upsert(rows);
  if (error) throw error;
  await invalidate();
}

/** Move a shift to a new owner/date (used by swap-undo). */
export async function reassignShift(id: string, staff_id: string, date: string): Promise<void> {
  const { error } = await supabase.from("shifts").update({ staff_id, date }).eq("id", id);
  if (error) throw error;
  await invalidate();
}

/** Revert the most recent roster action. Returns a human message or null. */
export async function applyUndo(action: UndoEntry): Promise<string> {
  if (action.type === "paste") {
    await deleteShiftIds(action.ids);
    return `Undone — removed ${action.ids.length} shift${action.ids.length > 1 ? "s" : ""}`;
  }
  if (action.type === "blockPaste") {
    await deleteShiftIds(action.insertedIds);
    await restoreShifts(action.overwriteSnapshots);
    return "Undone — original shifts restored";
  }
  if (action.type === "delete") {
    await restoreShifts(action.snapshots);
    return `Undone — restored ${action.snapshots.length} shift${action.snapshots.length > 1 ? "s" : ""}`;
  }
  // swap
  await reassignShift(action.a.id, action.a.staff_id, action.a.date);
  await reassignShift(action.b.id, action.b.staff_id, action.b.date);
  return "Undone — swap reverted";
}
