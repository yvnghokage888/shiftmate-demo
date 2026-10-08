// Settings (/settings). Theme (persisted), roster default start-time (used by the
// roster screen in a later phase), and account / sign-out. Low-risk, always
// available. Preference keys are exported for reuse by other screens.
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/store";
import { useMe, usePermissions } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const THEME_KEY = "shiftmate_theme";
export const ROSTER_DEFAULT_START_KEY = "shiftmate_default_start";

export function Settings() {
  const { signOut } = useAuth();
  const { data: me } = useMe();
  const { isManager } = usePermissions();

  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [defaultStart, setDefaultStart] = useState(
    () => localStorage.getItem(ROSTER_DEFAULT_START_KEY) || "08:00",
  );

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  }

  function saveDefaultStart(v: string) {
    setDefaultStart(v);
    localStorage.setItem(ROSTER_DEFAULT_START_KEY, v);
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Theme</span>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            {dark ? "🌙 Dark" : "☀️ Light"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roster</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm">Default shift start time</div>
            <div className="text-xs text-muted-foreground">Pre-fills new shifts on the roster.</div>
          </div>
          <input
            type="time"
            value={defaultStart}
            onChange={(e) => saveDefaultStart(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{me?.name ?? "—"}</span>
            <Badge variant={isManager ? "default" : "secondary"}>{isManager ? "Manager" : "Crew"}</Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              signOut();
              toast("Signed out");
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
