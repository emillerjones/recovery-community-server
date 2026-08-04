import express from "express";
import rateLimit from "express-rate-limit";
import { createPasswordResetToken, resetPassword } from "#db/queries/passwordReset";
import { clientUrl, sendEmail } from "#utils/email";
import { createSecureToken, hashSecret } from "#utils/secureTokens";
import { disconnectUser } from "#utils/socket";

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Please wait before requesting another password reset email." },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many reset attempts. Please wait and try again." },
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

router.post("/request", requestLimiter, async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const { token, tokenHash } = createSecureToken();
  const user = emailPattern.test(email) && email.length <= 254
    ? await createPasswordResetToken(email, tokenHash)
    : null;

  if (user) {
    try {
      const link = clientUrl(`/reset-password?token=${encodeURIComponent(token)}`);
      await sendEmail({
        to: user.email,
        subject: "Reset your Recovery Community password",
        text: `Hi ${user.username},\n\nSet a new password by opening this link:\n${link}\n\nThis link expires in 1 hour and can only be used once. If you did not request this, you can ignore this email.`,
      });
    } catch (error) {
      console.error("Password reset email failed:", error);
    }
  }

  // The same response prevents strangers from testing which emails have accounts.
  res.send({ message: "If an account exists for that email, a reset link has been sent." });
});

router.post("/complete", resetLimiter, async (req, res) => {
  const token = clean(req.body?.token);
  const password = String(req.body?.password || "");

  if (!token) return res.status(400).send({ message: "A password reset token is required." });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).send({ message: "Password must be between 8 and 72 characters." });
  }

  const user = await resetPassword(hashSecret(token), password);
  if (!user) {
    return res.status(400).send({ message: "This reset link is invalid, expired, or already used." });
  }

  disconnectUser(user.user_id);
  res.send({ message: "Your password has been changed. You can log in now." });
});

export default router;
