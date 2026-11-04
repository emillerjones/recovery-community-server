# Recovery Community: server

Express and PostgreSQL backend for Recovery Community, a members-only platform for an established peer-support recovery community moving off Facebook. It handles accounts and admission, the forum, private messaging, the real-time Lounge, staff tools, owner-editable site content, and AI-assisted moderation.

**Status:** preparing for a private beta. See [SECURITY_OVERVIEW.md](SECURITY_OVERVIEW.md) for what is in place and what remains before a full launch.

Frontend: [recovery-community-client](https://github.com/emillerjones/recovery-community-client).

## How a request is handled

```
Browser ──HTTPS──▶ Express route
                     │  verify signed token
                     │  reload the member from PostgreSQL
                     │  check approved · active · not deleted · session version
                     ▼
                   route authorization (role, ownership, conversation membership)
                     ▼
                   parameterized SQL in db/queries/*  ──▶  PostgreSQL constraints
```

The browser never decides who can see what. Every protected REST request and every Socket.IO connection re-checks the member's current account in the database, so a deactivated account loses access on its next request.

## What it covers

| Area | Highlights |
|---|---|
| Accounts | Applications with staff admission, email verification, personal invitations and shared access codes, password reset, reversible deactivation. Tokens are random and stored only as HMAC hashes. |
| Forum | Posts, threaded replies, reactions, mentions, tags, polls, photos, member edits with visible history, reports to staff. Soft delete throughout. |
| Messaging | Private conversations with photos and cursor-based paging; participants are verified on every request and socket room. |
| Lounge | Real-time community chat over Socket.IO. |
| Staff | Private staff chat, staff-only announcements, moderation queues, member management. |
| Owner tools | Editable Home, Our Story, Guidelines, Resources, FAQ and Discount Links content, site analytics, Facebook post import under original authors. |
| AI-assisted moderation | Optional OpenAI moderation checks on Lounge messages. Off by default, owner-controlled, staff decide, text-only, purged after 90 days. See [LOUNGE_MODERATION.md](LOUNGE_MODERATION.md). |

## Project layout

```
api/            Express routers, one per domain (users, admissions, forum, messages, lounge, staffChat, loungeModeration, ...)
db/
  schema.sql    base schema
  migrations/   numbered, additive migrations
  rollbacks/    matching rollback scripts
  queries/      all SQL, parameterized, one file per domain
middleware/     token parsing and requireUser
utils/          Socket.IO, email, Cloudinary, secure tokens, moderation worker and config
tests/          rollback-based integration tests
docs/           release notes for individual features
```

There is no ORM: routes handle HTTP concerns and delegate data work to `db/queries`.

## Running locally

Requires Node.js and PostgreSQL. **Point `DATABASE_URL` at a local or development database, never production.** The integration tests and `db:reset` write to whatever database it names.

```bash
npm install
cp .env.example .env     # DATABASE_URL, JWT_SECRET, mail, Cloudinary; OpenAI only for moderation
npm run db:reset         # apply schema.sql and seed data
npm run dev              # http://localhost:3000
```

Integration tests run inside a transaction and roll back, for example:

```bash
npm run test:registration
npm run test:lounge-moderation
```

`package.json` lists all 23 test scripts.

## Deployment

The API runs on Render; secrets (database URL, JWT secret, email and Cloudinary credentials, OpenAI key) live in Render's environment settings and are never sent to the client.
