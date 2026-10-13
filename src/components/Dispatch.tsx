// Dispatch (/dispatch): the week's scheduled jobs, day by day, with the truck and
// crew assigned to each. Flags a truck or crew member booked on two overlapping
// jobs. Quote amounts show only to people who can read invoices. Writes are gated
// by the `dispatch` grant (RLS enforces it; the UI just hides the buttons).
import { useState } from "react";
import { toast } from "sonner";
import { useJobs, usePermissions, useStaff, useTrucks } from "@/lib/queries";
import { useSetJobStatus } from "@/lib/mutations";
import { TZ, ds, fmtTimeShort, gwk, nzToday } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import { SERVICE_LABEL, STATUS_CLS, STATUS_LABEL, clashFor, fmtDay, money } from "@/lib/jobsUi";
import { Button } from "@/components/ui/button";
import { JobModal } from "@/components/JobModal";
import { DispatchTimeline } from "@/components/DispatchTimeline";
import type { Job, JobStatus } from "@/lib/types";

export function Dispatch() {
  const { data: jobs = [], isLoading } = useJobs();
  const { data: staff = [] } = useStaff();
  const { data: trucks = [] } = useTrucks();
  const { canRead, canWrite } = usePermissions();
  const setStatus = useSetJobStatus();
  const canEdit = canWrite("dispatch");
  const showMoney = canRead("invoicing");

  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<"timeline" | "week">("timeline");
  const [dayOffset, setDayOffset] = useState(0);
  const [modal, setModal] = useState<Job | "new" | null>(null);

  const moves = jobs.filter((j) => j.service_type !== "cleaning");
  const dates = gwk(offset);
  const days = dates.map((d) => ds(d));
  const today = nzToday();
  const selectedDay = (() => {
    const d = new Date(today + "T12:00");
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  })();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const truckById = new Map(trucks.map((t) => [t.id, t]));

  const scopeDays = view === "timeline" ? [selectedDay] : days;
  const weekJobs = moves.filter((j) => scopeDays.includes(j.job_date));
  const live = weekJobs.filter((j) => j.status !== "cancelled");
  const noTruck = live.filter((j) => !j.truck_id).length;
  const clashCount = live.filter((j) => {
    const c = clashFor(j, moves.filter((o) => o.job_date === j.job_date));
    return c.truck || c.crewIds.length > 0;
  }).length;

  const fmt = (d: Date) => d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: TZ });
  const range = `${fmt(dates[0])} – ${fmt(dates[6])}`;

  function changeStatus(id: string, status: JobStatus) {
    setStatus.mutate({ id, status }, { onError: (e) => toast(friendlyError(e)) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dispatch</h1>
          <p className="text-sm text-muted-foreground">Scheduled jobs, trucks and crew for the week.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border text-xs">
            {(["timeline", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {v === "timeline" ? "Timeline" : "Week list"}
              </button>
            ))}
          </div>
          {view === "timeline" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDayOffset((o) => o - 1)}>
                ‹
              </Button>
              <button className="text-sm text-muted-foreground" onClick={() => setDayOffset(0)}>
                {fmtDay(selectedDay)}
                {selectedDay === today ? " · Today" : ""}
              </button>
              <Button variant="outline" size="sm" onClick={() => setDayOffset((o) => o + 1)}>
                ›
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
                ‹
              </Button>
              <button className="text-sm text-muted-foreground" onClick={() => setOffset(0)}>
                {offset === 0 ? "This week" : "Selected week"} · {range}
              </button>
              <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + 1)}>
                ›
              </Button>
            </>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setModal("new")}>
              + New job
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={view === "timeline" ? "Jobs on this day" : "Jobs this week"} value={live.length} />
        <Stat label="No truck assigned" value={noTruck} warn={noTruck > 0} />
        <Stat label="Double-bookings" value={clashCount} warn={clashCount > 0} />
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading jobs…</p>
      ) : view === "timeline" ? (
        <DispatchTimeline
          date={selectedDay}
          jobs={moves.filter((j) => j.job_date === selectedDay && j.status !== "cancelled")}
          trucks={trucks}
          writable={canEdit}
          onOpen={(j) => (canEdit ? setModal(j) : undefined)}
        />
      ) : (
        <div className="space-y-5">
          {days.map((day, i) => {
            const dayJobs = moves.filter((j) => j.job_date === day);
            if (dayJobs.length === 0 && i === 6) return null;
            return (
              <section key={day}>
                <h2 className={`mb-2 text-sm font-semibold ${day === today ? "text-primary" : "text-muted-foreground"}`}>
                  {fmtDay(day)}
                  {day === today && " · Today"}
                  <span className="ml-2 font-normal">
                    {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}
                  </span>
                </h2>
                {dayJobs.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    Nothing scheduled.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {dayJobs.map((j) => {
                      const truck = j.truck_id ? truckById.get(j.truck_id) : undefined;
                      const clash = clashFor(j, dayJobs);
                      const color = truck?.color || "#6b7280";
                      return (
                        <div
                          key={j.id}
                          className={`rounded-lg border px-4 py-3 ${j.status === "cancelled" ? "opacity-60" : ""}`}
                          style={{ borderLeft: `3px solid ${color}` }}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="w-14 text-sm font-semibold tabular-nums">
                              {j.start_time ? fmtTimeShort(j.start_time) : "TBC"}
                            </span>
                            <div className="min-w-40 flex-1">
                              <div className="text-sm font-medium">
                                {j.customer_name}
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                                  {SERVICE_LABEL[j.service_type]}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {j.pickup_address || "—"}
                                {j.dropoff_address ? ` → ${j.dropoff_address}` : ""}
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {j.est_hours != null ? `${j.est_hours}h` : ""}
                              {j.bedrooms ? ` · ${j.bedrooms} bed` : ""}
                            </span>
                            {showMoney && <span className="text-sm tabular-nums">{money(j.quote_amount)}</span>}
                            {canEdit ? (
                              <select
                                className={`rounded px-2 py-1 text-xs font-medium ${STATUS_CLS[j.status]}`}
                                value={j.status}
                                onChange={(e) => changeStatus(j.id, e.target.value as JobStatus)}
                              >
                                {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => (
                                  <option key={s} value={s}>
                                    {STATUS_LABEL[s]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_CLS[j.status]}`}>
                                {STATUS_LABEL[j.status]}
                              </span>
                            )}
                            {canEdit && (
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setModal(j)}>
                                Edit
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span style={{ color }} className="font-semibold">
                              {truck ? truck.name : <span className="text-amber-600">No truck</span>}
                            </span>
                            <span className="text-muted-foreground">
                              Crew:{" "}
                              {j.crew_ids.length ? (
                                j.crew_ids.map((id, k) => (
                                  <span key={id} className={clash.crewIds.includes(id) ? "font-medium text-destructive" : ""}>
                                    {staffName.get(id) || "—"}
                                    {k < j.crew_ids.length - 1 ? ", " : ""}
                                  </span>
                                ))
                              ) : (
                                <span className="text-amber-600">none assigned</span>
                              )}
                            </span>
                            {clash.truck && <span className="font-medium text-destructive">Truck double-booked</span>}
                            {clash.crewIds.length > 0 && (
                              <span className="font-medium text-destructive">Crew double-booked</span>
                            )}
                            {j.notes && <span className="text-muted-foreground">· {j.notes}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {modal && (
        <JobModal
          key={modal === "new" ? "new" : modal.id}
          job={modal === "new" ? null : modal}
          mode="dispatch"
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
