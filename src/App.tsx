import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppLayout } from "@/components/layout/AppLayout";
import { Kiosk } from "@/components/Kiosk";
import { NAV } from "@/routes/config";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ConfigMissing() {
  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-destructive">Not configured</CardTitle>
          <CardDescription>
            Supabase env vars are missing from this build.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Add <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> under Vercel → Settings →
          Environment Variables, then redeploy (Vite bakes env vars in at build
          time).
        </CardContent>
      </Card>
    </div>
  );
}

const KIOSK_DEVICE_KEY = "shiftmate_kiosk_device";

/**
 * Kiosk provisioning + lock (vanilla handleKioskSetup). A tablet is authorised
 * once via `?kiosk-setup=<code>` (validated server-side by kiosk_provision so
 * the code never ships in the bundle); afterwards the device localStorage flag
 * makes it ALWAYS open the kiosk. De-authorise with `?kiosk-setup=reset`.
 * Returns: "checking" while provisioning, "kiosk" if this device is a kiosk,
 * "normal" otherwise.
 */
function useKioskGate(): "checking" | "kiosk" | "normal" {
  const location = useLocation();
  const [state] = useState<"checking" | "kiosk" | "normal">(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("kiosk-setup")) return "checking";
    return localStorage.getItem(KIOSK_DEVICE_KEY) === "1" ? "kiosk" : "normal";
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("kiosk-setup")) return;
    const code = sp.get("kiosk-setup");
    if (code === "reset") {
      localStorage.removeItem(KIOSK_DEVICE_KEY);
      window.location.replace(window.location.pathname);
      return;
    }
    let cancelled = false;
    (async () => {
      let ok = false;
      try {
        const { data } = await supabase.rpc("kiosk_provision", { p_code: code });
        ok = data === true;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      if (ok) {
        localStorage.setItem(KIOSK_DEVICE_KEY, "1");
        window.location.replace(window.location.pathname.replace(/\/?$/, "") + "/kiosk");
      } else {
        window.location.replace(window.location.pathname);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A provisioned device is always a kiosk; so is the explicit /kiosk route.
  if (state === "checking") return "checking";
  if (state === "kiosk" || location.pathname === "/kiosk") return "kiosk";
  return "normal";
}

// Auth gate → routed shell. Providers (QueryClient, Auth, Router) live in main.tsx.
export default function App() {
  const { session, loading } = useAuth();
  const kiosk = useKioskGate();

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (kiosk === "checking") {
    return (
      <div className="grid min-h-svh place-items-center bg-neutral-950 text-neutral-400">
        Setting up kiosk…
      </div>
    );
  }
  if (kiosk === "kiosk") return <Kiosk />;
  if (loading) {
    return (
      <div className="grid min-h-svh place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        {NAV.map((n) => (
          <Route key={n.path} path={n.path} element={n.element} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
