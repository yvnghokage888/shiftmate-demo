// Day timeline for Dispatch. Each truck is a horizontal lane and the day runs
// left to right against an hour axis, so you can see where jobs sit, where trucks
// are idle and where two jobs overlap. Unassigned jobs sit in their own lane on
// top; drag a bar onto a truck lane to book that truck.
//
// A bar's right edge is dashed while the finish is an estimate (quoted hours, or
// a default for the service type) and solid once the job is completed.
import { useState } from "react";
import { toast } from "sonner";
import { useSetJobTruck } from "@/lib/mutations";
import { clashFor, SERVICE_LABEL } from "@/lib/jobsUi";
import { fmtTimeShort, nzNowHM, nzToday } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import type { Job, Truck } from "@/lib/types";

const START_H = 6;
const END_H = 20;
const AXIS_START = START_H * 60;
const AXIS_MIN = (END_H - START_H) * 60;
const ROW_H = 46;
const LANE_PAD = 6;
const DEFAULT_START = 8 * 60;
const DEFAULT_HOURS: Record<string, number> = { house_move: 5, piano: 2.5, commercial: 6, cleaning: 3 };

type Placed = { job: Job; s: number; e: number; estimated: boolean; untimed: boolean };

function toMin(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function place(job: Job): Placed {
  const start = toMin(job.start_time);
  const s = Math.max(AXIS_START, start ?? DEFAULT_START);
  const hours = job.est_hours ?? DEFAULT_HOURS[job.service_type] ?? 4;
  const e = Math.min(AXIS_START + AXIS_MIN, s + Math.round(hours * 60));
  return { job, s, e: Math.max(e, s + 30), estimated: job.status !== "completed", untimed: start == null };
}

/** Stack overlapping bars into rows so none sit on top of each other. */
function pack(jobs: Job[]): Placed[][] {
  const rows: Placed[][] = [];
  for (const p of jobs.map(place).sort((a, b) => a.s - b.s)) {
    const row = rows.find((r) => r[r.length - 1].e <= p.s);
    if (row) row.push(p);
    else rows.push([p]);
  }
  return rows.length ? rows : [[]];
}

const pct = (min: number) => `${((min - AXIS_START) / AXIS_MIN) * 100}%`;
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** A translucent version of a #rrggbb colour. */
function tint(color: string | null | undefined, alpha: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : "rgba(107,114,128,0.2)";
}

export function DispatchTimeline({
  date,
  jobs,
  trucks,
  writable,
  onOpen,
}: {
  date: string;
  jobs: Job[]; // moves for this day (cancelled already removed)
  trucks: Truck[];
  writable: boolean;
  onOpen: (job: Job) => void;
}) {
  const setTruck = useSetJobTruck();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);

  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
  const nowMin = date === nzToday() ? toMin(nzNowHM()) : null;
  const showNow = nowMin != null && nowMin >= AXIS_START && nowMin <= AXIS_START + AXIS_MIN;
  const byId = new Map(jobs.map((j) => [j.id, j]));

  function drop(truckId: string | null) {
    const id = dragId;
    setDragId(null);
    setOverLane(null);
    const job = id ? byId.get(id) : undefined;
    if (!job || job.truck_id === truckId) return;
    const target = truckId ? trucks.find((t) => t.id === truckId) : null;
    if (target?.status === "service") {
      toast(`${target.name} is in for service`);
      return;
    }
    if (truckId) {
      const moved = { ...job, truck_id: truckId };
      const others = jobs.filter((j) => j.id !== job.id && j.truck_id === truckId);
      if (clashFor(moved, [moved, ...others]).truck) {
        const ok = window.confirm(`${target?.name} is already booked at that time. Assign it anyway?`);
        if (!ok) return;
      }
    }
    setTruck.mutate(
      { id: job.id, truckId },
      {
        onSuccess: () => toast(truckId ? `${job.customer_name} assigned to ${target?.name}` : "Moved back to unassigned"),
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  // A plain render function (not a component): a component declared inside render
  // would be re-created on every state change and cancel an in-progress drag.
  function renderLane({ id, label, sub, color, list, unassigned, offline }: {
    id: string | null;
    label: string;
    sub?: string;
    color?: string | null;
    list: Job[];
    unassigned?: boolean;
    offline?: boolean;
  }) {
    const rows = pack(list);
    const laneKey = id ?? "unassigned";
    const h = rows.length * ROW_H + LANE_PAD * 2;
    const accent = unassigned ? "#ef4444" : color || "#6b7280";
    return (
      <div key={laneKey} className="flex border-b last:border-b-0">
        <div
          className="sticky left-0 z-20 flex w-36 shrink-0 flex-col justify-center border-r bg-background px-3"
          style={{ borderLeft: `3px solid ${accent}` }}
        >
          <div className="truncate text-xs font-bold" style={{ color: accent }}>
            {label}
          </div>
          {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
        </div>
        <div
          className={`relative flex-1 ${overLane === laneKey ? "bg-primary/10" : ""} ${offline ? "bg-muted/60" : ""}`}
          style={{ height: h }}
          onDragOver={(e) => {
            if (!writable || !dragId) return;
            e.preventDefault();
            if (overLane !== laneKey) setOverLane(laneKey);
          }}
          onDragLeave={() => setOverLane((l) => (l === laneKey ? null : l))}
          onDrop={(e) => {
            e.preventDefault();
            drop(id);
          }}
        >
          {hours.map((hr) => (
            <div
              key={hr}
              className="absolute inset-y-0 border-l border-border/60"
              style={{ left: pct(hr * 60) }}
            />
          ))}
          {offline && (
            <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">
              In for service
            </div>
          )}
          {showNow && <div className="absolute inset-y-0 z-10 w-px bg-red-500" style={{ left: pct(nowMin!) }} />}
          {rows.map((row, ri) =>
            row.map((p) => {
              const clash = clashFor(p.job, jobs);
              const hasClash = clash.truck || clash.crewIds.length > 0;
              const done = p.job.status === "completed";
              return (
                <div
                  key={p.job.id}
                  draggable={writable}
                  onDragStart={(e) => {
                    setDragId(p.job.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverLane(null);
                  }}
                  onClick={() => onOpen(p.job)}
                  title={`${p.job.customer_name} · ${hm(p.s)}–${hm(p.e)}${p.estimated ? " (est.)" : ""}${hasClash ? " · CLASH" : ""}`}
                  className={`absolute cursor-pointer select-none overflow-hidden rounded-md border px-2 py-1 text-xs ${
                    hasClash ? "ring-2 ring-destructive" : ""
                  } ${dragId === p.job.id ? "opacity-40" : ""}`}
                  style={{
                    left: pct(p.s),
                    width: `${((p.e - p.s) / AXIS_MIN) * 100}%`,
                    top: LANE_PAD + ri * ROW_H,
                    height: ROW_H - 6,
                    background: unassigned ? "rgba(239,68,68,0.18)" : tint(color, "40"),
                    borderColor: accent,
                    borderStyle: p.untimed ? "dashed" : "solid",
                    borderRightStyle: done ? "solid" : "dashed",
                    borderRightWidth: done ? 3 : 2,
                  }}
                >
                  <div className="truncate font-semibold">{p.job.customer_name}</div>
                  <div className="truncate opacity-75">
                    {p.untimed ? "TBC" : fmtTimeShort(p.job.start_time)} → {p.estimated ? "~" : ""}
                    {hm(p.e)} · {SERVICE_LABEL[p.job.service_type]}
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </div>
    );
  }

  const unassigned = jobs.filter((j) => !j.truck_id);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-[980px]">
          <div className="flex border-b bg-muted/40">
            <div className="sticky left-0 z-20 w-36 shrink-0 border-r bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Truck
            </div>
            <div className="relative h-7 flex-1">
              {hours.slice(0, -1).map((hr) => (
                <div
                  key={hr}
                  className="absolute top-0 -translate-x-1/2 pt-1.5 text-[10px] tabular-nums text-muted-foreground"
                  style={{ left: pct(hr * 60) }}
                >
                  {hr > 12 ? hr - 12 : hr}
                  {hr >= 12 ? "pm" : "am"}
                </div>
              ))}
            </div>
          </div>

          {renderLane({
            id: null,
            label: "Unassigned",
            sub: `${unassigned.length} job${unassigned.length === 1 ? "" : "s"}`,
            list: unassigned,
            unassigned: true,
          })}
          {trucks.map((t) =>
            renderLane({
              id: t.id,
              label: t.name,
              sub: [t.type, t.registration].filter(Boolean).join(" · "),
              color: t.color,
              list: jobs.filter((j) => j.truck_id === t.id),
              offline: t.status === "service",
            }),
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {writable ? "Drag a job onto a truck to book it. " : ""}
        Dashed right edge = estimated finish. Red outline = double-booked. Click a job to edit.
      </p>
    </div>
  );
}
