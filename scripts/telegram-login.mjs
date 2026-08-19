#!/usr/bin/env node
// One-time interactive Telegram login. Run it on the HOST (not in the
// container) to turn a phone number into a reusable session string for
// scripts/telegram-appstore-sync.mjs.
//
//   TELEGRAM_ENV_FILE=/home/thomas/docker2/compose/elitev2/.env \
//     node scripts/telegram-login.mjs
//
// With TELEGRAM_ENV_FILE set, the api id/hash are read from that file and the
// resulting session is written back into it (TELEGRAM_SESSION=...), so the
// credential never passes through a terminal log. Without it, api id/hash come
// from the environment and the session is printed for manual copying.
//
// Telegram delivers the login code in the Telegram app itself when the account
// is already signed in on another device, otherwise by SMS. The session stays
// valid until it is revoked from Telegram's active-sessions list.

import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const envFile = process.env.TELEGRAM_ENV_FILE;

function readEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// Replace the value of an existing key or append the line, leaving the rest of
// the file untouched.
function writeEnvValue(file, key, value) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`${key}=${value}`, "");
  }
  fs.writeFileSync(file, lines.join("\n"), { mode: 0o600 });
}

const fromFile = readEnvFile(envFile);
const apiId = Number(process.env.TELEGRAM_API_ID || fromFile.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH || fromFile.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error(
    "TELEGRAM_API_ID and TELEGRAM_API_HASH are required" +
      (envFile ? ` (not found in ${envFile})` : "") +
      " — create an app at https://my.telegram.org"
  );
  process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 3,
});

try {
  await client.start({
    phoneNumber: () => ask("Phone number (international format, e.g. +46701234567): "),
    phoneCode: () => ask("Login code from Telegram: "),
    password: () => ask("Two-step verification password (blank if unused): "),
    onError: (err) => console.error("Login error:", err.message),
  });

  const me = await client.getMe();
  const label = me.username ? `@${me.username}` : me.firstName;
  const saved = client.session.save();

  if (envFile) {
    writeEnvValue(envFile, "TELEGRAM_SESSION", saved);
    console.log(`\nSigned in as ${label}. TELEGRAM_SESSION written to ${envFile}.`);
    console.log("Recreate the container to pick it up: docker compose up -d");
  } else {
    console.log(`\nSigned in as ${label}. Add this line to the compose .env file:\n`);
    console.log(`TELEGRAM_SESSION=${saved}\n`);
  }
} finally {
  rl.close();
  await client.disconnect().catch(() => {});
  process.exit(0);
}
