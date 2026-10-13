// Create / edit a job. Used by Dispatch (moves) and Cleaning (cleaning bookings).
// The two modes differ only in which fields show; both write the same `jobs` row.
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useStaff, useTrucks } from "@/lib/queries";
import { useSaveJob, useDeleteJob, type JobPayload } from "@/lib/mutations";
import { nzToday } from "@/lib/dates";
import { friendlyError, sanitize } from "@/lib/format";
import { CLEAN_LABEL, SERVICE_LABEL, STATUS_LABEL } from "@/lib/jobsUi";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";
import type { CleaningType, Job, JobStatus, ServiceType } from "@/lib/types";

type Mode = "dispatch" | "cleaning";

function L({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function JobModal({ job, mode, onClose }: { job: Job | null; mode: Mode; onClose: () => void }) {
  const save = useSaveJob();
  const del = useDeleteJob();
  const { data: staff = [] } = useStaff();
  const { data: trucks = [] } = useTrucks();
  const editingId = job?.id ?? null;
  const isClean = mode === "cleaning";

  const [customer, setCustomer] = useState(job?.customer_name || "");
  const [phone, setPhone] = useState(job?.customer_phone || "");
  const [service, setService] = useState<ServiceType>(job?.service_type || (isClean ? "cleaning" : "house_move"));
  const [date, setDate] = useState(job?.job_date || nzToday());
  const [start, setStart] = useState(job?.start_time?.slice(0, 5) || "08:00");
  const [hours, setHours] = useState(job?.est_hours != null ? String(job.est_hours) : "");
  const [pickup, setPickup] = useState(job?.pickup_address || "");
  const [dropoff, setDropoff] = useState(job?.dropoff_address || "");
  const [beds, setBeds] = useState(job?.bedrooms != null ? String(job.bedrooms) : "");
  const [baths, setBaths] = useState(job?.bathrooms != null ? String(job.bathrooms) : "");
  const [cleanType, setCleanType] = useState<CleaningType>(job?.cleaning_type || "regular");
  const [truckId, setTruckId] = useState(job?.truck_id || "");
  const [crew, setCrew] = useState<string[]>(job?.crew_ids || []);
  const [status, setStatus] = useState<JobStatus>(job?.status || "scheduled");
  const [quote, setQuote] = useState(job?.quote_amount != null ? String(job.quote_amount) : "");
  const [notes, setNotes] = useState(job?.notes || "");

  const crewPool = staff.filter((s) => !s.is_manager);
  const toggleCrew = (id: string) =>
    setCrew((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const numOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

  function onSave() {
    if (!customer.trim()) return void toast("Customer name is required");
    if (!date) return void toast("Date is required");
    const payload: JobPayload = {
      customer_name: sanitize(customer),
      customer_phone: sanitize(phone) || null,
      service_type: isClean ? "cleaning" : service,
      job_date: date,
      start_time: start || null,
      est_hours: numOrNull(hours),
      pickup_address: sanitize(pickup) || null,
      dropoff_address: isClean ? null : sanitize(dropoff) || null,
      bedrooms: numOrNull(beds),
      bathrooms: isClean ? numOrNull(baths) : null,
      cleaning_type: isClean ? cleanType : null,
      truck_id: isClean ? null : truckId || null,
      crew_ids: crew,
      status,
      quote_amount: numOrNull(quote),
      notes: sanitize(notes) || null,
    };
    save.mutate(
      { editingId, payload },
      {
        onSuccess: () => {
          toast(editingId ? "Job updated" : isClean ? "Booking added" : "Job added");
          onClose();
        },
        onError: (e) => toast(friendlyError(e)),
      },
    );
  }

  function onDelete() {
    if (!editingId || !window.confirm(`Delete the job for ${job?.customer_name}? Its invoice is deleted too.`)) return;
    del.mutate(editingId, {
      onSuccess: () => {
        toast("Job deleted");
        onClose();
      },
      onError: (e) => toast(friendlyError(e)),
    });
  }

  return (
    <Modal onClose={onClose} wide>
      <h2 className="mb-4 text-lg font-semibold">
        {editingId ? "Edit" : "New"} {isClean ? "cleaning booking" : "job"}
      </h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <L label="Customer">
            <input className="ipt" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </L>
          <L label="Phone">
            <input className="ipt" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </L>
        </div>

        {!isClean && (
          <L label="Service">
            <select className="ipt" value={service} onChange={(e) => setService(e.target.value as ServiceType)}>
              {(["house_move", "piano", "commercial"] as ServiceType[]).map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABEL[s]}
                </option>
              ))}
            </select>
          </L>
        )}

        <div className="grid grid-cols-3 gap-3">
          <L label="Date">
            <input className="ipt" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </L>
          <L label="Start">
            <input className="ipt" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </L>
          <L label="Est. hours">
            <input className="ipt" type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </L>
        </div>

        <L label={isClean ? "Property address" : "Pick-up address"}>
          <input className="ipt" value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </L>
        {!isClean && (
          <L label="Drop-off address">
            <input className="ipt" value={dropoff} onChange={(e) => setDropoff(e.target.value)} />
          </L>
        )}

        {isClean ? (
          <div className="grid grid-cols-3 gap-3">
            <L label="Clean type">
              <select className="ipt" value={cleanType} onChange={(e) => setCleanType(e.target.value as CleaningType)}>
                {(Object.keys(CLEAN_LABEL) as CleaningType[]).map((c) => (
                  <option key={c} value={c}>
                    {CLEAN_LABEL[c]}
                  </option>
                ))}
              </select>
            </L>
            <L label="Bedrooms">
              <input className="ipt" type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} />
            </L>
            <L label="Bathrooms">
              <input className="ipt" type="number" min={0} value={baths} onChange={(e) => setBaths(e.target.value)} />
            </L>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <L label="Truck">
              <select className="ipt" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                <option value="">Unassigned</option>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.registration ? ` · ${t.registration}` : ""}
                  </option>
                ))}
              </select>
            </L>
            <L label="Bedrooms (moves)">
              <input className="ipt" type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} />
            </L>
          </div>
        )}

        <div>
          <span className="mb-1 block text-sm text-muted-foreground">{isClean ? "Cleaners" : "Crew"}</span>
          <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
            {crewPool.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={crew.includes(s.id)} onChange={() => toggleCrew(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <L label="Status">
            <select className="ipt" value={status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
              {(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </L>
          <L label="Quote ($, ex GST)">
            <input className="ipt" type="number" min={0} step="1" value={quote} onChange={(e) => setQuote(e.target.value)} />
          </L>
        </div>
        <L label="Notes">
          <input className="ipt" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Access, parking, special items" />
        </L>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {editingId && (
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={del.isPending}>
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={save.isPending}>
            {editingId ? "Save changes" : "Add"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
