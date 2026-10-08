// Create a Supabase Auth login for one of the demo staff and link it to the
// staff row, so you can sign in to the demo app.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL          = "https://YOUR-PROJECT.supabase.co"
//   $env:SUPABASE_SERVICE_KEY  = "<service_role key>"   # never commit or paste anywhere public
//   $env:DEMO_EMAIL            = "manager@example.com"  # must match a seeded staff email
//   $env:DEMO_PASSWORD         = "<choose a password>"
//   node scripts/make-demo-login.mjs
//
// Seeded emails: manager@example.com (manager, sees everything),
// sam@example.com (crew lead), priya@example.com (crew), and so on.

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DEMO_EMAIL, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_KEY, DEMO_EMAIL and DEMO_PASSWORD first.");
  process.exit(1);
}
if (!/\.supabase\.co/.test(SUPABASE_URL)) {
  console.error(`Refusing to run: SUPABASE_URL looks wrong -> ${SUPABASE_URL}`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: staff, error: findErr } = await admin
  .from("staff")
  .select("id,name")
  .eq("email", DEMO_EMAIL)
  .maybeSingle();
if (findErr || !staff) {
  console.error("No seeded staff row has that email. Run supabase/seed.sql first.");
  process.exit(1);
}

let uid;
const created = await admin.auth.admin.createUser({
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  email_confirm: true,
});
if (created.error) {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list.data?.users.find((u) => u.email === DEMO_EMAIL);
  if (!existing) {
    console.error("Could not create the login:", created.error.message);
    process.exit(1);
  }
  uid = existing.id;
  await admin.auth.admin.updateUserById(uid, { password: DEMO_PASSWORD, email_confirm: true });
  console.log("Login already existed; password updated.");
} else {
  uid = created.data.user.id;
  console.log("Login created.");
}

const { error: linkErr } = await admin.from("staff").update({ user_id: uid }).eq("id", staff.id);
if (linkErr) {
  console.error("Created the login but could not link it:", linkErr.message);
  process.exit(1);
}
console.log(`Linked ${DEMO_EMAIL} to ${staff.name}. You can sign in now.`);
