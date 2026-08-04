# Recovery Community Security Overview

**Prepared for:** Recovery With The Exit Drug ownership and administration

**Review date:** July 28, 2026

## Executive summary

Recovery Community has a genuine, layered security foundation. Its protections are enforced by the server and PostgreSQL database rather than relying only on hidden buttons or browser-side checks.

Passwords are hashed, membership is controlled, protected requests require a signed login token, current account status is checked on each protected API request, administrative actions require role checks, private conversations verify their participants, and database queries use parameterized values to reduce SQL-injection risk.

The current system is appropriate for controlled testing and a small private beta. It should not yet be described as completely secure or fully production-hardened. Before inviting the entire existing Facebook membership, a focused hardening pass is recommended. The highest priorities are login throttling, secure authentication cookies, restricted CORS, security headers, stronger WebSocket account checks, stricter administration-route guards, and multifactor authentication for staff.

No internet application can honestly be guaranteed to be unhackable. The responsible claim is that this application has multiple meaningful security layers, known risks have been identified, and the remaining work is specific and manageable.

## Security model at a glance

```text
Member's browser
      |
      | HTTPS
      v
Express API
      |
      | Verify signed login token
      | Reload current user from PostgreSQL
      | Check approved + active + not deleted
      v
Route authorization
      |
      | Check role, ownership, or conversation membership
      v
Parameterized database query
      |
      | Foreign keys, unique rules, and check constraints
      v
PostgreSQL
```

An attacker must therefore defeat several independent controls. Getting around a hidden button is not enough. Changing a role in the browser is not enough. Guessing a record number is not enough. The server and database still make their own decisions.

## Existing protections

### 1. Password protection

Passwords are never intentionally stored as readable text. Before a password enters PostgreSQL, the server hashes it with bcrypt using work factor 10. Login compares the submitted password to the stored hash.

The registration form accepts passwords from 8 through 72 characters. The 72-character maximum matches bcrypt's input limitation. Work factor 10 meets OWASP's baseline for systems using bcrypt, although Argon2id would be a worthwhile future upgrade.

Password recovery uses a cryptographically random, one-use link that expires after one hour. PostgreSQL stores only the token's HMAC hash. Completing a reset increments the member's session version, rejects their older REST and Socket.IO tokens, and disconnects their open sessions.

What this protects against: someone who sees the users table cannot simply read each member's original password.

### 2. Signed authentication tokens

After a successful login, the server creates a cryptographically signed JSON Web Token. The token expires after seven days. A user cannot safely change the ID or role inside that token because changing its contents invalidates the signature.

The browser sends the token in the `Authorization` header when calling protected APIs.

### 3. Current account status is checked repeatedly

The server does not trust old profile information stored in the browser. For each protected REST request, it:

1. Verifies the token's signature and expiration.
2. Gets the authenticated user ID from the verified token.
3. Reloads that user's current row from PostgreSQL.
4. Confirms the account is approved.
5. Confirms the account is active.
6. Confirms the account has not been deleted.

This means suspending or deleting an account blocks its protected REST access immediately instead of waiting for the token to expire.

### 4. Protected community APIs

The forum, notifications, direct messages, admissions, profiles, and user-management functions have server-side authentication requirements.

Examples include:

- Forum data requires an approved, active member.
- A member's notifications are loaded using the authenticated user's database ID.
- Membership admissions require owner or administrator status.
- Private-message APIs verify that the requester is one of the conversation's two participants.
- The server obtains a new post's author from the authenticated account instead of accepting an arbitrary author ID from the browser.

This protects against simple URL manipulation and manually constructed API requests.

### 5. Role and ownership checks

Important forum permissions are enforced by the API and, for sensitive mutations, again inside the database query.

Current rules include:

- Regular members cannot edit content after publishing it.
- Moderators and administrators can edit their own content.
- Only the owner can edit another person's content.
- An author can soft-delete their own post or comment.
- Owners and administrators can delete another person's forum content.
- Moderator tools require a moderator-or-higher role.
- Announcement creation requires a moderator-or-higher role.
- Permanent test-account deletion is owner-only and refuses staff accounts, the current owner's account, system accounts, and accounts with community activity.

