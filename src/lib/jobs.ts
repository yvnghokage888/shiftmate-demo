// Job → colour mapping, ported from the vanilla app. Trucks (with their own
// configured colours) take priority, then a static keyword map, then a stable
// hash-derived hue so any job name gets a consistent colour.
import type { Truck } from "./types";

export const JOB_COLOURS: Record<string, string> = {
  gullwing: "#7c3aed",
  "class 2": "#ca8a04",
  foton: "#16a34a",
  hino: "#ea580c",
  "ann office": "#0891b2",
  "dr app": "#dc2626",
  "team photo": "#0891b2",
  other: "#64748b",
};

export function jobColour(name: string | null | undefined, trucks: Truck[] = []): string {
  if (!name) return "#64748b";
  const key = name.toLowerCase().trim();
  // DB truck colours first (exact or partial name match).
  if (trucks.length) {
    const match = trucks.find((t) => t.name && key.includes(t.name.toLowerCase()));
    if (match && match.color) return match.color;
  }
  // Static keyword map.
  for (const [k, v] of Object.entries(JOB_COLOURS)) {
    if (key.includes(k)) return v;
  }
  // Deterministic hue from the name.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h},55%,40%)`;
}
