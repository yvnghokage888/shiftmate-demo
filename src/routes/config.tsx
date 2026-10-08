// Single source of truth for routes + permission-gated nav. Both <Routes> (in
// App.tsx) and the sidebar (in AppLayout) map over NAV, so adding a view is one
// entry. Views not yet ported render <Placeholder/>; they get swapped for real
// components phase by phase.
import type { ReactElement } from "react";
import type { ResourceKey } from "@/lib/types";
import {
  useMe,
  usePermissions,
  useStaff,
  useShifts,
  useClockLogs,
  useTrucks,
  useTruckLogs,
  useStaffTags,
  useRecurBlocks,
} from "@/lib/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmployeePortal } from "@/components/EmployeePortal";
import { CrewRoster } from "@/components/CrewRoster";
import { Timesheets } from "@/components/Timesheets";
import { Settings } from "@/components/Settings";
import { Staff } from "@/components/Staff";
import { Fleet } from "@/components/Fleet";
import { Privileges } from "@/components/Privileges";
import { Roster } from "@/components/Roster";
import { Dashboard } from "@/components/Dashboard";

export interface NavItem {
  path: string;
  label: string;
  element: ReactElement;
  /** Permission resource gating visibility (managers bypass via canRead). */
  resource?: ResourceKey;
  /** Manager-only views (no resource concept). */
  managerOnly?: boolean;
  /** Always visible (e.g. the overview + crew's own portal). */
  always?: boolean;
}

const RESOURCES: ResourceKey[] = ["roster", "timesheets", "team", "fleet", "hr"];

/** Overview: proves auth → React Query → RLS data fetch end to end. */
function Overview() {
  const me = useMe();
  const { canRead, canWrite, isManager } = usePermissions();
  const staff = useStaff();
  const shifts = useShifts();
  const logs = useClockLogs();
  const trucks = useTrucks();
  const truckLogs = useTruckLogs();
  const tags = useStaffTags();
  const recur = useRecurBlocks();

  if (me.isLoading) {
    return (
      <div className="grid min-h-[40svh] place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (me.isError || !me.data) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-destructive">No staff record linked</CardTitle>
          <CardDescription>
            This login isn't linked to a staff row (staff.user_id). Run
            scripts/make-test-login.mjs to link one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">{me.data.name}</CardTitle>
              <CardDescription>Authenticated against the dev database</CardDescription>
            </div>
            <Badge variant={isManager ? "default" : "secondary"}>
              {isManager ? "Manager" : "Crew"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Permissions
            </div>
            <div className="flex flex-wrap gap-2">
              {RESOURCES.map((r) => (
                <Badge key={r} variant={canRead(r) ? "default" : "outline"}>
                  {r}: {canRead(r) ? "R" : "–"}
                  {canWrite(r) ? "W" : ""}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Staff" n={staff.data?.length ?? 0} loading={staff.isLoading} />
            <Stat label="Shifts (±5wk)" n={shifts.data?.length ?? 0} loading={shifts.isLoading} />
            <Stat label="Clock logs" n={logs.data?.length ?? 0} loading={logs.isLoading} />
            <Stat label="Trucks" n={trucks.data?.length ?? 0} loading={trucks.isLoading} />
            <Stat label="Truck logs" n={truckLogs.data?.length ?? 0} loading={truckLogs.isLoading} />
            <Stat label="Tags" n={tags.data?.length ?? 0} loading={tags.isLoading} />
            <Stat label="Recur blocks" n={recur.data?.length ?? 0} loading={recur.isLoading} />
          </div>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Foundation verified: router + React Query + realtime invalidation + gated
        nav. Next: port the crew screens into these routes.
      </p>
    </div>
  );
}

function Stat({ label, n, loading }: { label: string; n: number; loading: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-bold tabular-nums">{loading ? "…" : n}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export const NAV: NavItem[] = [
  { path: "/", label: "Overview", element: <Overview />, always: true },
  { path: "/me", label: "My Shifts", element: <EmployeePortal />, always: true },
  { path: "/my-roster", label: "My Roster", element: <CrewRoster />, always: true },
  { path: "/roster", label: "Roster", element: <Roster />, resource: "roster" },
  { path: "/timesheets", label: "Timesheets", element: <Timesheets />, resource: "timesheets" },
  { path: "/staff", label: "Staff", element: <Staff />, resource: "team" },
  { path: "/fleet", label: "Fleet", element: <Fleet />, resource: "fleet" },
  { path: "/dashboard", label: "Dashboard", element: <Dashboard />, managerOnly: true },
  { path: "/privileges", label: "Privileges", element: <Privileges />, managerOnly: true },
  { path: "/settings", label: "Settings", element: <Settings />, always: true },
];
