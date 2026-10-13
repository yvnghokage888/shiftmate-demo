// Shared "book this job on that truck" action used by the Dispatch board and the
// timeline. Refuses a truck that is in for service and asks before double-booking
// a truck at an overlapping time.
import { toast } from "sonner";
import { useSetJobTruck } from "@/lib/mutations";
import { clashFor } from "@/lib/jobsUi";
import { friendlyError } from "@/lib/format";
import type { Job, Truck } from "@/lib/types";

export function useAssignTruck(trucks: Truck[], dayJobs: Job[]) {
  const setTruck = useSetJobTruck();

  return function assign(job: Job, truckId: string | null) {
    if (job.truck_id === truckId) return;
    const target = truckId ? trucks.find((t) => t.id === truckId) : null;
    if (target?.status === "service") {
      toast(`${target.name} is in for service`);
      return;
    }
    if (truckId) {
      const moved = { ...job, truck_id: truckId };
      const others = dayJobs.filter((j) => j.id !== job.id && j.truck_id === truckId);
      if (clashFor(moved, [moved, ...others]).truck) {
        if (!window.confirm(`${target?.name} is already booked at that time. Assign it anyway?`)) return;
      }
    }
    setTruck.mutate(
      { id: job.id, truckId },
      {
        onSuccess: () =>
          toast(truckId ? `${job.customer_name} assigned to ${target?.name}` : "Moved back to unassigned"),
        onError: (e) => toast(friendlyError(e)),
      },
    );
  };
}
