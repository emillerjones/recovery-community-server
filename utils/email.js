import nodemailer from "nodemailer";

let transport;

function getTransport() {
  const { MAIL_USER, MAIL_APP_PASSWORD } = process.env;
  if (!MAIL_USER || !MAIL_APP_PASSWORD) throw new Error("Email is not configured.");
  transport ??= nodemailer.createTransport({
    service: "gmail",
    auth: { user: MAIL_USER, pass: MAIL_APP_PASSWORD },
  });
  return transport;
}

/** Every app email passes through here, so Gmail credentials live in one place. */
export async function sendEmail({ to, replyTo, subject, text, html }) {
  return getTransport().sendMail({
    from: `"Recovery With The Exit Drug" <${process.env.MAIL_USER}>`,
    to,
    replyTo,
    subject,
    text,
    html,
  });
}

export function clientUrl(path = "") {
  const base = process.env.CLIENT_URL?.replace(/\/$/, "");
  if (!base) throw new Error("CLIENT_URL is required for links in account emails.");
  return `${base}${path}`;
}
