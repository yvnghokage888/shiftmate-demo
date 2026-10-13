// Cleaning (/cleaning): cleaning bookings (end of tenancy, regular, deep) and the
// cleaners assigned to each. Same `jobs` table as Dispatch, filtered to the
// cleaning service type; the database gates it with its own `cleaning` grant.
import { useState } from "react";
import { toast } from "sonner";
import { useJobs, usePermissions, useStaff } from "@/lib/queries";
import { useSetJobStatus } from "@/lib/mutations";
import { fmtTimeShort, nzToday } from "@/lib/dates";
import { friendlyError } from "@/lib/format";
import { CLEAN_LABEL, STATUS_CLS, STATUS_LABEL, fmtDay, money } from "@/lib/jobsUi";
import { Button } from "@/components/ui/button";
import { JobModal } from "@/components/JobModal";
import type { Job, JobStatus } from "@/lib/types";

type Tab = "upcoming" | "done" | "all";

export function Cleaning() {
  const { data: jobs = [], isLoading } = useJobs();
  const { data: staff = [] } = useStaff();
  const { canRead, canWrite } = usePermissions();
  const setStatus = useSetJobStatus();
  const canEdit = canWrite("cleaning");
  const showMoney = canRead("invoicing");

  const [tab, setTab] = useState<Tab>("upcoming");
  const [modal, setModal] = useState<Job | "new" | null>(null);

  const today = nzToday();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const all = jobs.filter((j) => j.service_type === "cleaning");
  const upcoming = all.filter((j) => j.job_date >= today && j.status !== "cancelled" && j.status !== "completed");
  const done = all.filter((j) => j.status === "completed" || j.job_date < today);
  const shown = (tab === "upcoming" ? upcoming : tab === "done" ? done.slice().reverse() : all);

  const weekAhead = upcoming.filter((j) => {
    const d = new Date(today + "T12:00");
    d.setDate(d.getDate() + 7);
    return j.job_date <= d.toISOString().slice(0, 10);
  }).length;
  const noCleaner = upcoming.filter((j) => j.crew_ids.length === 0).length;

  const tabs: [Tab, string, number][] = [
    ["upcoming", "Upcoming", upcoming.length],
    ["done", "Completed", done.length],
    ["all", "All", all.length],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cleaning</h1>
          <p className="text-sm text-muted-foreground">Bookings and cleaner assignments.</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setModal("new")}>
            + New booking
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Upcoming bookings" value={upcoming.length} />
        <Stat label="In the next 7 days" value={weekAhead} />
        <Stat label="No cleaner assigned" value={noCleaner} warn={noCleaner > 0} />
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key ? "border-primary font-medium" : "border-transparent text-muted-foreground"
            }`}
          >
            {label} <span className="text-xs text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading bookings…</p>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No bookings here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Cleaners</th>
                {showMoney && <th className="px-3 py-2 text-right">Quote</th>}
                <th className="px-3 py-2">Status</th>
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} className={`border-b last:border-0 ${j.status === "cancelled" ? "opacity-60" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-medium">{fmtDay(j.job_date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {j.start_time ? fmtTimeShort(j.start_time) : "TBC"}
                      {j.est_hours != null ? ` · ${j.est_hours}h` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{j.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{j.customer_phone || ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{j.pickup_address || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {j.bedrooms ?? "?"} bed · {j.bathrooms ?? "?"} bath
                    </div>
                  </td>
                  <td className="px-3 py-2">{j.cleaning_type ? CLEAN_LABEL[j.cleaning_type] : "—"}</td>
                  <td className="px-3 py-2">
                    {j.crew_ids.length ? (
                      j.crew_ids.map((id) => staffName.get(id) || "—").join(", ")
                    ) : (
                      <span className="text-amber-600">Unassigned</span>
                    )}
                  </td>
                  {showMoney && <td className="px-3 py-2 text-right tabular-nums">{money(j.quote_amount)}</td>}
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <select
                        className={`rounded px-2 py-1 text-xs font-medium ${STATUS_CLS[j.status]}`}
                        value={j.status}
                        onChange={(e) =>
                          setStatus.mutate(
                            { id: j.id, status: e.target.value as JobStatus },
                            { onError: (err) => toast(friendlyError(err)) },
                          )
                        }
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
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setModal(j)}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <JobModal
          key={modal === "new" ? "new" : modal.id}
          job={modal === "new" ? null : modal}
          mode="cleaning"
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
