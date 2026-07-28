import express from "express";
import requireUser from "#middleware/requireUser";
import {
  createPersonalInvite, createSharedCode, getApplications, getPersonalInvites,
  getSharedCodes, reviewApplication, revokePersonalInvite, setSharedCodeActive,
} from "#db/queries/admissions";
import { clientUrl, sendEmail } from "#utils/email";
import { createSecureToken, hashSecret } from "#utils/secureTokens";
import { broadcastMemberWelcomeAlerts } from "#utils/newPostAlerts";

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use(requireUser);
router.use((req, res, next) => {
  // Owner (1) and administrators (10) run admissions; moderators cannot.
  if (req.user.role_id > 10) return res.status(403).send({ message: "Owner or administrator access is required." });
  next();
});

router.get("/applications", async (req, res) => {
  res.send(await getApplications(req.query.status === "all" ? "all" : "pending"));
});

router.patch("/applications/:id", async (req, res) => {
  // REVIEW TRACE: the admin button arrives here, then one query records the
  // reviewer and changes the user's login status together.
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).send({ message: "Decision must be approved or rejected." });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  const user = await reviewApplication(Number(req.params.id), req.user.user_id, decision, reason);
  if (!user) return res.status(409).send({ message: "This application is no longer pending." });

  if (user.account_status === "approved") {
    // WELCOME POST TRACE STEP 3C: standard applications become approved here.
    try { await broadcastMemberWelcomeAlerts(user.user_id); }
    catch (error) { console.error("Approved-member welcome alert broadcast failed:", error); }
  }

  try {
    await sendEmail({
      to: user.email,
      subject: decision === "approved" ? "Your membership was approved" : "Update on your membership application",
      text: decision === "approved"
        ? `Hi ${user.username},\n\nYour Recovery Community membership was approved. You can now log in:\n${clientUrl("/login")}`
        : `Hi ${user.username},\n\nYour membership application was not approved.${reason ? `\n\nNote: ${reason}` : ""}`,
    });
  } catch (error) { console.error("Application decision email failed:", error); }
  res.send(user);
});

router.get("/invites", async (req, res) => res.send(await getPersonalInvites()));

router.post("/invites", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const expiresInDays = Math.min(Math.max(Number(req.body?.expiresInDays) || 14, 1), 90);
  if (!emailPattern.test(email)) return res.status(400).send({ message: "Enter a valid email." });
  const { token, tokenHash } = createSecureToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
  const invite = await createPersonalInvite({ email, tokenHash, createdBy: req.user.user_id, expiresAt });
  const link = clientUrl(`/register?invite=${encodeURIComponent(token)}`);
  try {
    await sendEmail({
      to: email,
      subject: "You're invited to Recovery Community",
      text: `You have a private invitation to join Recovery Community. This one-time link expires in ${expiresInDays} days:\n\n${link}`,
    });
  } catch (error) {
    // Do not leave a live invitation whose only usable secret was never sent.
    await revokePersonalInvite(invite.invite_id);
    throw error;
  }
  res.status(201).send(invite);
});

router.patch("/invites/:id/revoke", async (req, res) => {
  const invite = await revokePersonalInvite(Number(req.params.id));
  if (!invite) return res.status(409).send({ message: "That invitation was already used or revoked." });
  res.send(invite);
});

router.get("/codes", async (req, res) => res.send(await getSharedCodes()));

router.post("/codes", async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const expiresInDays = Math.min(Math.max(Number(req.body?.expiresInDays) || 90, 1), 365);
  const maxUsesValue = Number(req.body?.maxUses);
  const maxUses = Number.isInteger(maxUsesValue) && maxUsesValue > 0 ? maxUsesValue : null;
  if (code.length < 6 || code.length > 64) {
    return res.status(400).send({ message: "Enter a code between 6 and 64 characters." });
  }
  const saved = await createSharedCode({
    // Shared codes are intentionally distributed to the Facebook community,
    // so the actual code is also the owner-facing list label. Its HMAC remains
    // the value used when validating registration submissions.
    name: code, codeHash: hashSecret(code), createdBy: req.user.user_id,
    expiresAt: new Date(Date.now() + expiresInDays * 86400000), maxUses,
  });
  // This is intentionally the only response that reveals the usable code.
  res.status(201).send({ ...saved, code });
});

router.patch("/codes/:id", async (req, res) => {
  if (typeof req.body?.active !== "boolean") return res.status(400).send({ message: "active must be true or false." });
  const code = await setSharedCodeActive(Number(req.params.id), req.body.active);
  if (!code) return res.status(404).send({ message: "Code not found." });
  res.send(code);
});

export default router;
