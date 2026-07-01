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
  //Create Set Roles - Static
  await db.query(`
    INSERT INTO user_roles (role_id, role_name) VALUES
      (1, 'owner'),
      (10, 'administrator'),
      (50, 'moderator'),
      (100, 'member')
  `);

  //create admins
  await createUser("evan@gmail.com", "EMJ username", "123", 1 );
  await createUser("ruth@gmail.com", "LN username", "123", 1 );
  await createUser("josh@gmail.com", "JN username", "123", 1 );


  //create regular users
  for (let i = 1; i <= 10; i++) {
    await createUser("email" + i + "@gmail.com", "Username" + i, "Password" + i );
  }


}