Because ownership conditions are included in the SQL update itself, bypassing the interface does not bypass the underlying rule.

### 6. SQL-injection protection

Database queries use PostgreSQL parameters such as `$1`, `$2`, and `$3`. User-provided text is passed separately from the SQL command instead of being directly inserted into it.

The forum's sorting feature also uses an allowlist. The API accepts only `recent`, `discussed`, `mine`, or `saved`; the query chooses from server-owned SQL fragments. Raw sorting instructions supplied by the browser are not inserted into the query.

### 7. Secure registration flows

The application supports standard registration, personal invitations, and shared community codes. These flows contain several protections:

- Email verification for standard and shared-code registrations.
- Cryptographically random personal-invitation and verification tokens.
- Only a one-way HMAC hash of each usable token is stored in PostgreSQL.
- Expiring verification links and invitations.
- One-use personal invitations.
- Personal invitations restricted to the invited email address.
- Shared codes that can expire, be disabled, and optionally have a use limit.
- Atomic database operations when claiming an invitation or code and creating an account.
- Generic resend responses that do not reveal whether an email has an account.
- Rate limits on registration and verification-email resending.
- Generic, rate-limited password-reset requests that do not reveal whether an account exists.
- Standard applicants remain pending until an owner or administrator approves them.

### 8. Database constraints

PostgreSQL provides another defensive layer through:

- Unique email addresses and usernames.
- Restricted account-status values.
- Foreign-key relationships between members, posts, comments, messages, reactions, flags, and notifications.
- A requirement that a nested comment belong to the same post as its parent.
- One reaction per member per target.
- One active flag per member per target.
- Unique registration-token hashes.
- Unique password-reset-token hashes.
- Cascading cleanup of dependent records where appropriate.
- Exactly one protected system account.

These rules protect data integrity if application code accidentally submits an invalid relationship.

### 9. Safer content rendering

The current React source does not use direct HTML injection methods such as `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function`.

React normally escapes member-written text when rendering it. A forum post containing HTML or JavaScript markup should therefore appear as text rather than execute as code.

### 10. Secret management

The real `.env` configuration is excluded from Git. The tracked example file contains placeholders rather than working database, email, or token credentials.

Production secrets such as the PostgreSQL URL, JWT signing secret, and Gmail application password belong in Render's protected environment settings and must not be placed in client-side variables or committed files.

### 11. Integration testing

On July 28, 2026, the existing rollback-based database integration suite passed. It covered:

- All three registration flows.
- Automated welcome posts and notifications.
- Participant notifications.
- Staff-only flag notifications.
- Protection of the system account.
- Edit-history recording.
- Recursive comment deletion.
- Post and comment deletion permissions.

The test rolls its changes back, so it does not leave test records behind. Passing this suite is useful evidence of expected behavior, but it is not a substitute for a professional penetration test.

## Recommended hardening before full launch

### Priority 1: Add login throttling

Registration and verification resending already have rate limits, but login does not. The login endpoint should limit repeated attempts and introduce an account-aware delay or temporary lock after repeated failures.

This protects against brute-force guessing, credential stuffing, and password spraying.

### Priority 2: Replace local-storage JWTs with secure cookies

The login token is currently stored in browser `localStorage`. This is convenient, but JavaScript running on the site can read it. A future cross-site-scripting mistake could therefore expose a member's token.

The stronger design is an `HttpOnly`, `Secure`, appropriately `SameSite` cookie. JavaScript cannot read an HttpOnly cookie.

### Priority 3: Restrict CORS

The REST API currently permits browser requests from every origin. It should explicitly allow only:

- The production Vercel client domain.
- Explicitly approved local-development origins.

Open CORS does not automatically expose authenticated information because an attacker still needs a valid token, but restricting it reduces unnecessary attack surface.

### Priority 4: Add explicit HTTP security headers

The server should add and test headers covering:

