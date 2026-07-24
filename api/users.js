import express from "express";
import {
  getUsers,
  getUserById,
  getUserByEmailAndPassword,
  updateUserRole,
  setUserActive,
  softDeleteUser,
  hardDeleteTestUser,
  updateOwnProfile,
  searchActiveUsersForMention,
} from "#db/queries/users";
import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
// import getUserFromToken from "#middleware/getUserFromToken";
import requireUser from "#middleware/requireUser";

const router = express.Router();


// 1. GET All Users 
router.get("/", requireUser, async (req, res) => {
  // This endpoint includes private account fields for the management screen.
  // Keep it away from public/member-directory traffic and pending applicants.
  if (req.user.role_id > 10) {
    return res.status(403).send({ message: "Owner or administrator access is required." });
  }
  const users = await getUsers();
  users.forEach(user => delete user.password);
  res.send(users);
});


// 3. POST Register account registration handler
router.post("/register", (req, res) => res.status(410).send({
  message: "Registration has moved to the verified membership application.",
}));

// 4. POST Login credential verification gateway
router.post("/login", requireBody(["email", "password"]), async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmailAndPassword(
      email.toLowerCase().trim(),
      password
    );
    if (!user) {
      return res.status(401).send("Invalid email or password.");
    }
    if (user.account_status === "unverified") {
      return res.status(403).send("Please verify your email before logging in.");
    }
    if (user.account_status === "pending") {
      return res.status(403).send("Your membership application is awaiting approval.");
    }
    if (user.account_status === "rejected") {
      return res.status(403).send("This membership application was not approved.");
    }
    if (!user.active) {
      return res.status(403).send("This account is currently inactive.");
    }
    
    // ✅ FIXED PAYLOAD: Encodes profile details into the token so user.username populates on boot
    const token = createToken({ 
      id: user.user_id,
      username: user.username,
      role_id: user.role_id,
      avatar_url: user.avatar_url
    });
    
    delete user.password;
    res.status(201).send({ token, user });
  } catch (err) {
    console.error(err);   // ← add this line here
    res.status(500).send("Server error");
  }
});


// Middleware that blocks unauthenticated requests to all routes below.
router.use(requireUser);

// 5. GET Me - Dynamic profile state sync endpoint
router.get("/me", async (req, res) => {
  try {
    // Fetches your rich database row fields using your active token payload ID
    const user = await getUserById(req.user.user_id);
    
    if (!user) {
      return res.status(404).send("User profile records not found.");
    }
    
    delete user.password; // Safety padding
    delete user.notes; // Staff-only notes never belong in a member response.
    
    //FIXED HANDSHAKE: Returns the rich 'user' database query object instead of req.user
    res.send(user);
  } catch (err) {
    res.status(500).send("Server profile synchronization failure");
  }
});

router.patch("/me/profile", async (req, res) => {
  // PROFILE TRACE STEP 3: Profile.jsx sends only member-editable fields here.
  // Username, email, role, status, and staff notes are intentionally ignored.
  const bio = typeof req.body?.bio === "string" ? req.body.bio.trim() : "";
  const phoneNumber = typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber.trim() : "";
  const dateOfBirth = typeof req.body?.dateOfBirth === "string" ? req.body.dateOfBirth.trim() : "";
  const gender = typeof req.body?.gender === "string" ? req.body.gender.trim() : "";
  const avatarUrl = typeof req.body?.avatarPreset === "string" ? req.body.avatarPreset.trim() : "";
  const avatarColors = new Set(["forest", "sage", "amber", "terracotta", "lavender", "ocean", "sky", "rose", "plum", "moss", "clay", "slate", "sunshine", "coral", "mint", "midnight"]);

  if (bio.length > 1000) return res.status(400).send({ message: "Bio must be 1,000 characters or fewer." });
  if (phoneNumber.length > 30) return res.status(400).send({ message: "Phone number must be 30 characters or fewer." });
  if (gender.length > 50) return res.status(400).send({ message: "Gender must be 50 characters or fewer." });
  const avatarMatch = /^preset:([A-Za-z0-9]+):([a-z-]{2,24})$/.exec(avatarUrl);
  if (avatarUrl && (!avatarMatch || !avatarColors.has(avatarMatch[2]))) {
    return res.status(400).send({ message: "Choose a valid preset avatar." });
  }
  if (dateOfBirth) {
    const validFormat = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth);
    const parsed = new Date(`${dateOfBirth}T00:00:00Z`);
    const exactDate = !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateOfBirth;
    if (!validFormat || !exactDate || parsed > new Date()) {
      return res.status(400).send({ message: "Enter a valid date of birth that is not in the future." });
    }
  }

  // PROFILE TRACE STEP 4: this query updates only the member-editable columns and
  // returns the fresh row so the screen can immediately reflect the saved data.
  const user = await updateOwnProfile(req.user.user_id, { bio, phoneNumber, dateOfBirth, gender, avatarUrl });
  if (!user) return res.status(404).send({ message: "Profile not found." });
  delete user.password;
  delete user.notes;
  res.send(user);
});

