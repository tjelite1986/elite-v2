import nodemailer, { Transporter } from "nodemailer";

// SMTP configuration is read from the environment (set in the compose .env).
// When SMTP_PASS is missing the mailer is treated as not configured and all
// send calls become no-ops that log a warning, so the app keeps working in
// development without credentials.
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `Elite <${SMTP_USER}>` : "");

// Base URL used when building registration links inside emails.
export const APP_URL = (process.env.APP_URL || "https://elitev2.mecloud.win").replace(/\/$/, "");

export function isMailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS && MAIL_FROM);
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for 587 (STARTTLS)
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendMail({ to, subject, html, text }: SendArgs): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    console.warn(`[mail] SMTP not configured, skipping email to ${to}: ${subject}`);
    return;
  }
  await tx.sendMail({ from: MAIL_FROM, to, subject, html, text });
}

// Shared dark email shell so messages match the app's look in clients that
// render HTML.
function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#121212;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#1c1c22;border:1px solid #ffffff14;border-radius:16px;padding:32px;color:#f5f5f5;">
      <div style="width:44px;height:44px;border-radius:9999px;background:#ffffff22;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;margin-bottom:20px;text-align:center;line-height:44px;">E</div>
      <h1 style="font-size:20px;margin:0 0 16px;color:#ffffff;">${title}</h1>
      ${body}
    </div>
  </body></html>`;
}

// Send a registration-code invitation to a prospective member.
export async function sendInviteEmail(args: {
  to: string;
  code: string;
  note?: string | null;
}): Promise<void> {
  const { to, code, note } = args;
  const link = `${APP_URL}/register?code=${encodeURIComponent(code)}&email=${encodeURIComponent(to)}`;
  const noteLine = note
    ? `<p style="color:#bdbdbd;font-size:14px;">${escapeHtml(note)}</p>`
    : "";

  const html = shell(
    "You're invited to Elite",
    `${noteLine}
     <p style="color:#bdbdbd;font-size:14px;line-height:1.5;">You've been invited to create an account. Use the button below to register, or enter your registration code manually.</p>
     <p style="margin:24px 0;text-align:center;">
       <a href="${link}" style="display:inline-block;background:#ffffff;color:#121212;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:9999px;">Create your account</a>
     </p>
     <p style="color:#bdbdbd;font-size:14px;">Your registration code:</p>
     <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:2px;color:#ffffff;background:#ffffff10;border:1px solid #ffffff20;border-radius:10px;padding:14px;text-align:center;">${escapeHtml(code)}</p>
     <p style="color:#7a7a7a;font-size:12px;margin-top:24px;">If you weren't expecting this invitation you can safely ignore this email.</p>`
  );

  const text = `You're invited to Elite.\n\n${note ? note + "\n\n" : ""}Register here: ${link}\nYour registration code: ${code}\n\nIf you weren't expecting this, ignore this email.`;

  await sendMail({ to, subject: "Your invitation to Elite", html, text });
}

// Notify the admin that someone requested an invite.
export async function sendInviteRequestNotification(args: {
  adminEmail: string;
  requesterEmail: string;
  message?: string | null;
}): Promise<void> {
  const { adminEmail, requesterEmail, message } = args;
  const messageBlock = message
    ? `<p style="color:#bdbdbd;font-size:14px;">Message:</p>
       <p style="color:#f5f5f5;font-size:14px;background:#ffffff10;border:1px solid #ffffff20;border-radius:10px;padding:14px;">${escapeHtml(message)}</p>`
    : "";

  const html = shell(
    "New invite request",
    `<p style="color:#bdbdbd;font-size:14px;line-height:1.5;"><strong style="color:#ffffff;">${escapeHtml(requesterEmail)}</strong> requested an invite to Elite.</p>
     ${messageBlock}
     <p style="margin:24px 0;text-align:center;">
       <a href="${APP_URL}/admin" style="display:inline-block;background:#ffffff;color:#121212;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:9999px;">Review in admin</a>
     </p>`
  );

  const text = `New invite request from ${requesterEmail}.\n${message ? "\nMessage: " + message + "\n" : ""}\nReview: ${APP_URL}/admin`;

  await sendMail({
    to: adminEmail,
    subject: `Invite request from ${requesterEmail}`,
    html,
    text,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
