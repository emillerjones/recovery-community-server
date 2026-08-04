import { getUserById } from "#db/queries/users";
import { verifyToken } from "#utils/jwt";

/** Attaches the user to the request if a valid token is provided */
export default async function getUserFromToken(req, res, next) {
  const authorization = req.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return next();

  const token = authorization.split(" ")[1];
  try {
    const { id, auth_version: tokenAuthVersion = 0 } = verifyToken(token);
    const user = await getUserById(id);
    if (!user || user.auth_version !== tokenAuthVersion) {
      return res.status(401).send("This session is no longer valid.");
    }
    req.user = user;
    next();
  } catch {
    res.status(401).send("Invalid token.");
  }
}
