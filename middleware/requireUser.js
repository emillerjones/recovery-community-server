/** Requires a logged-in user */
export default async function requireUser(req, res, next) {
  if (!req.user) return res.status(401).send("Unauthorized");
  // Tokens last seven days, but getUserFromToken reloads the current database
  // row on every request. A suspension or admission change therefore takes
  // effect immediately instead of waiting for an old token to expire.
  if (req.user.account_status !== "approved" || !req.user.active || req.user.deleted_at) {
    return res.status(403).send("This account does not currently have community access.");
  }
  next();
}
