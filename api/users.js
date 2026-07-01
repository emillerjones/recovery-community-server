import express from "express";
import {
  createUser,
  getUsers,
  getUserById,
  getUserByEmailAndPassword,
  updateUserRole,
  setUserActive,
  softDeleteUser,
} from "#db/queries/users";
import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
// import getUserFromToken from "#middleware/getUserFromToken";
import requireUser from "#middleware/requireUser";

const router = express.Router();


// 1. GET All Users 
router.get("/", async (req, res) => {
  const users = await getUsers();
  users.forEach(user => delete user.password);
  let result = users;
  
  if (!req.user) {
    result = users.filter(user => user.role_id === 100);
  }
  res.send(result);
});


// 3. POST Register account registration handler
router.post("/register", requireBody(["email", "username", "password"]), async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const user = await createUser(
      email.toLowerCase().trim(),
      username.toLowerCase().trim(),
      password
    );
    delete user.password;
    
    //FIXED PAYLOAD: Generates full user identity hooks directly inside the token signature
    const token = createToken({ 
      id: user.user_id,
      username: user.username,
      role_id: user.role_id
    });
    
    res.status(201).send({ token, user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).send("Email or username already exists");
    }
    res.status(500).send("Server error");
  }
});

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
    
    // ✅ FIXED PAYLOAD: Encodes profile details into the token so user.username populates on boot
    const token = createToken({ 
      id: user.user_id,
      username: user.username,
      role_id: user.role_id
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
    
    //FIXED HANDSHAKE: Returns the rich 'user' database query object instead of req.user
    res.send(user);
  } catch (err) {
    res.status(500).send("Server profile synchronization failure");
  }
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
