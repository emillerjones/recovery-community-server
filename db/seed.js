import db from "#db/client";
import { createUser } from "#db/queries/users";

await db.connect();
await seed();
await db.end();
console.log("🌱 Database seeded.");

async function seed() {
  // Create Set Roles - Static
  await db.query(`
    INSERT INTO user_roles (role_id, role_name) VALUES
      (1, 'owner'),
      (10, 'administrator'),
      (50, 'moderator'),
      (100, 'member')
    ON CONFLICT DO NOTHING
  `);

  //create admins
  await createUserIfMissing("evan@gmail.com", "EMJ username", "123", 1);
  await createUserIfMissing("ruth@gmail.com", "LN username", "123", 1);
  await createUserIfMissing("josh@gmail.com", "JN username", "123", 1);


  //create regular users
  for (let i = 1; i <= 10; i++) {
    await createUserIfMissing(
      "email" + i + "@gmail.com",
      "Username" + i,
      "Password" + i
    );
  }


//seed categories
  await db.query(`
    INSERT INTO forum_categories
      (name, slug, description, sort_order)
    VALUES
      (
        'Introductions',
        'introductions',
        'Introduce yourself and say hello to the community.',
        1
      ),
      (
        'General Recovery',
        'general-recovery',
        'General discussion about recovery, sobriety, and daily life.',
        2
      ),
      (
        'Cannabis Substitution',
        'cannabis-substitution',
        'Experiences, questions, and discussion about cannabis substitution.',
        3
      ),
      (
        'Success Stories',
        'success-stories',
        'Celebrate milestones, victories, and recovery achievements.',
        4
      ),
      (
        'Questions & Support',
        'questions-support',
        'Ask for advice, encouragement, or help from the community.',
        5
      ),
      (
        'Family & Friends',
        'family-friends',
        'Support and discussion for loved ones and caregivers.',
        6
      ),
      (
        'Resources',
        'resources',
        'Helpful articles, books, videos, and recovery tools.',
        7
      ),
      (
        'Off Topic',
        'off-topic',
        'Casual conversation and community building.',
        8
      )
    ON CONFLICT DO NOTHING;
  `);





}

async function createUserIfMissing(email, username, password, roleId = 100) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM users WHERE email = $1 OR username = $2 LIMIT 1`,
    [email.toLowerCase(), username.toLowerCase()]
  );

  if (rowCount === 0) {
    await createUser(email, username, password, roleId);
  }
}