- Content Security Policy.
- MIME-type sniffing protection.
- Framing/clickjacking protection.
- Referrer policy.
- Appropriate cache controls for private API responses.
- HTTPS transport enforcement where the deployment platform does not already supply it.

The Helmet package can provide a safe starting point, but its configuration should be tested against the deployed client.

### Priority 5: Recheck account status for WebSockets

Socket.IO currently verifies the JWT. Private-message socket rooms also confirm conversation membership. However, the socket connection does not reload the user and recheck current approval, active, deleted, and system-account status in the same way as the REST API.

The socket handshake should perform those checks, and active sockets should be disconnected when an account is deactivated where practical.

### Priority 6: Make administration guards explicit

User listing and admissions have clear owner/administrator guards. Role, activation, and soft-delete routes rely primarily on numerical role hierarchy.

Those mutations should begin with an explicit owner/administrator requirement and accept only an allowlisted set of valid assignable roles. This will make the rule clearer and close unusual API-only edge cases.

### Priority 7: Add staff multifactor authentication

Owner and administrator accounts have broad authority. A stolen staff password could therefore cause more damage than a stolen member password.

Multifactor authentication should be added at least for owners and administrators. It may remain optional for ordinary members initially.

### Priority 8: Add bot protection

Cloudflare Turnstile or a comparable service should be added to public registration. It can also be shown after repeated failed login attempts.

CAPTCHA is not a replacement for rate limiting, but it makes automated abuse more expensive.

### Priority 9: Improve session revocation

Logging out currently removes the browser's copy of the token. If a token had already been stolen, that copy could remain usable until its seven-day expiration unless the account is deactivated.

Short-lived access sessions, secure cookies, and server-side revocable sessions would reduce this risk.

### Priority 10: Minimize and protect sensitive information

Phone numbers, dates of birth, posts, and direct messages are access-controlled, but they are not end-to-end encrypted. The application's database operator can read them, and a serious database compromise could expose them.

The community should collect only information it genuinely needs. Access to production data and backups should remain tightly controlled. Particularly sensitive profile fields could receive additional encryption later.

Direct messages should be described as private within the application, not as end-to-end encrypted communication.

### Priority 11: Operational security

Application security also depends on how the system is operated. Before full launch:

- Verify automated PostgreSQL backups and perform a test restoration.
- Rotate production secrets after accidental disclosure or staff changes.
- Use separate production and development databases.
- Keep Node.js and dependencies patched.
- Review dependency vulnerability reports regularly.
- Restrict Render and Vercel administrator access.
- Remove the temporary hard-delete testing function before production launch.
- Add useful security-event logging without logging passwords or usable tokens.
- Establish a documented response plan for compromised accounts and data incidents.

## What the system does not claim

This application does not claim:

- To be unhackable.
- To have completed an independent penetration test.
- To provide end-to-end encrypted messages.
- To meet a specific medical, legal, HIPAA, or other regulatory certification.
- To protect an account whose owner shares their password or loses control of their email account.
- To protect production data if hosting-administrator credentials are compromised.

Making these limits clear increases trust because it distinguishes real protections from marketing language.

## Owner-facing statement

Recovery Community is protected by multiple independent security layers. Passwords are hashed, admission is controlled, private API requests require signed authentication, and the server checks the current account before granting access. Roles, ownership, and private-message membership are enforced by the server and database rather than relying on what the browser displays. Registration links are random, expiring, one-use where appropriate, and stored only as hashes. Database constraints provide additional protection against invalid or inconsistent records.

The system has a credible security foundation for controlled testing and a private beta. Before launching to the full community, the development team has identified a focused hardening plan covering login protection, secure cookies, restricted browser origins, security headers, WebSocket account checks, stricter administration guards, administrator multifactor authentication, and operational safeguards. Security will be treated as an ongoing process rather than a one-time feature.

## Final assessment

The application is not relying on security theater. Its most important protections are implemented in the server and database, and its current integration suite confirms several critical behaviors.

The responsible current assessment is:

> **Recovery Community has a strong security foundation and is suitable for controlled testing and a small private beta. Complete the identified priority hardening work before describing it as production-hardened or opening it to the full membership.**
