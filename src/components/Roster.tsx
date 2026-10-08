// Roster scheduling grid (/roster). Port of vanilla renderRoster + the shift
// modal + drag-drop reschedule (move onto a cell, swap onto a block) + crew row
// reorder (roster_prefs) + team filter + recurring-unavailable display +
// tag-mismatch warning.
//
// Power-features ported from vanilla (Excel-style, modeless):
//  • Rectangular multi-cell selection (mousedown-drag across cells).
//  • Copy / cut / paste / delete of a single shift OR a rectangular block, via
//    keyboard (Ctrl+C/X/V, Delete) and the right-click context menu.
//  • Undo stack (Ctrl+Z) covering paste / blockPaste / delete / swap.
//  • Block-out-a-whole-day modal (multi-team) opened from a day header
//    (double-click / right-click), with an Unblock tab.
//  • Mobile single-day view (≤680px) with ‹ › day navigation + week rollover.
import { useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import {
  usePermissions,
  useStaff,
  useShifts,
  useTrucks,
  useStaffTags,
  useRecurBlocks,
  useRosterOrder,
} from "@/lib/queries";
import {
  useSaveShift,
  useDeleteShift,
  useMoveShift,
  useSwapShifts,
  useSaveRosterOrder,
  type ShiftPayload,
} from "@/lib/mutations";
import {
  insertShifts,
  deleteShiftIds,
  restoreShifts,
  applyUndo,
  type ShiftInsert,
  type CopiedShift,
  type CopiedBlock,
  type CopiedCell,
  type UndoEntry,
} from "@/lib/rosterOps";
import { TZ, gwk, ds, nzToday, fmtTimeShort, addHoursToTime } from "@/lib/dates";
import { ini, sanitize, friendlyError, clientRateLimit } from "@/lib/format";
import { jobColour } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";
import type { Shift, Staff, Truck, StaffTag } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RECUR_DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---- tag-mismatch helpers (vanilla teamsForJob / tagMismatch) ---- */
function tagKeyword(tag: StaffTag): string {
  return tag.name
    .toLowerCase()
    .replace(/\b(team|crew|skill|skills|move)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tagMismatch(staffId: string, jobName: string | null, staff: Staff[], tags: StaffTag[]): string[] {
  if (!jobName) return [];
  const j = jobName.toLowerCase();
  const needed = tags.filter((t) => {
    const k = tagKeyword(t);
    return k && j.includes(k);
  });
  if (!needed.length) return [];
  const have = new Set((staff.find((s) => s.id === staffId)?.tag_ids) || []);
  return needed.filter((t) => !have.has(t.id)).map((t) => t.name);
}

type EditTarget = { mode: "add"; staffId: string; date: string; type: string } | { mode: "edit"; shift: Shift };
type Sel = { staffId: string | null; date: string | null; shiftId: string | null };
type Ctx = { x: number; y: number; staffId: string; date: string; shiftId: string | null };

export function Roster() {
  const { canWrite, canRead } = usePermissions();
  const { data: staff = [] } = useStaff();
  const { data: shifts = [] } = useShifts();
  const { data: trucks = [] } = useTrucks();
  const { data: tags = [] } = useStaffTags();
  const { data: recur = [] } = useRecurBlocks();
  const { data: order = [] } = useRosterOrder();

  const swap = useSwapShifts();
  const move = useMoveShift();
  const saveOrder = useSaveRosterOrder();

  const [offset, setOffset] = useState(0);
  const [teamSel, setTeamSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [blockDay, setBlockDay] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);

  // Selection state (rendered) + mirroring refs (read by imperative handlers).
  const [sel, setSelState] = useState<Sel>({ staffId: null, date: null, shiftId: null });
  const [multiSel, setMultiSelState] = useState<Set<string>>(new Set());
  const setSel = (v: Sel) => setSelState(v);
  const setMultiSel = (v: Set<string>) => setMultiSelState(v);

  // Mobile single-day view.
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width:680px)").matches,
  );
  const [mobileDay, setMobileDay] = useState<number | null>(null);

  // Imperative refs (no re-render needed).
  const dragShift = useRef<string | null>(null);
  const dragRow = useRef<string | null>(null);
  const dragSelecting = useRef(false);
  const selAnchor = useRef<{ staffId: string; date: string } | null>(null);
  const copiedShift = useRef<CopiedShift | null>(null);
  const copiedBlock = useRef<CopiedBlock | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);

  const rw = canWrite("roster");
  const showRecurReason = canRead("hr");
  const dates = gwk(offset);
  const weekStrs = dates.map((d) => ds(d));
  const todayStr = nzToday();

  // Which day-column indices to render (all 7, or one on mobile).
  let viewIdx = dates.map((_, i) => i);
  let effDay = mobileDay;
  if (mobile) {
    if (effDay == null) {
      const ti = weekStrs.indexOf(todayStr);
      effDay = ti >= 0 ? ti : 0;
    }
    effDay = Math.max(0, Math.min(6, effDay));
    viewIdx = [effDay];
  }

  // Lookups
  const shiftsByStaffDate = new Map<string, Shift[]>();
  shifts.forEach((sh) => {
    const k = sh.staff_id + "|" + sh.date;
    const a = shiftsByStaffDate.get(k) || [];
    a.push(sh);
    shiftsByStaffDate.set(k, a);
  });
  const recurByKey = new Map(recur.map((r) => [r.staff_id + "|" + r.weekday, r]));

  // Stats
  const wsh = shifts.filter((sh) => weekStrs.includes(sh.date));
  const regular = wsh.filter((sh) => sh.shift_type === "shift");
  const crewWithShifts = new Set(regular.map((sh) => sh.staff_id)).size;
  const offStaff = new Set(wsh.filter((sh) => sh.shift_type === "time_off").map((sh) => sh.staff_id)).size;
  const slots = staff.length * 7;
  const pct = slots ? Math.min(100, Math.round((regular.length / slots) * 100)) : 0;
  const regularCountByStaff = new Map<string, number>();
  regular.forEach((sh) => regularCountByStaff.set(sh.staff_id, (regularCountByStaff.get(sh.staff_id) || 0) + 1));

  // Visible + ordered staff
  let visStaff = teamSel.size
    ? staff.filter((s) => (s.tag_ids || []).some((t) => teamSel.has(t)))
    : staff.slice();
  if (order.length) {
    const pos = new Map(order.map((id, i) => [id, i]));
    visStaff = visStaff
      .map((s, i) => [s, i] as [Staff, number])
      .sort((a, b) => {
        const pa = pos.has(a[0].id) ? pos.get(a[0].id)! : Infinity;
        const pb = pos.has(b[0].id) ? pos.get(b[0].id)! : Infinity;
        return pa !== pb ? pa - pb : a[1] - b[1];
      })
      .map((x) => x[0]);
  }
  const visIds = visStaff.map((s) => s.id);

  function findConflict(staffId: string, date: string, startTime: string | null, exclude: string[]): Shift | null {
    if (!startTime) return null;
    return (
      shifts.find(
        (sh) =>
          sh.staff_id === staffId &&
          sh.date === date &&
          sh.shift_type === "shift" &&
          sh.start_time === startTime &&
          !exclude.includes(sh.id),
      ) || null
    );
  }

  function warnTagMismatch(staffId: string, jobName: string | null) {
    const miss = tagMismatch(staffId, jobName, staff, tags);
    if (!miss.length) return;
    const name = staff.find((s) => s.id === staffId)?.name || "Staff";
    toast(`⚠ ${name} isn't in the ${miss.join(" / ")} for this job`);
  }

  function pushUndo(e: UndoEntry) {
    undoStack.current.push(e);
    if (undoStack.current.length > 20) undoStack.current.shift();
  }

  /* ---- selection ---- */
  function clearTextSel() {
    const s = window.getSelection && window.getSelection();
    if (s && !s.isCollapsed) s.removeAllRanges();
  }
  function selectCell(staffId: string | null, date: string | null, shiftId: string | null) {
    if (!rw) return;
    clearTextSel();
    selAnchor.current = null;
    const ms = new Set<string>();
    if (staffId && date) ms.add(staffId + "|" + date);
    setMultiSel(ms);
    setSel({ staffId, date, shiftId });
  }
  function beginDragSelect(staffId: string, date: string, shiftId: string | null) {
    clearTextSel();
    dragSelecting.current = true;
    selAnchor.current = { staffId, date };
    setMultiSel(new Set([staffId + "|" + date]));
    setSel({ staffId, date, shiftId });
  }
  function selRect(toStaffId: string, toDate: string) {
    const anchor = selAnchor.current;
    if (!anchor) return;
    const r1 = visIds.indexOf(anchor.staffId);
    const r2 = visIds.indexOf(toStaffId);
    const c1 = weekStrs.indexOf(anchor.date);
    const c2 = weekStrs.indexOf(toDate);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return;
    const rMin = Math.min(r1, r2), rMax = Math.max(r1, r2);
    const cMin = Math.min(c1, c2), cMax = Math.max(c1, c2);
    const next = new Set<string>();
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) next.add(visIds[r] + "|" + weekStrs[c]);
    setMultiSel(next);
  }
  const cellSelected = (staffId: string, date: string) => {
    const key = staffId + "|" + date;
    if (multiSel.size > 1) return multiSel.has(key);
    if (sel.shiftId) return false; // the block is highlighted instead
    return sel.staffId === staffId && sel.date === date;
  };
  const blockSelected = (shiftId: string) => multiSel.size <= 1 && sel.shiftId === shiftId;

  /* ---- clipboard ops (vanilla copySelected / cutSelected / pasteSelected / deleteSelected) ---- */
  function copySelected(): boolean {
    if (sel.shiftId && multiSel.size <= 1) {
      const sh = shifts.find((s) => s.id === sel.shiftId);
      if (sh) {
        copiedShift.current = { job_name: sh.job_name, start_time: sh.start_time, shift_type: sh.shift_type, notes: sh.notes };
        copiedBlock.current = null;
        setMultiSel(new Set());
        return true;
      }
    }
    if (multiSel.size >= 1) {
      let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
      multiSel.forEach((key) => {
        const [sid, d] = key.split("|");
        const r = visIds.indexOf(sid), c = weekStrs.indexOf(d);
        if (r < 0 || c < 0) return;
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      });
      if (!isFinite(rMin)) return false;
      const cells: CopiedCell[] = [];
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const sid = visIds[r], d = weekStrs[c];
          const cs = shifts
            .filter((sh) => sh.staff_id === sid && sh.date === d)
            .map((sh) => ({ job_name: sh.job_name, start_time: sh.start_time, shift_type: sh.shift_type, notes: sh.notes, duration_hours: sh.duration_hours }));
          cells.push({ rowOff: r - rMin, colOff: c - cMin, shifts: cs });
        }
      }
      const rows = rMax - rMin + 1, cols = cMax - cMin + 1;
      const oneCell = rows === 1 && cols === 1;
      if (oneCell && !cells.some((c) => c.shifts.length)) return false;
      copiedBlock.current = { rows, cols, cells };
      copiedShift.current = null;
      setMultiSel(new Set());
      selAnchor.current = null;
      setSel({ staffId: null, date: null, shiftId: null });
      toast(oneCell ? "Copied · click a target cell · Ctrl+V to paste" : `${rows}×${cols} block copied · click top-left target · Ctrl+V to paste`);
      return true;
    }
    if (!sel.shiftId) return false;
    const sh = shifts.find((s) => s.id === sel.shiftId);
    if (!sh) return false;
    copiedShift.current = { job_name: sh.job_name, start_time: sh.start_time, shift_type: sh.shift_type, notes: sh.notes };
    copiedBlock.current = null;
    setMultiSel(new Set());
    return true;
  }

  async function pasteSelected() {
    // ── Block paste ──
    if (copiedBlock.current) {
      const blk = copiedBlock.current;
      if (!sel.staffId || !sel.date) {
        toast("Click the top-left target cell first, then Ctrl+V");
        return;
      }
      const tr = visIds.indexOf(sel.staffId), tc = weekStrs.indexOf(sel.date);
      if (tr < 0 || tc < 0) {
        toast("Target cell not found on this week");
        return;
      }
      const overwriteSnapshots: Shift[] = [];
      const targets: { staffId: string; date: string; shifts: CopiedCell["shifts"] }[] = [];
      for (const cell of blk.cells) {
        const r = tr + cell.rowOff, c = tc + cell.colOff;
        if (r < 0 || r >= visIds.length || c < 0 || c >= weekStrs.length) continue;
        const sid = visIds[r], d = weekStrs[c];
        shifts.filter((sh) => sh.staff_id === sid && sh.date === d).forEach((sh) => overwriteSnapshots.push({ ...sh }));
        targets.push({ staffId: sid, date: d, shifts: cell.shifts });
      }
      if (!targets.length) {
        toast("Block extends outside the roster");
        return;
      }
      const toInsert: ShiftInsert[] = [];
      targets.forEach((t) =>
        t.shifts.forEach((sh) =>
          toInsert.push({
            staff_id: t.staffId,
            date: t.date,
            job_name: sh.job_name,
            shift_type: sh.shift_type,
            start_time: sh.start_time,
            duration_hours: sh.duration_hours ?? null,
            notes: sh.notes ?? null,
            published: true,
          }),
        ),
      );
      try {
        const overwriteIds = overwriteSnapshots.map((s) => s.id);
        if (overwriteIds.length) await deleteShiftIds(overwriteIds);
        const inserted = await insertShifts(toInsert);
        pushUndo({ type: "blockPaste", insertedIds: inserted.map((s) => s.id), overwriteSnapshots });
        const n = toInsert.length, ow = overwriteSnapshots.length;
        toast(`Pasted ${n} shift${n !== 1 ? "s" : ""}${ow ? ` · overwrote ${ow}` : ""} · Ctrl+Z to undo`);
      } catch (e) {
        if (overwriteSnapshots.length) {
          try {
            await restoreShifts(overwriteSnapshots);
          } catch {
            /* best-effort rollback */
          }
        }
        toast(friendlyError(e));
      }
      return;
    }

    // ── Single-shift paste ──
    if (!copiedShift.current) return;
    const cp = copiedShift.current;
    const targets =
      multiSel.size > 0
        ? [...multiSel].map((k) => {
            const [staffId, date] = k.split("|");
            return { staffId, date };
          })
        : sel.staffId && sel.date
          ? [{ staffId: sel.staffId, date: sel.date }]
          : [];
    if (!targets.length) {
      toast("Click one or more cells first, then Ctrl+V");
      return;
    }
    let skipped = 0;
    const payloads: ShiftInsert[] = [];
    for (const { staffId, date } of targets) {
      if (findConflict(staffId, date, cp.start_time, [])) {
        skipped++;
        continue;
      }
      payloads.push({
        staff_id: staffId,
        date,
        job_name: cp.job_name,
        shift_type: cp.shift_type,
        start_time: cp.start_time,
        duration_hours: null,
        notes: cp.notes,
        published: true,
      });
    }
    if (!payloads.length) {
      toast("Nothing pasted — all cells had conflicts");
      setMultiSel(new Set());
      return;
    }
    try {
      const inserted = await insertShifts(payloads);
      pushUndo({ type: "paste", ids: inserted.map((s) => s.id) });
      toast(
        skipped
          ? `Pasted to ${inserted.length} cell${inserted.length > 1 ? "s" : ""} · ${skipped} skipped (conflicts) · Ctrl+Z to undo`
          : `Pasted to ${inserted.length} cell${inserted.length > 1 ? "s" : ""} · Ctrl+Z to undo`,
      );
    } catch (e) {
      toast(friendlyError(e));
    }
    setMultiSel(new Set());
  }

  async function cutSelected() {
    let srcShifts: Shift[] = [];
    if (sel.shiftId && multiSel.size <= 1) {
      const sh = shifts.find((s) => s.id === sel.shiftId);
      if (sh) srcShifts.push(sh);
    } else if (multiSel.size >= 1) {
      multiSel.forEach((key) => {
        const [sid, d] = key.split("|");
        shifts.filter((sh) => sh.staff_id === sid && sh.date === d).forEach((sh) => srcShifts.push(sh));
      });
    } else if (sel.shiftId) {
      const sh = shifts.find((s) => s.id === sel.shiftId);
      if (sh) srcShifts.push(sh);
    }
    if (!copySelected()) return;
    if (!srcShifts.length) return;
    const snaps = srcShifts.map((s) => ({ ...s }));
    const ids = snaps.map((s) => s.id);
    try {
      await deleteShiftIds(ids);
      pushUndo({ type: "delete", snapshots: snaps });
      toast(`${ids.length} shift${ids.length > 1 ? "s" : ""} cut · Ctrl+V to paste · Ctrl+Z to undo`);
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  async function deleteSelected() {
    if (!rw) return;
    const toDelete: Shift[] = [];
    if (sel.shiftId && multiSel.size <= 1) {
      const sh = shifts.find((s) => s.id === sel.shiftId);
      if (sh) toDelete.push(sh);
    } else if (multiSel.size > 0) {
      multiSel.forEach((key) => {
        const [sid, d] = key.split("|");
        shifts.filter((sh) => sh.staff_id === sid && sh.date === d).forEach((sh) => toDelete.push(sh));
      });
      if (sel.shiftId && !toDelete.find((s) => s.id === sel.shiftId)) {
        const sh = shifts.find((s) => s.id === sel.shiftId);
        if (sh) toDelete.push(sh);
      }
    } else if (sel.shiftId) {
      const sh = shifts.find((s) => s.id === sel.shiftId);
      if (sh) toDelete.push(sh);
    }
    if (!toDelete.length) return;
    const snapshots = toDelete.map((s) => ({ ...s }));
    const ids = snapshots.map((s) => s.id);
    setSel({ staffId: null, date: null, shiftId: null });
    setMultiSel(new Set());
    try {
      await deleteShiftIds(ids);
      pushUndo({ type: "delete", snapshots });
      toast(`${ids.length} shift${ids.length > 1 ? "s" : ""} deleted · Ctrl+Z to undo`);
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  async function undoLast() {
    if (!rw) return;
    const action = undoStack.current.pop();
    if (!action) {
      toast("Nothing to undo");
      return;
    }
    try {
      toast(await applyUndo(action));
    } catch (e) {
      undoStack.current.push(action);
      toast(friendlyError(e));
    }
  }

  function cancelPaste() {
    copiedShift.current = null;
    copiedBlock.current = null;
    setMultiSel(new Set());
    setSel({ staffId: null, date: null, shiftId: null });
  }

  /* ---- shift drag (move / swap) ---- */
  function onCellDrop(staffId: string, date: string) {
    const id = dragShift.current;
    dragShift.current = null;
    dragSelecting.current = false;
    if (!id) return;
    const sh = shifts.find((s) => s.id === id);
    if (!sh || (sh.staff_id === staffId && sh.date === date)) return;
    if (sh.shift_type !== "comment" && findConflict(staffId, date, sh.start_time, [id])) {
      toast("Can't move — clashes with an existing shift");
      return;
    }
    move.mutate(
      { id, staff_id: staffId, date },
      { onSuccess: () => warnTagMismatch(staffId, sh.job_name), onError: (e) => toast(friendlyError(e)) },
    );
  }
  function onBlockDrop(targetId: string) {
    const id = dragShift.current;
    dragShift.current = null;
    dragSelecting.current = false;
    if (!id || id === targetId) return;
    const a = shifts.find((s) => s.id === id);
    const b = shifts.find((s) => s.id === targetId);
    if (!a || !b) return;
    const aOrig = { id: a.id, staff_id: a.staff_id, date: a.date };
    const bOrig = { id: b.id, staff_id: b.staff_id, date: b.date };
    swap.mutate(
      { a: aOrig, b: bOrig },
      {
        onSuccess: () => {
          pushUndo({ type: "swap", a: aOrig, b: bOrig });
          toast("Shifts swapped ↔ · Ctrl+Z to undo");
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  /* ---- crew row reorder ---- */
  function onRowDrop(targetId: string, below: boolean) {
    const dragged = dragRow.current;
    dragRow.current = null;
    if (!dragged || dragged === targetId) return;
    const ids = visStaff.map((s) => s.id).filter((id) => id !== dragged);
    let idx = ids.indexOf(targetId);
    if (idx < 0) idx = ids.length;
    ids.splice(below ? idx + 1 : idx, 0, dragged);
    saveOrder.mutate(ids, { onError: (e) => toast(friendlyError(e)) });
  }

  /* ---- context menu ---- */
  function openCtx(e: ReactMouseEvent, staffId: string, date: string, shiftId: string | null) {
    e.preventDefault();
    e.stopPropagation();
    if (!rw) return;
    selectCell(staffId, date, shiftId);
    const mw = 210, mh = 270;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - mw - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - mh - 8));
    setCtx({ x, y, staffId, date, shiftId });
  }
  function ctxAdd(type: string) {
    if (!ctx) return;
    setEdit({ mode: "add", staffId: ctx.staffId, date: ctx.date, type });
    setCtx(null);
  }
  function ctxEdit() {
    const id = ctx?.shiftId;
    setCtx(null);
    if (!id) return;
    const sh = shifts.find((s) => s.id === id);
    if (sh) setEdit({ mode: "edit", shift: sh });
  }
  async function ctxDel() {
    const id = ctx?.shiftId;
    setCtx(null);
    if (!id) return;
    if (!window.confirm("Delete this shift?")) return;
    const sh = shifts.find((s) => s.id === id);
    try {
      await deleteShiftIds([id]);
      if (sh) pushUndo({ type: "delete", snapshots: [sh] });
      toast("Shift deleted · Ctrl+Z to undo");
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  /* ---- document listeners: keyboard (modeless copy/paste/undo), mouseup, click-to-close ---- */
  const kbRef = useRef<(e: KeyboardEvent) => void>(() => {});
  kbRef.current = (e: KeyboardEvent) => {
    if (!rw || edit || blockDay) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest("input,textarea,select,[contenteditable]")) return;
    if (e.key === "Escape" && (copiedShift.current || copiedBlock.current)) {
      e.preventDefault();
      cancelPaste();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey) {
      if (sel.shiftId || multiSel.size > 0) {
        e.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "c") {
      const s = window.getSelection();
      if (s && String(s)) return;
      if (copySelected()) e.preventDefault();
    } else if (k === "x") {
      const s = window.getSelection();
      if (s && String(s)) return;
      if (sel.shiftId || multiSel.size > 0) {
        e.preventDefault();
        cutSelected();
      }
    } else if (k === "v" && (copiedShift.current || copiedBlock.current)) {
      e.preventDefault();
      pasteSelected();
    } else if (k === "z") {
      e.preventDefault();
      undoLast();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => kbRef.current(e);
    const onUp = () => {
      dragSelecting.current = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctx]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:680px)");
    const fn = () => setMobile(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  function mobileNav(dir: 1 | -1) {
    const nd = (effDay ?? 0) + dir;
    if (nd > 6) {
      setMobileDay(0);
      setOffset((o) => o + 1);
    } else if (nd < 0) {
      setMobileDay(6);
      setOffset((o) => o - 1);
    } else {
      setMobileDay(nd);
    }
  }

  const gridCols = {
    gridTemplateColumns: mobile ? "120px minmax(0,1fr)" : "180px repeat(7, minmax(120px, 1fr))",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Roster</h1>
          <p className="text-sm text-muted-foreground">
            {dates[0].toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ })} –{" "}
            {dates[6].toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
            ‹
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>
            This week
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + 1)}>
            ›
          </Button>
        </div>
      </div>

      {rw && (
        <p className="text-xs text-muted-foreground">
          Tip: drag to select a range · Ctrl+C / Ctrl+V to copy-paste · Del to clear · Ctrl+Z to undo · right-click for
          options · double-click a day header to block it out.
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Crew rostered" value={`${crewWithShifts}/${staff.length}`} />
        <MiniStat label="Shifts" value={String(regular.length)} />
        <MiniStat label="Off this week" value={`${offStaff}/${staff.length}`} />
        <MiniStat label="Slots filled" value={`${pct}%`} />
      </div>

      {/* Team filter */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Teams:</span>
          <button
            className={`rounded-full border px-2.5 py-1 ${teamSel.size === 0 ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setTeamSel(new Set())}
          >
            All
          </button>
          {tags.map((t) => {
            const on = teamSel.has(t.id);
            return (
              <button
                key={t.id}
                className="rounded-full border px-2.5 py-1"
                style={on ? { background: (t.color || "#888") + "22", color: t.color || "#888", borderColor: (t.color || "#888") + "66" } : undefined}
                onClick={() =>
                  setTeamSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  })
                }
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className={mobile ? "" : "min-w-[920px]"}>
          {/* Header */}
          <div className="grid border-b" style={gridCols}>
            <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Crew</div>
            {viewIdx.map((i) => {
              const d = dates[i];
              const dateStr = weekStrs[i];
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={i}
                  className={`px-2 py-2 text-center text-xs font-semibold ${isToday ? "text-primary" : "text-muted-foreground"} ${rw ? "cursor-pointer select-none hover:bg-muted/40" : ""}`}
                  title={rw ? "Double-click or right-click to block out this day" : undefined}
                  onDoubleClick={() => rw && setBlockDay(dateStr)}
                  onContextMenu={(e) => {
                    if (!rw) return;
                    e.preventDefault();
                    setBlockDay(dateStr);
                  }}
                >
                  {mobile ? (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        className="rounded border px-2 py-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          mobileNav(-1);
                        }}
                        aria-label="Previous day"
                      >
                        ‹
                      </button>
                      <span>
                        {DAYS[i]} {d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}
                      </span>
                      <button
                        className="rounded border px-2 py-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          mobileNav(1);
                        }}
                        aria-label="Next day"
                      >
                        ›
                      </button>
                    </div>
                  ) : (
                    <>
                      {DAYS[i]}
                      <span className="block">{d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {visStaff.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {teamSel.size ? "No crew in the selected team(s)." : "No staff yet."}
            </div>
          ) : (
            visStaff.map((s) => {
              const count = regularCountByStaff.get(s.id) || 0;
              return (
                <div key={s.id} className="grid border-b" style={gridCols}>
                  {/* Name cell (drag handle for reorder) */}
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    draggable={rw}
                    onDragStart={() => (dragRow.current = s.id)}
                    onDragOver={(e) => rw && dragRow.current && e.preventDefault()}
                    onDrop={(e) => {
                      if (!rw || !dragRow.current) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      onRowDrop(s.id, e.clientY > r.top + r.height / 2);
                    }}
                  >
                    <div className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold">
                      {ini(s.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      {count > 0 && <div className="text-[10px] text-muted-foreground">{count} shift{count > 1 ? "s" : ""}</div>}
                    </div>
                  </div>

                  {/* Day cells */}
                  {viewIdx.map((di) => {
                    const d = dates[di];
                    const dateStr = weekStrs[di];
                    const isToday = dateStr === todayStr;
                    const cellShifts = (shiftsByStaffDate.get(s.id + "|" + dateStr) || [])
                      .slice()
                      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
                    const recurRule = recurByKey.get(s.id + "|" + d.getDay());
                    const hasBlock = cellShifts.some((sh) => sh.shift_type === "time_off" || sh.shift_type === "break");
                    const isSel = cellSelected(s.id, dateStr);
                    return (
                      <div
                        key={di}
                        className={`min-h-14 space-y-1 border-l p-1 ${isToday ? "bg-muted/30" : ""} ${rw ? "cursor-pointer" : ""} ${isSel ? "ring-2 ring-inset ring-primary" : ""}`}
                        onMouseDown={(e) => {
                          if (!rw || e.button !== 0) return;
                          if ((e.target as HTMLElement).closest("[data-shblock]")) return;
                          e.preventDefault();
                          beginDragSelect(s.id, dateStr, null);
                        }}
                        onMouseEnter={() => {
                          if (rw && dragSelecting.current) selRect(s.id, dateStr);
                        }}
                        onClick={(e) => {
                          if (!rw) return;
                          if ((e.target as HTMLElement).closest("[data-shblock]")) return;
                          selectCell(s.id, dateStr, null);
                        }}
                        onDoubleClick={(e) => {
                          if (!rw) return;
                          if ((e.target as HTMLElement).closest("[data-shblock]")) return;
                          setEdit({ mode: "add", staffId: s.id, date: dateStr, type: "shift" });
                        }}
                        onContextMenu={(e) => openCtx(e, s.id, dateStr, null)}
                        onDragOver={(e) => rw && dragShift.current && e.preventDefault()}
                        onDrop={() => rw && onCellDrop(s.id, dateStr)}
                      >
                        {cellShifts.map((sh) => {
                          if (sh.shift_type === "comment") return null;
                          let bg = jobColour(sh.job_name, trucks);
                          if (sh.shift_type === "time_off") bg = "#ef4444";
                          else if (sh.shift_type === "break") bg = "#94a3b8";
                          const label =
                            sh.shift_type === "time_off"
                              ? sh.start_time
                                ? "TIME OFF"
                                : "DAY OFF"
                              : sh.shift_type === "break"
                                ? "UNAVAIL"
                                : sh.job_name
                                  ? sh.job_name.toUpperCase()
                                  : "SHIFT";
                          return (
                            <div
                              key={sh.id}
                              data-shblock
                              className={`rounded px-1.5 py-1 text-[11px] font-semibold text-white ${blockSelected(sh.id) ? "ring-2 ring-inset ring-white" : ""}`}
                              style={{ background: bg }}
                              draggable={rw}
                              onMouseDown={(e) => {
                                if (!rw || e.button !== 0) return;
                                e.stopPropagation();
                                beginDragSelect(s.id, dateStr, sh.id);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (rw) selectCell(s.id, dateStr, sh.id);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (rw) setEdit({ mode: "edit", shift: sh });
                              }}
                              onContextMenu={(e) => openCtx(e, s.id, dateStr, sh.id)}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                dragShift.current = sh.id;
                              }}
                              onDragOver={(e) => {
                                if (rw && dragShift.current) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }
                              }}
                              onDrop={(e) => {
                                if (!rw) return;
                                e.stopPropagation();
                                onBlockDrop(sh.id);
                              }}
                            >
                              {label}
                              {sh.start_time && <span className="block font-normal opacity-90">{fmtTimeShort(sh.start_time)}</span>}
                            </div>
                          );
                        })}
                        {recurRule && !hasBlock && (
                          <div className="rounded px-1.5 py-1 text-[11px] font-semibold text-white" style={{ background: "#94a3b8" }}>
                            UNAVAILABLE
                            {showRecurReason && recurRule.reason && (
                              <span className="block font-normal opacity-90">{recurRule.reason}</span>
                            )}
                            <span className="block font-normal opacity-70">Every {RECUR_DAY_LABEL[d.getDay()]}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {ctx && (
        <div
          className="fixed z-50 min-w-[190px] rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <CtxItem onClick={() => ctxAdd("shift")}>＋ Add Shift</CtxItem>
          <CtxItem onClick={() => ctxAdd("time_off")}>✕ Time Off / Day Off</CtxItem>
          <CtxItem onClick={() => ctxAdd("comment")}>✎ Comment / Note</CtxItem>
          <div className="my-1 border-t" />
          <CtxItem disabled={!ctx.shiftId} onClick={ctxEdit}>
            Edit Shift
          </CtxItem>
          <CtxItem disabled={!ctx.shiftId} onClick={() => copySelected()}>
            ⧉ Copy
          </CtxItem>
          <CtxItem disabled={!(copiedShift.current || copiedBlock.current)} onClick={() => pasteSelected()}>
            ⎘ Paste
          </CtxItem>
          <div className="my-1 border-t" />
          <CtxItem disabled={!ctx.shiftId} danger onClick={ctxDel}>
            Delete Shift
          </CtxItem>
        </div>
      )}

      {edit && rw && (
        <ShiftModal
          target={edit}
          staff={staff}
          trucks={trucks}
          recurBlocks={recur}
          findConflict={findConflict}
          onSaved={(staffId, jobName) => {
            warnTagMismatch(staffId, jobName);
            setEdit(null);
          }}
          onClose={() => setEdit(null)}
        />
      )}

      {blockDay && rw && (
        <BlockDayModal
          date={blockDay}
          staff={staff}
          tags={tags}
          shifts={shifts}
          pushUndo={pushUndo}
          onClose={() => setBlockDay(null)}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function CtxItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`block w-full rounded px-2 py-1.5 text-left ${disabled ? "opacity-40" : "hover:bg-muted"} ${danger ? "text-destructive" : ""}`}
    >
      {children}
    </button>
  );
}

/* ===================== Block-out-a-whole-day modal (multi-team) ===================== */

const BD_TABS: [string, string][] = [
  ["time_off", "Time off"],
  ["break", "Unavail."],
  ["comment", "Note"],
  ["unblock", "Unblock"],
];

function BlockDayModal({
  date,
  staff,
  tags,
  shifts,
  pushUndo,
  onClose,
}: {
  date: string;
  staff: Staff[];
  tags: StaffTag[];
  shifts: Shift[];
  pushUndo: (e: UndoEntry) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("time_off");
  const [teams, setTeams] = useState<Set<string>>(new Set()); // tag ids or "all"
  const [unblockTeams, setUnblockTeams] = useState<Set<string>>(new Set());
  const [span, setSpan] = useState<"day" | "slot">("day");
  const [from, setFrom] = useState("00:00");
  const [to, setTo] = useState("08:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const dlabel = new Date(date + "T12:00").toLocaleDateString("en-NZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });

  const allOn = teams.has("all");
  function toggleTeam(id: string) {
    setTeams((prev) => {
      const next = new Set(prev);
      if (id === "all") {
        if (next.has("all")) next.clear();
        else {
          next.clear();
          next.add("all");
        }
      } else if (next.has("all")) {
        next.clear();
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Unblock: which teams have blocks on this day.
  const blocks = shifts.filter((sh) => sh.date === date && sh.shift_type !== "shift");
  const blockedIds = new Set(blocks.map((b) => b.staff_id));
  const unblockableTags = tags.filter((t) => staff.some((s) => blockedIds.has(s.id) && (s.tag_ids || []).includes(t.id)));
  const ubAllOn = unblockTeams.has("all");
  function toggleUnblock(id: string) {
    setUnblockTeams((prev) => {
      const next = new Set(prev);
      if (id === "all") {
        if (next.has("all")) next.clear();
        else {
          next.clear();
          next.add("all");
        }
      } else if (next.has("all")) {
        next.clear();
        next.add(id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBlock() {
    if (busy) return;
    if (!teams.size) {
      toast("Pick at least one team (or All crew)");
      return;
    }
    if (!clientRateLimit("block_day", 10)) {
      toast("Too many requests — wait a moment");
      return;
    }
    const targets = teams.has("all")
      ? staff.slice()
      : staff.filter((s) => (s.tag_ids || []).some((tid) => teams.has(tid)));
    if (!targets.length) {
      toast("No crew in the selected team(s)");
      return;
    }
    let blkStart: string | null = null;
    let blkDur: number | null = null;
    if (span === "slot") {
      if (!from || !to) {
        toast("Enter a From and To time");
        return;
      }
      const toMin = (hm: string) => {
        const [h, m] = hm.split(":").map(Number);
        return h * 60 + m;
      };
      const mins = toMin(to) - toMin(from);
      if (mins <= 0) {
        toast('"To" must be after "From"');
        return;
      }
      blkStart = from + ":00";
      blkDur = mins / 60;
    }
    const cleanNote = sanitize(note) || null;
    const targetIds = new Set(targets.map((s) => s.id));
    const overwriteSnapshots = shifts.filter((sh) => sh.date === date && targetIds.has(sh.staff_id)).map((sh) => ({ ...sh }));
    const payloads: ShiftInsert[] = targets.map((s) => ({
      staff_id: s.id,
      date,
      job_name: null,
      shift_type: tab,
      start_time: blkStart,
      duration_hours: blkDur,
      notes: cleanNote,
      published: true,
    }));
    setBusy(true);
    try {
      const overwriteIds = overwriteSnapshots.map((s) => s.id);
      if (overwriteIds.length) await deleteShiftIds(overwriteIds);
      const inserted = await insertShifts(payloads);
      pushUndo({ type: "blockPaste", insertedIds: inserted.map((s) => s.id), overwriteSnapshots });
      const tlabel = tab === "time_off" ? (blkStart ? "time off" : "whole day off") : tab === "break" ? "unavailable" : "note";
      const spanTxt = blkStart ? ` ${fmtTimeShort(blkStart)}–${fmtTimeShort(addHoursToTime(blkStart, blkDur!))}` : "";
      const ow = overwriteSnapshots.length;
      toast(`Blocked out ${inserted.length} crew (${tlabel}${spanTxt})${ow ? ` · cleared ${ow} existing` : ""} · Ctrl+Z to undo`);
      onClose();
    } catch (e) {
      if (overwriteSnapshots.length) {
        try {
          await restoreShifts(overwriteSnapshots);
        } catch {
          /* best-effort rollback */
        }
      }
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyUnblock() {
    if (busy) return;
    if (!unblockTeams.size) {
      toast("Pick a team (or Everyone) to unblock");
      return;
    }
    if (!clientRateLimit("unblock_day", 10)) {
      toast("Too many requests — wait a moment");
      return;
    }
    const targetIds = unblockTeams.has("all")
      ? new Set(staff.map((s) => s.id))
      : new Set(staff.filter((s) => (s.tag_ids || []).some((tid) => unblockTeams.has(tid))).map((s) => s.id));
    const removed = shifts.filter((sh) => sh.date === date && sh.shift_type !== "shift" && targetIds.has(sh.staff_id));
    if (!removed.length) {
      toast("No blocks to remove for that selection");
      return;
    }
    const snapshots = removed.map((s) => ({ ...s }));
    const ids = snapshots.map((s) => s.id);
    setBusy(true);
    try {
      await deleteShiftIds(ids);
      pushUndo({ type: "delete", snapshots });
      toast(`Unblocked ${ids.length} block${ids.length > 1 ? "s" : ""} · Ctrl+Z to undo`);
      onClose();
    } catch (e) {
      toast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const pill = (on: boolean, color: string | null) =>
    on
      ? { background: color || "var(--primary)", borderColor: color || "var(--primary)", color: "#fff" }
      : { borderColor: color || undefined, color: color || undefined };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold">Block Out Day</h2>
      <p className="mb-3 text-sm text-muted-foreground">{dlabel}</p>

      <div className="mb-3 flex gap-1 rounded-md border p-1 text-sm">
        {BD_TABS.map(([v, l]) => (
          <button
            key={v}
            className={`flex-1 rounded px-2 py-1 ${tab === v ? "bg-muted font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab(v)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab !== "unblock" ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm text-muted-foreground">Teams to block out</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button className="rounded-full border px-2.5 py-1" style={pill(allOn, null)} onClick={() => toggleTeam("all")}>
                All crew
              </button>
              {tags.map((t) => (
                <button
                  key={t.id}
                  className="rounded-full border px-2.5 py-1"
                  style={pill(allOn || teams.has(t.id), t.color)}
                  onClick={() => toggleTeam(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Note (optional)</span>
            <input className="ipt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Public holiday, Team day off" />
          </label>

          <div>
            <div className="mb-1 text-sm text-muted-foreground">When</div>
            <div className="flex gap-1 rounded-md border p-1 text-sm">
              <button className={`flex-1 rounded px-2 py-1 ${span === "day" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setSpan("day")}>
                Whole day
              </button>
              <button className={`flex-1 rounded px-2 py-1 ${span === "slot" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setSpan("slot")}>
                Time slot
              </button>
            </div>
          </div>
          {span === "slot" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">From</span>
                <input className="ipt" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">To</span>
                <input className="ipt" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Already blocked — tap to unblock</div>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocks on this day to remove.</p>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs">
              <button className="rounded-full border px-2.5 py-1" style={pill(ubAllOn, null)} onClick={() => toggleUnblock("all")}>
                Everyone ({blockedIds.size})
              </button>
              {unblockableTags.map((t) => (
                <button
                  key={t.id}
                  className="rounded-full border px-2.5 py-1"
                  style={pill(ubAllOn || unblockTeams.has(t.id), t.color)}
                  onClick={() => toggleUnblock(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {tab !== "unblock" ? (
          <Button size="sm" onClick={applyBlock} disabled={busy}>
            Block Out Day
          </Button>
        ) : (
          <Button size="sm" onClick={applyUnblock} disabled={busy || blocks.length === 0}>
            Unblock
          </Button>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Shift modal (add / edit) ===================== */

const TYPE_TABS: [string, string][] = [
  ["shift", "Working"],
  ["time_off", "Time off"],
  ["break", "Unavail."],
  ["comment", "Note"],
];

function ShiftModal({
  target,
  staff,
  trucks,
  recurBlocks,
  findConflict,
  onSaved,
  onClose,
}: {
  target: EditTarget;
  staff: Staff[];
  trucks: Truck[];
  recurBlocks: { staff_id: string; weekday: number; reason: string | null }[];
  findConflict: (staffId: string, date: string, startTime: string | null, exclude: string[]) => Shift | null;
  onSaved: (staffId: string, jobName: string | null) => void;
  onClose: () => void;
}) {
  const isEdit = target.mode === "edit";
  const sh = isEdit ? target.shift : null;
  const save = useSaveShift();
  const del = useDeleteShift();

  const [type, setType] = useState(isEdit ? sh!.shift_type : target.type);
  const [staffId, setStaffId] = useState(isEdit ? sh!.staff_id : target.staffId);
  const [date, setDate] = useState(isEdit ? sh!.date : target.date);
  const [start, setStart] = useState(isEdit && sh!.start_time ? sh!.start_time.slice(0, 5) : "07:00");
  const [span, setSpan] = useState<"day" | "slot">(
    isEdit && (sh!.shift_type === "time_off" || sh!.shift_type === "break") && sh!.start_time ? "slot" : "day",
  );
  const [from, setFrom] = useState(isEdit && sh!.start_time ? sh!.start_time.slice(0, 5) : "00:00");
  const [to, setTo] = useState(
    isEdit && sh!.start_time && sh!.duration_hours ? addHoursToTime(sh!.start_time.slice(0, 5), sh!.duration_hours) : "08:00",
  );
  const [job, setJob] = useState(isEdit ? sh!.job_name || "" : "");
  const [note, setNote] = useState(isEdit ? sh!.notes || "" : "");
  const [showMore, setShowMore] = useState(false);

  const headName = staff.find((s) => s.id === staffId)?.name || "New shift";

  async function onSave() {
    if (!clientRateLimit("save_shift", 15)) {
      toast("Too many requests — wait a moment");
      return;
    }
    if (!date) {
      toast("Please select a date");
      return;
    }
    let startTime: string | null = null;
    let duration: number | null = null;
    if (type === "shift") {
      startTime = start || null;
    } else if ((type === "time_off" || type === "break") && span === "slot") {
      if (!from || !to) {
        toast("Enter a From and To time");
        return;
      }
      const toMin = (hm: string) => {
        const [h, m] = hm.split(":").map(Number);
        return h * 60 + m;
      };
      const mins = toMin(to) - toMin(from);
      if (mins <= 0) {
        toast('"To" must be after "From"');
        return;
      }
      startTime = from;
      duration = mins / 60;
    }
    const payload: ShiftPayload = {
      staff_id: staffId,
      date,
      job_name: type === "shift" ? sanitize(job) || null : null,
      shift_type: type,
      start_time: startTime,
      duration_hours: duration,
      notes: sanitize(note) || null,
      published: true,
    };
    if (payload.start_time && findConflict(payload.staff_id, payload.date, payload.start_time, isEdit ? [sh!.id] : [])) {
      const name = staff.find((s) => s.id === payload.staff_id)?.name || "Staff";
      toast(`Conflict — ${name} already has a shift at that time`);
      return;
    }
    if (type === "shift") {
      const weekday = new Date(payload.date + "T00:00:00").getDay();
      const rule = recurBlocks.find((r) => r.staff_id === payload.staff_id && r.weekday === weekday);
      if (rule) {
        const name = staff.find((s) => s.id === payload.staff_id)?.name || "This person";
        if (!window.confirm(`${name} is unavailable on ${RECUR_DAY_LABEL[weekday]}s${rule.reason ? ` — ${rule.reason}` : ""}. Schedule anyway?`))
          return;
      }
    }
    save.mutate(
      { editId: isEdit ? sh!.id : null, payload },
      {
        onSuccess: () => {
          toast(isEdit ? "Shift updated" : "Shift added");
          onSaved(payload.staff_id, payload.job_name);
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onDelete() {
    if (!isEdit) return;
    if (!window.confirm("Delete this shift?")) return;
    del.mutate(sh!.id, {
      onSuccess: () => {
        toast("Shift deleted");
        onClose();
      },
      onError: (e) => toast(friendlyError(e)),
    });
  }

  const isBlock = type === "time_off" || type === "break";

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold">{headName}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {new Date(date + "T12:00").toLocaleDateString("en-NZ", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: TZ,
        })}
      </p>

      {/* Type tabs */}
      <div className="mb-3 flex gap-1 rounded-md border p-1 text-sm">
        {TYPE_TABS.map(([v, l]) => (
          <button
            key={v}
            className={`flex-1 rounded px-2 py-1 ${type === v ? "bg-muted font-medium" : "text-muted-foreground"}`}
            onClick={() => setType(v)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {type === "shift" && (
          <>
            {trucks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {trucks.map((t) => (
                  <button
                    key={t.id}
                    className="rounded-full border px-2.5 py-1 text-xs"
                    style={job.toLowerCase() === t.name.toLowerCase() ? { background: (t.color || "#888") + "22", borderColor: (t.color || "#888") + "66" } : undefined}
                    onClick={() => setJob(t.name)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <L label="Start time">
              <input className="ipt" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </L>
          </>
        )}

        {isBlock && (
          <>
            <div className="flex gap-1 rounded-md border p-1 text-sm">
              <button className={`flex-1 rounded px-2 py-1 ${span === "day" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setSpan("day")}>
                Whole day
              </button>
              <button className={`flex-1 rounded px-2 py-1 ${span === "slot" ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setSpan("slot")}>
                Time slot
              </button>
            </div>
            {span === "slot" && (
              <div className="grid grid-cols-2 gap-3">
                <L label="From">
                  <input className="ipt" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                </L>
                <L label="To">
                  <input className="ipt" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
                </L>
              </div>
            )}
          </>
        )}

        <L label="Note for crew">
          <input className="ipt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shows on their dashboard" />
        </L>

        <button className="text-sm text-muted-foreground" onClick={() => setShowMore((m) => !m)}>
          {showMore ? "▴ Less" : "▾ More"}
        </button>
        {showMore && (
          <div className="space-y-3 rounded-md border p-3">
            <L label="Staff member">
              <select className="ipt" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </L>
            <L label="Date">
              <input className="ipt" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </L>
            {type === "shift" && (
              <L label="Custom job label">
                <input className="ipt" value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. Ann office, SPM Base" />
              </L>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2">
        {isEdit && (
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={del.isPending}>
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function L({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