router.get("/mention-search", async (req, res) => {
  // MENTION TRACE STEP 3: Typing after @ in MentionTextarea calls this route.
  // requireUser above keeps the membership directory private. The query only
  // returns active usernames, IDs, and avatars—never private account fields.
  const search = String(req.query.q || "").trim().slice(0, 30);
  res.send(await searchActiveUsersForMention(search, req.user.user_id));
});

/**
 * These three routes are meant to be added to your existing
 * api/users.js file, AFTER the line:
 *
 *   router.use(requireUser);
 *
 * That line already guarantees req.user exists and is logged in for
 * everything below it — these routes add an extra check on top of
 * that: is req.user allowed to do THIS specific action.
 *
 * You'll also need these two imports added near the top of users.js:
 *
 *   import {
 *     updateUserRole,
 *     setUserActive,
 *     softDeleteUser,
 *   } from "#db/queries/users";
 *
 * (combine these into your existing import line from that file
 * rather than adding a second import line)
 */

// Role IDs, matching your user_roles table. Keeping these as named
// constants makes the comparisons below easier to read than raw
// numbers like "1" or "100" scattered through the code.
const OWNER_ROLE_ID = 1;

// 6. PATCH update a user's role (promote/demote)
router.patch("/:id/role", requireBody(["role_id"]), async (req, res) => {
  const targetUserId = Number(req.params.id);
  const newRoleId = Number(req.body.role_id);
  const actingUser = req.user;

  // Rule: you can only assign a role that is LOWER status than your
  // own. Since lower role_id = higher authority here (1 is the top),
  // "lower status" means a BIGGER role_id number than your own.
  // Example: a moderator (role_id 50) can only assign role_id > 50.
  if (newRoleId <= actingUser.role_id) {
    return res
      .status(403)
      .send("You do not have permission to assign this role.");
  }

  // Rule: nobody can ever be set to owner (role_id 1) through this
  // route. Owner status isn't something the app can grant.
  if (newRoleId === OWNER_ROLE_ID) {
    return res.status(403).send("The owner role cannot be assigned.");
  }

  // Rule: an owner's own role can never be changed — they're
  // permanently at the top. (This also stops anyone else from
  // demoting an owner, since the role check above already
  // prevents non-owners from outranking an owner in the first place,
  // but this makes the rule explicit and self-contained.)
  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    return res.status(404).send("User not found.");
  }
  if (targetUser.role_id === OWNER_ROLE_ID) {
    return res.status(403).send("The owner role cannot be changed.");
  }

  const updatedUser = await updateUserRole(targetUserId, newRoleId);
  delete updatedUser.password;
  res.send(updatedUser);
});

// 7. PATCH activate or deactivate a user
router.patch("/:id/active", requireBody(["active"]), async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { active } = req.body;
  const actingUser = req.user;

  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    return res.status(404).send("User not found.");
  }

  // Same hierarchy rule as role changes: you can only act on users
  // with a "lower" role than your own (a bigger role_id number).
  if (targetUser.role_id <= actingUser.role_id) {
    return res
      .status(403)
      .send("You do not have permission to manage this user.");
  }

  const updatedUser = await setUserActive(targetUserId, active);
  delete updatedUser.password;
  res.send(updatedUser);
});

// TESTING ONLY: permanently remove an unused signup so the same email can run
// through standard, personal-invite, and shared-code registration repeatedly.
router.delete("/:id/hard", async (req, res) => {
  // This temporary testing tool is owner-only in both the UI and API. The
  // server check is the real protection; hiding a button alone is never enough.
  if (req.user.role_id !== 1) {
    return res.status(403).send({ message: "Owner access is required." });
  }

  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId === req.user.user_id) {
    return res.status(400).send({ message: "That account cannot be permanently deleted here." });
  }

  const deletedUser = await hardDeleteTestUser(targetUserId);
  if (!deletedUser) {
    return res.status(409).send({
      message: "Hard delete is limited to non-staff test accounts with no posts, comments, or message activity.",
    });
  }
  res.send(deletedUser);
});

// 8. DELETE soft-delete a user
router.delete("/:id", async (req, res) => {
  const targetUserId = Number(req.params.id);
  const actingUser = req.user;

  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    return res.status(404).send("User not found.");
  }

  if (targetUser.role_id <= actingUser.role_id) {
    return res
      .status(403)
      .send("You do not have permission to delete this user.");
  }

  const deletedUser = await softDeleteUser(targetUserId);
  delete deletedUser.password;
  res.send(deletedUser);
});

export default router;
