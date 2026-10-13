// Dispatch board: one lane per truck for the selected day, with an Unassigned lane
// pinned on the left. Each job is a card; drag a card onto a truck's lane to book
// that truck for it (cards in the lane are sorted by start time).
import { useState } from "react";
import { CalendarClock, CalendarDays, CalendarX, CheckCircle2, ClockAlert } from "lucide-react";
import { useAssignTruck } from "@/lib/useAssignTruck";
import { clashFor, money, SERVICE_LABEL, STATUS_CLS, STATUS_LABEL } from "@/lib/jobsUi";
import { fmtTimeShort, addHoursToTime, nzToday } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import type { Job, Truck } from "@/lib/types";

type Col = { key: string; id: string | null; label: string; sub?: string; color: string; offline?: boolean };

/** A translucent version of a #rrggbb colour. */
function tint(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : "rgba(107,114,128,0.2)";
}

const byStart = (a: Job, b: Job) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99");

export function DispatchBoard({
  date,
  jobs,
  trucks,
  staffName,
  writable,
  showMoney,
  onOpen,
}: {
  date: string;
  jobs: Job[]; // moves for this day, cancelled already removed
  trucks: Truck[];
  staffName: Map<string, string>;
  writable: boolean;
  showMoney: boolean;
  onOpen: (job: Job) => void;
}) {
  const assign = useAssignTruck(trucks, jobs);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const today = nzToday();

  const columns: Col[] = [
    { key: "unassigned", id: null, label: "Unassigned", color: "#ef4444" },
    ...trucks.map((t) => ({
      key: t.id,
      id: t.id,
      label: t.name,
      sub: [t.type, t.registration].filter(Boolean).join(" · "),
      color: t.color || "#6b7280",
      offline: t.status === "maintenance",
    })),
  ];

  function onDrop(col: Col) {
    const job = dragId ? byId.get(dragId) : undefined;
    setDragId(null);
    setOverCol(null);
    if (job) assign(job, col.id);
  }

  function renderCol(col: Col) {
    const list = jobs.filter((j) => (col.id ? j.truck_id === col.id : !j.truck_id)).sort(byStart);
    const pinned = col.id === null;
    const isOver = overCol === col.key && writable && !col.offline;
    return (
      <div
        key={col.key}
        className={`flex flex-col overflow-hidden rounded-xl border border-board-border bg-board shadow-md transition-colors ${
          pinned ? "sticky left-0 z-20 w-[264px] shrink-0 shadow-lg" : "min-w-[248px] max-w-[300px] flex-1 basis-0"
        } ${isOver ? "border-primary" : ""} ${col.offline ? "opacity-60" : ""}`}
        style={{ background: tint(col.color, isOver ? "40" : "1f") }}
        onDragOver={(e) => {
          if (!writable || !dragId) return;
          e.preventDefault();
          if (overCol !== col.key) setOverCol(col.key);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === col.key ? null : c));
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(col);
        }}
      >
        <div
          className="flex items-center justify-between gap-1.5 rounded-t-xl border-b border-board-border px-3 py-2"
          style={{ background: tint(col.color, "55") }}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-bold leading-tight" style={{ color: col.color }}>
              {col.label}
            </span>
            {col.sub && <span className="truncate text-[10px] font-semibold uppercase tracking-wide opacity-70">{col.sub}</span>}
          </div>
          <span className="shrink-0 self-start text-sm font-semibold opacity-70" style={{ color: col.color }}>
            {col.offline ? "Maintenance" : list.length}
          </span>
        </div>

        <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {pinned ? "All assigned" : col.offline ? "In for maintenance" : "Drop a job here"}
            </p>
          ) : (
            list.map((j) => (
              <BoardCard
                key={j.id}
                job={j}
                clash={(() => {
                  const c = clashFor(j, jobs);
                  return c.truck || c.crewIds.length > 0;
                })()}
                today={today}
                staffName={staffName}
                writable={writable}
                showMoney={showMoney}
                dragging={dragId === j.id}
                onDragStart={() => setDragId(j.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCol(null);
                }}
                onOpen={() => onOpen(j)}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-date={date}>
      <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
        <div className="flex min-h-[calc(100svh-17rem)] items-stretch gap-3">{columns.map((c) => renderCol(c))}</div>
      </div>
      <p className="text-xs text-muted-foreground">
        {writable ? "Drag a card onto a truck to book it. " : ""}A red edge means the job is double-booked. Click a card to
        open it.
      </p>
    </div>
  );
}

function BoardCard({
  job,
  clash,
  today,
  staffName,
  writable,
  showMoney,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  job: Job;
  clash: boolean;
  today: string;
  staffName: Map<string, string>;
  writable: boolean;
  showMoney: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const crew = job.crew_ids.length;
  const noTime = !job.start_time;
  const fullyCrewed = !!job.truck_id && crew >= 3;
  const title = `${job.bedrooms ? `${job.bedrooms}-bed ` : ""}${SERVICE_LABEL[job.service_type].toLowerCase()}`;
  const end = job.start_time && job.est_hours != null ? addHoursToTime(job.start_time, job.est_hours) : "";
  const crewCls = crew === 0 ? "text-destructive" : "text-good";
  const when =
    job.job_date === today
      ? "Today"
      : new Date(job.job_date + "T12:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div
      draggable={writable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`select-none rounded-lg border border-job-card-border bg-job-card p-2.5 text-sm text-job-card-foreground shadow-md transition-colors hover:border-primary/60 ${
        writable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${dragging ? "opacity-40 ring-2 ring-primary" : ""} ${clash ? "border-l-4 border-l-destructive" : ""} ${
        job.status === "completed" ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block max-w-full truncate rounded-md bg-blue-500/15 px-1.5 py-0.5 text-xs font-bold leading-tight text-blue-600 dark:text-blue-300">
            {job.customer_name}
          </span>
          <span className="line-clamp-2 block min-w-0 font-medium capitalize leading-tight">{title}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {crew === 0 && <CalendarX className="size-4 text-destructive" aria-label="No crew assigned" />}
          {noTime && <ClockAlert className="size-4 text-warn" aria-label="No start time" />}
          {!noTime && !job.truck_id && <CalendarClock className="size-4 text-warn" aria-label="No truck" />}
          {fullyCrewed && <CheckCircle2 className="size-4 text-good" aria-label="Fully crewed" />}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary" className="text-[10px]">
          {SERVICE_LABEL[job.service_type]}
        </Badge>
        <span
          className={`mono inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-tight ${
            job.job_date === today ? "bg-good/15 text-good" : "bg-foreground/10 text-foreground"
          }`}
        >
          <CalendarDays className="size-3 shrink-0" />
          {when}
        </span>
        <span className="mono">{noTime ? "TBC" : `${fmtTimeShort(job.start_time)}${end ? ` – ${end}` : ""}`}</span>
        {job.status !== "scheduled" && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLS[job.status]}`}>
            {STATUS_LABEL[job.status]}
          </span>
        )}
      </div>

      {(job.pickup_address || job.dropoff_address) && (
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {job.pickup_address || "—"} → {job.dropoff_address || "—"}
        </div>
      )}
      {showMoney && job.quote_amount != null && (
        <div className="mt-1 text-xs font-medium text-foreground">{money(job.quote_amount)}</div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <span className={crewCls}>
          {crew} crew
        </span>
        {crew > 0 && (
          <span className="truncate text-muted-foreground">
            {job.crew_ids.map((id) => staffName.get(id)?.split(" ")[0] ?? "—").join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
