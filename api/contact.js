import express from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";

const router = express.Router();

const CONTACT_REASONS = new Set([
  "General questions",
  "Recovery support, not crisis support",
  "Share a success story",
  "Partnership opportunities",
  "Media or speaking inquiries",
  "Website or account help",
]);

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many messages were submitted. Please wait a few minutes and try again.",
  },
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanSingleLine(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function mailTransport() {
  const { MAIL_USER, MAIL_APP_PASSWORD } = process.env;
  if (!MAIL_USER || !MAIL_APP_PASSWORD) {
    throw new Error("Contact email is not configured.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: MAIL_USER,
      pass: MAIL_APP_PASSWORD,
    },
  });
}

router.post("/", contactLimiter, async (req, res) => {
  const { name, email, reason, message, website } = req.body ?? {};

  // Bots commonly complete hidden fields. Return success without sending so
  // the field does not reveal itself as a spam check.
  if (typeof website === "string" && website.trim()) {
    return res.status(200).send({ message: "Your message was sent." });
  }

  const cleanName = cleanSingleLine(name);
  const cleanEmail = cleanSingleLine(email).toLowerCase();
  const cleanReason = cleanSingleLine(reason);
  const cleanMessage = typeof message === "string" ? message.trim() : "";

  if (!cleanName || cleanName.length > 100) {
    return res.status(400).send({ message: "Please enter a name under 100 characters." });
  }

  if (
    !cleanEmail ||
    cleanEmail.length > 254 ||
    !emailPattern.test(cleanEmail) ||
    /[\r\n]/.test(email)
  ) {
    return res.status(400).send({ message: "Please enter a valid email address." });
  }

  if (!CONTACT_REASONS.has(cleanReason)) {
    return res.status(400).send({ message: "Please choose a valid reason for contacting us." });
  }

  if (!cleanMessage || cleanMessage.length > 4000) {
    return res.status(400).send({ message: "Please enter a message under 4,000 characters." });
  }

  const { MAIL_USER, CONTACT_TO } = process.env;
  if (!CONTACT_TO) {
    throw new Error("Contact recipient is not configured.");
  }

  await mailTransport().sendMail({
    from: `"Recovery With The Exit Drug Website" <${MAIL_USER}>`,
    to: CONTACT_TO,
    replyTo: cleanEmail,
    subject: `[Website Contact] ${cleanReason} — ${cleanName}`,
    text: [
      `Name: ${cleanName}`,
      `Email: ${cleanEmail}`,
      `Reason: ${cleanReason}`,
      "",
      "Message:",
      cleanMessage,
    ].join("\n"),
  });

  res.status(200).send({ message: "Your message was sent." });
});

export default router;
