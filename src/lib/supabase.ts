import { createClient } from "@supabase/supabase-js"

// Point these at your own Supabase project via .env.local.
// Only the publishable anon key belongs here — the service_role key must NEVER
// ship to the browser.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True only when both env vars were present at build time. The app checks this
// and shows a readable config screen instead of crashing on a blank page.
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "On Vercel: add them under Settings → Environment Variables, then REDEPLOY " +
      "(Vite inlines env vars at build time). Locally: copy .env.example to .env.local.",
  )
}

// Fall back to a harmless placeholder so createClient() never throws at import
// time (which would blank the whole page); guarded by isSupabaseConfigured.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder-anon-key",
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
