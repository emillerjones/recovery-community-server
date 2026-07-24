import express from "express";
import rateLimit from "express-rate-limit";
import {
  createRegistration, getInvitePreview, replaceVerificationToken, verifyEmail,
} from "#db/queries/registration";
import { createSecureToken, hashSecret } from "#utils/secureTokens";
import { clientUrl, sendEmail } from "#utils/email";

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many registration attempts. Please wait and try again." },
});
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Please wait before requesting another verification email." },
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function sendVerificationEmail(user, token) {
  const link = clientUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: user.email,
    subject: "Verify your Recovery Community email",
    text: `Hi ${user.username},\n\nVerify your email by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
  });
}

router.get("/invite/:token", async (req, res) => {
  // PERSONAL INVITE TRACE STEP 1: Register.jsx reads the secret from the URL
  // and calls here. We only return the invited email, never the stored hash.
  const invite = await getInvitePreview(hashSecret(req.params.token));
  if (!invite) return res.status(404).send({ message: "This invitation is invalid or expired." });
  res.send(invite);
});

router.post("/register", registrationLimiter, async (req, res) => {
  // REGISTRATION TRACE STEP 1: the one Register.jsx form sends all three flows
  // here. The invite link wins over a shared code; otherwise this is standard.
  const email = clean(req.body?.email).toLowerCase();
  const username = clean(req.body?.username).toLowerCase();
  const password = String(req.body?.password || "");
  const reasonForJoining = clean(req.body?.reasonForJoining);
  const howFound = clean(req.body?.howFound);
  const inviteToken = clean(req.body?.inviteToken);
  const accessCode = clean(req.body?.accessCode).toUpperCase();

  if (!emailPattern.test(email) || email.length > 254) {
    return res.status(400).send({ message: "Please enter a valid email address." });
  }
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).send({ message: "Username must be 3–30 characters using letters, numbers, dots, dashes, or underscores." });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).send({ message: "Password must be between 8 and 72 characters." });
  }
  if (!reasonForJoining || reasonForJoining.length > 1500 || !howFound || howFound.length > 500) {
    return res.status(400).send({ message: "Please answer both membership questions." });
  }
  if (req.body?.agreeRules !== true || req.body?.agreePrivacy !== true) {
    return res.status(400).send({ message: "You must accept the forum rules and privacy policy." });
  }

  const admissionMethod = inviteToken ? "personal_invite" : accessCode ? "shared_code" : "standard";
  const sourceSecret = inviteToken || accessCode;
  const { token, tokenHash } = createSecureToken();

  try {
    // REGISTRATION TRACE STEP 2: this query atomically claims any invite/code,
    // creates the unverified user/application, and stores the hashed email token.
    const user = await createRegistration({
      email, username, password, reasonForJoining, howFound, admissionMethod,
      tokenHash, sourceHash: sourceSecret ? hashSecret(sourceSecret) : null,
    });
    if (!user) return res.status(400).send({ message: "That invitation or shared code is invalid, expired, or already used." });

    try {
      // REGISTRATION TRACE STEP 3: only the emailed token can move this account
      // out of unverified; we never log the person in from this POST.
      await sendVerificationEmail(user, token);
    } catch (emailError) {
      console.error("Verification email failed; user can use resend:", emailError);
    }

    res.status(201).send({
      message: "Check your email to verify your address and finish registration.",
      email,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).send({ message: "That email or username is already registered." });
    }
    throw error;
  }
});

router.post("/verify-email", async (req, res) => {
  // EMAIL VERIFY TRACE STEP 1: VerifyEmail.jsx posts the token from its URL.
  // The database consumes it once, then chooses pending vs approved from the
  // application admission method—not from anything supplied by the browser.
  const token = clean(req.body?.token);
  if (!token) return res.status(400).send({ message: "A verification token is required." });
  const user = await verifyEmail(hashSecret(token));
  if (!user) return res.status(400).send({ message: "This verification link is invalid, expired, or already used." });

  if (user.account_status === "pending" && process.env.CONTACT_TO) {
    try {
      await sendEmail({
        to: process.env.CONTACT_TO,
        subject: `Membership application pending: ${user.username}`,
        text: `${user.username} (${user.email}) verified their email and is ready for review.\n\n${clientUrl("/admin/membership")}`,
      });
    } catch (error) {
      console.error("Pending-member notification failed:", error);
    }
  }

  res.send({
    status: user.account_status,
    message: user.account_status === "approved"
      ? "Your email is verified and your account is active. You can log in now."
      : "Your email is verified. Your application is now awaiting approval.",
  });
});

router.post("/resend-verification", resendLimiter, async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const { token, tokenHash } = createSecureToken();
  const user = emailPattern.test(email) ? await replaceVerificationToken(email, tokenHash) : null;
  if (user) {
    try { await sendVerificationEmail(user, token); }
    catch (error) { console.error("Resent verification email failed:", error); }
  }
  // The same response prevents strangers from testing which emails have accounts.
  res.send({ message: "If that unverified account exists, a new link has been sent." });
});

export default router;
