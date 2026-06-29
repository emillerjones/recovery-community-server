import express from "express";
import { createUser, getUserByEmailAndPassword, getUsers, getUserById, updateUser, updateLastSeen } from "#db/queries/users";
import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
import getUserFromToken from "#middleware/getUserFromToken";
import { addFavoriteGame, checkFavorites, getUserFavoriteGames, removeFavorite } from "#db/queries/games";
import requireUser from "#middleware/requireUser";

const router = express.Router();

// Track token verification session metrics
router.use(getUserFromToken); 

// 1. GET All Users catalog matrix
router.get("/", async (req, res) => {
  const users = await getUsers();
  users.forEach(user => delete user.password);
  let result = users;
  
  if (!req.user) {
    result = users.filter(user => user.role_id === 100);
  }
  res.send(result);
});

// 2. GET Users Dropdown array roster
router.get("/dropdown", async (req, res) => {
  const users = await getUsers();
  users.forEach(user => delete user.password);
  let result = users;
  
  if (req.user?.role_id === 1) {
    result = users;
  } else {
    result = users.filter(user => user.user_id != req.user.user_id);
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
    res.status(500).send("Server error");
  }
});

// Enforce strict account verification boundaries for user-specific endpoints
router.use((req, res, next) => {
  if (!req.user) return res.status(401).send("Unauthorized");
  next();
});

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
router.get("/:userId/favorites", async (req, res) => {
  try {
    const { userId } = req.params;
    const favorites = await getUserFavoriteGames(userId);
    
    res.send(favorites);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

router.post("/me", getUserFromToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { date_of_birth, gender, bio } = req.body;

    const updatedUser = await updateUser(userId, { date_of_birth, gender, bio });

    console.log("API call: ", updatedUser);
    
    if (updatedUser) {
      delete updatedUser.password;
    }
    res.status(200).send(updatedUser);
  } catch (err) {
    console.error(err);
  }
});

router.post("/:userId/favorites", getUserFromToken, async (req, res) => {
  try {
    const  userId  = req.user.user_id;
    const { game_id } = req.body;    
    if (!game_id) {
      return res.status(400).send({ error: "game_id is required" });
    }
    const checkQuery = await checkFavorites(userId, game_id);
    if(checkQuery.length > 0) {
      const unFavorited = await removeFavorite(userId, game_id);
    }else{
      const newFavorite = await addFavoriteGame(userId, game_id);
    }
    
    const updatedFavorites = await getUserFavoriteGames(userId)
    res.status(200).send(updatedFavorites);

  } catch (error) {
    console.error("Error adding favorite:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});
  
//emj heartbeat
router.post("/heartbeat", requireUser, async (req, res) => {
  const user = await updateLastSeen(req.user.user_id);
  res.send(user);
});

export default router;
