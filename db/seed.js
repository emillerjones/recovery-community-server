import db from "#db/client";
import { createUser } from "#db/queries/users";
// import { createPlaylist, getPlaylistTrack } from "#db/queries/playlists";

//emj testing seed from csv file
import fs from "fs/promises";
import { parse } from "csv-parse/sync";

await db.connect();
await seed();
await db.end();
console.log("🌱 Database seeded.");

async function seed() {

  //emj testing seed from csv
  //Games Seed
  const gamesCsv = await fs.readFile("./db/seed-data/games_seed.csv", "utf-8");
  const games = parse(gamesCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const game of games) {
    await db.query(
      `
      INSERT INTO games (
        game_title,
        slug,
        game_description,
        genre,
        category,
        age_rating,
        release_date,
        developer,
        publisher,
        cover_image_url,
        banner_image_url,
        avg_rating,
        rating_count,
        igdb_id,
        steam_app_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      );
      `,
      [
        game.game_title,
        game.slug,
        game.game_description || null,
        game.genre || null,
        game.category || null,
        game.age_rating || null,
        game.release_date || null,
        game.developer || null,
        game.publisher || null,
        game.cover_image_url || null,
        game.banner_image_url || null,
        game.avg_rating ? Number(game.avg_rating) : null,
        game.rating_count ? Number(game.rating_count) : 0,
        game.igdb_id ? Number(game.igdb_id) : null,
        game.steam_app_id ? Number(game.steam_app_id) : null,
      ]
    );
  }

  // ---------- platforms ----------
  const platformsCsv = await fs.readFile("./db/seed-data/platforms_seed.csv", "utf-8");
  const platforms = parse(platformsCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const platform of platforms) {
    await db.query(
      `
      INSERT INTO platforms (platform_name)
      VALUES ($1);
      `,
      [platform.platform_name]
    );
  }

  // ---------- game_platforms ----------
  const gamePlatformsCsv = await fs.readFile("./db/seed-data/game_platforms_seed.csv", "utf-8");
  const gamePlatforms = parse(gamePlatformsCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const row of gamePlatforms) {
    const gameResult = await db.query(
      `
      SELECT game_id
      FROM games
      WHERE slug = $1;
      `,
      [row.slug]
    );

    const platformResult = await db.query(
      `
      SELECT platform_id
      FROM platforms
      WHERE platform_name = $1;
      `,
      [row.platform_name]
    );

    const game_id = gameResult.rows[0]?.game_id;
    const platform_id = platformResult.rows[0]?.platform_id;

    if (!game_id || !platform_id) {
      console.log("Skipping row:", row);
      continue;
    }

    await db.query(
      `
      INSERT INTO game_platforms (game_id, platform_id, external_game_id)
      VALUES ($1, $2, $3);
      `,
      [game_id, platform_id, row.external_game_id || null]
    );
  }











  //Create Set Roles - Static
  await db.query(`
    INSERT INTO roles (role_id, role_name) VALUES
      (1, 'super_admin'),
      (10, 'admin'),
      (100, 'user')
  `);

  //create admins
  await createUser("evan@gmail.com", "EMJ", "123", 1 );
  await createUser("ian@gmail.com", "IE", "1234", 1 );
  await createUser("billy@gmail.com", "BL", "12345", 1 );
  await createUser("adam@gmail.com", "AR", "123456", 1 );

  //create regular users
  for (let i = 1; i <= 10; i++) {
    const newUser = await createUser("email" + i + "@gmail.com", "Username" + i, "Password" + i );
  }


// Sessions SEED
  // ---------- sessions ----------
  const sessionsCsv = await fs.readFile("./db/seed-data/sessions_seed.csv", "utf-8");
  const sessions = parse(sessionsCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const session of sessions) {
    await db.query(
      `
      INSERT INTO sessions (
        session_id,
        game_id,
        host_user_id,
        session_title,
        session_description,
        session_status,
        is_private,
        max_users,
        started_at,
        ended_at,
        last_activity_at,
        created_by_user_id,
        creation_source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      );
      `,
      [
        Number(session.session_id),
        Number(session.game_id),
        Number(session.host_user_id),
        session.session_title,
        session.session_description || null,
        session.session_status,
        session.is_private === "true",
        Number(session.max_users),
        session.started_at || null,
        session.ended_at || null,
        session.last_activity_at || null,
        session.created_by_user_id ? Number(session.created_by_user_id) : null,
        session.creation_source || "user",
      ]
    );
  }
  // ---------- session_users ----------
  const sessionUsersCsv = await fs.readFile("./db/seed-data/session_users_seed.csv", "utf-8");
  const sessionUsers = parse(sessionUsersCsv, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const row of sessionUsers) {
    await db.query(
      `
      INSERT INTO session_users (
        session_user_id,
        session_id,
        user_id,
        membership_status,
        is_host,
        invited_at,
        joined_at,
        left_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      );
      `,
      [
        Number(row.session_user_id),
        Number(row.session_id),
        Number(row.user_id),
        row.membership_status,
        row.is_host === "true",
        row.invited_at || null,
        row.joined_at || null,
        row.left_at || null,
      ]
    );
  }
  //-----------FriendList seeding---------

const friendships = [
  // Billy (3) is friends with all other Admins (1, 2, 4)
  { u1: 1, u2: 3, status: 'accepted', actor: 1 },
  { u1: 2, u2: 3, status: 'accepted', actor: 2 },
  { u1: 3, u2: 4, status: 'accepted', actor: 4 },

  // Pending requests for other admins to handle
  { u1: 1, u2: 2, status: 'pending', actor: 2 },
  { u1: 2, u2: 4, status: 'pending', actor: 4 },
  { u1: 1, u2: 4, status: 'pending', actor: 1 },
];

for (const f of friendships) {
  await db.query(`
    INSERT INTO friendships (user_id_1, user_id_2, status, actor_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id_1, user_id_2) DO NOTHING
  `, [f.u1, f.u2, f.status, f.actor]);
}


  // ---------- reset sequences ----------
  await db.query(`
    SELECT setval('sessions_session_id_seq', (SELECT MAX(session_id) FROM sessions));
  `);

  await db.query(`
    SELECT setval('session_users_session_user_id_seq', (SELECT MAX(session_user_id) FROM session_users));
  `);




// ---------- game_reviews ----------
const gameReviewsCsv = await fs.readFile(
  "./db/seed-data/game_reviews_seed.csv",
  "utf-8"
);

const gameReviews = parse(gameReviewsCsv, {
  columns: true,
  skip_empty_lines: true,
});

for (const review of gameReviews) {
  await db.query(
    `
    INSERT INTO game_reviews (
      review_title,
      game_review,
      game_id,
      user_id,
      rating_value,
      view_counter
    )
    VALUES (
      $1, $2, $3, $4, $5, $6
    );
    `,
    [
      review.review_title,
      review.game_review,
      Number(review.game_id),
      Number(review.user_id),
      Number(review.rating_value),
      Number(review.view_counter),
    ]
  );
}

// seed notification types
await db.query(`
  INSERT INTO notification_types
  (type_key, display_name, category, icon)

  VALUES
  ('friend_request', 'Friend Request', 'social', 'UserPlus'),
  ('friend_accepted', 'Friend Accepted', 'social', 'Users'),

  ('session_invite', 'Session Invite', 'sessions', 'Gamepad2'),
  ('session_starting', 'Session Starting Soon', 'sessions', 'Clock3'),
  ('added_to_session', 'Added To Session', 'sessions', 'Users'),
  ('removed_from_session', 'Removed From Session', 'sessions', 'UserMinus'),

  ('friend_online', 'Friend Online', 'social', 'Wifi'),
  ('friend_logged_in', 'Friend Logged In', 'social', 'MonitorUp'),

  ('review_reply', 'Review Reply', 'reviews', 'MessageSquare'),
  ('review_liked', 'Review Liked', 'reviews', 'Heart'),

  ('achievement_unlocked', 'Achievement Unlocked', 'games', 'Trophy'),
  ('rare_achievement', 'Rare Achievement', 'games', 'Medal'),

  ('direct_message', 'Direct Message', 'messages', 'Send'),
  ('mentioned_in_chat', 'Mentioned In Chat', 'messages', 'AtSign'),

  ('system_alert', 'System Alert', 'system', 'Bell'),
  ('maintenance_notice', 'Maintenance Notice', 'system', 'Wrench'),
  ('platform_connected', 'Platform Connected', 'system', 'Plug');
`);

}




