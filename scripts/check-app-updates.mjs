#!/usr/bin/env node
// Host-side App Store update checker. Calls the admin check-updates endpoint with
// the shared secret so it runs without a user session. Optionally follows up with
// update-all to auto-download new GitHub/F-Droid releases (those apps still only
// promote if APK verification passes).
//
// Env:
//   APP_UPDATE_URL     base URL (default https://elitev2.mecloud.win)
//   APP_UPDATE_SECRET  must match the container's APP_UPDATE_SECRET
//   APP_UPDATE_SOURCE  all | github | fdroid | playstore   (default all)
//   APP_UPDATE_PULL    "1" to also run update-all after checking
//
// Install as a systemd timer using the templates in scripts/systemd/.

const base = process.env.APP_UPDATE_URL || "https://elitev2.mecloud.win";
const secret = process.env.APP_UPDATE_SECRET;
const source = process.env.APP_UPDATE_SOURCE || "all";

if (!secret) {
  console.error("APP_UPDATE_SECRET is not set");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "x-app-update-secret": secret,
};

async function post(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

try {
  const checked = await post("/api/store/admin/check-updates", { source });
  console.log("check-updates:", JSON.stringify(checked));
  if (process.env.APP_UPDATE_PULL === "1") {
    const pulled = await post("/api/store/admin/update-all");
    console.log("update-all:", JSON.stringify(pulled));
  }
} catch (err) {
  console.error("App update run failed:", err.message);
  process.exit(1);
}
