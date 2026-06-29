import "dotenv/config";
import client from "#db/client";

async function getTwitchToken() {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });

  const data = await response.json();
  return data.access_token;
}

async function getPopularGames(accessToken, offset) {
  const response = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
    },
    body: `
      fields name, slug, summary, first_release_date, cover.url, total_rating_count;
      where cover != null & first_release_date != null; 
      sort total_rating_count desc;
      limit 500;
      offset ${offset};
    `,
  });

  return await response.json();
}

async function insertGame(game) {
  const coverUrl = game.cover?.url
    ? "https:" + game.cover.url.replace("t_thumb", "t_1080p")
    : null;

  const releaseDate = game.first_release_date
    ? new Date(game.first_release_date * 1000)
    : null;

  const result = await client.query(
    `
    INSERT INTO games (
      game_title,
      slug,
      game_description,
      release_date,
      cover_image_url,
      igdb_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (slug) DO NOTHING;
    `,
    [
      game.name,
      game.slug,
      game.summary || null,
      releaseDate,
      coverUrl,
      game.id,
    ]
  );
  return result.rowCount;
}

async function main() {
  let insertedCount = 0;
  let skippedCount = 0;
  await client.connect();

  const accessToken = await getTwitchToken();

  for (let offset = 0; offset < 3500; offset += 500) {
    console.log(`Fetching IGDB games offset: ${offset}`);

    const games = await getPopularGames(accessToken, offset);

    for (const game of games) {
      if (!game.name) {
        console.log("Skipped - missing name");
        continue;
      }

      if (!game.slug) {
        console.log(`Skipped ${game.name} - missing slug`);
        continue;
      }

      const inserted = await insertGame(game);

      if (inserted) {
        insertedCount++;
        console.log(`Inserted: ${game.name}`);
      } else {
        skippedCount++;
        console.log(`Skipped duplicate: ${game.name}`);
      }

      await new Promise((res) => setTimeout(res, 20));
    }
  }

  await client.end();
  console.log(`Inserted total: ${insertedCount}`);
  console.log(`Duplicate skipped total: ${skippedCount}`);
  console.log("Done populating games from IGDB.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});