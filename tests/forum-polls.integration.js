import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import { createForumPost } from "#db/queries/forum";
import {
  closeForumPoll,
  getForumPollForPost,
  getNamedPollVoters,
  removeForumPollVote,
  replaceForumPollVote,
  updateForumPoll,
} from "#db/queries/polls";
import { normalizePollInput } from "#utils/polls";

const schemaName = "codex_forum_polls_integration";
const basePoll = {
  question: "Which meeting time works best?",
  options: ["Morning", "Evening"],
  allowMultiple: false,
  resultsVisibility: "after_vote",
  voterVisibility: "named",
  closesAt: null,
};

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));

  await db.query(
    "INSERT INTO user_roles (role_id, role_name) VALUES (50, 'Moderator'), (100, 'Member')"
  );
  await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status, is_system)
     VALUES (50, 'system@example.com', 'unused', 'community-system', 'approved', TRUE)`
  );
  await db.query(
    "INSERT INTO forum_categories (name, slug) VALUES ('Introductions', 'introductions')"
  );
  const { rows: users } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'poll-owner@example.com', 'unused', 'poll-owner', 'approved'),
            (100, 'poll-voter@example.com', 'unused', 'poll-voter', 'approved'),
            (50, 'poll-staff@example.com', 'unused', 'poll-staff', 'approved')
     RETURNING user_id, username`
  );
  const owner = users.find((user) => user.username === "poll-owner");
  const voter = users.find((user) => user.username === "poll-voter");
  const staff = users.find((user) => user.username === "poll-staff");
  const { rows: [category] } = await db.query(
    "INSERT INTO forum_categories (name, slug) VALUES ('Main Forum', 'main-forum') RETURNING *"
  );

  const normalized = normalizePollInput({
    question: `  ${basePoll.question}  `,
    options: [" Morning ", "Evening"],
    allow_multiple: false,
    results_visibility: "after_vote",
    voter_visibility: "named",
  });
  assert.equal(normalized.question, basePoll.question);
  assert.deepEqual(normalized.options, basePoll.options);
  await assert.rejects(
    async () => normalizePollInput({ ...normalized, options: ["Same", " same "] }),
    /different/
  );

  const post = await createForumPost({
    categoryId: category.category_id,
    authorId: owner.user_id,
    title: "Meeting poll",
    body: "Please choose a meeting time.",
    poll: basePoll,
  });
  assert.equal(post.poll.question, basePoll.question);
  assert.equal(post.poll.options.length, 2);

  const beforeVote = await getForumPollForPost(post.post_id, voter.user_id);
  assert.equal(beforeVote.can_view_results, false);
  assert.equal(beforeVote.options[0].vote_count, null);
  await assert.rejects(
    updateForumPoll({
      postId: post.post_id,
      actingUserId: voter.user_id,
      canManageAny: false,
      poll: basePoll,
    }),
    /cannot edit/
  );
  await assert.rejects(
    closeForumPoll({ postId: post.post_id, actingUserId: voter.user_id, canManageAny: false }),
    /cannot close/
  );

  const edited = await updateForumPoll({
    postId: post.post_id,
    actingUserId: owner.user_id,
    canManageAny: false,
    poll: { ...basePoll, question: "Pick a new time", options: ["Noon", "Night"] },
  });
  assert.equal(edited.question, "Pick a new time");

  const firstChoiceId = edited.options[0].option_id;
  const secondChoiceId = edited.options[1].option_id;
  const voted = await replaceForumPollVote({
    postId: post.post_id,
    userId: voter.user_id,
    optionIds: [firstChoiceId],
  });
  assert.equal(voted.has_voted, true);
  assert.equal(voted.can_view_results, true);
  assert.equal(voted.total_voters, 1);
  assert.equal(voted.options[0].vote_count, 1);

  const replaced = await replaceForumPollVote({
    postId: post.post_id,
    userId: voter.user_id,
    optionIds: [secondChoiceId],
  });
  assert.equal(replaced.options[0].vote_count, 0);
  assert.equal(replaced.options[1].vote_count, 1);
  await assert.rejects(
    replaceForumPollVote({
      postId: post.post_id,
      userId: voter.user_id,
      optionIds: [firstChoiceId, secondChoiceId],
    }),
    /one choice/
  );

  const namedVoters = await getNamedPollVoters({
    postId: post.post_id,
    viewerId: voter.user_id,
    optionId: secondChoiceId,
  });
  assert.equal(namedVoters.total, 1);
  assert.equal(namedVoters.voters[0].username, "poll-voter");

  await removeForumPollVote({ postId: post.post_id, userId: voter.user_id });
  await assert.rejects(
    updateForumPoll({
      postId: post.post_id,
      actingUserId: owner.user_id,
      canManageAny: false,
      poll: { ...basePoll, question: "Too late to edit" },
    }),
    /cannot be changed/
  );

  const multiPost = await createForumPost({
    categoryId: category.category_id,
    authorId: owner.user_id,
    title: "Multiple-choice poll",
    body: "Choose every option that fits.",
    poll: { ...basePoll, allowMultiple: true, voterVisibility: "private" },
  });
  const multiOptionIds = multiPost.poll.options.map((option) => option.option_id);
  const multiVote = await replaceForumPollVote({
    postId: multiPost.post_id,
    userId: voter.user_id,
    optionIds: multiOptionIds,
  });
  assert.equal(multiVote.my_option_ids.length, 2);
  assert.equal(multiVote.total_voters, 1);
  await assert.rejects(
    getNamedPollVoters({
      postId: multiPost.post_id,
      viewerId: voter.user_id,
      optionId: multiOptionIds[0],
    }),
    /private/
  );

  await closeForumPoll({
    postId: multiPost.post_id,
    actingUserId: staff.user_id,
    canManageAny: true,
  });
  assert.equal((await getForumPollForPost(multiPost.post_id, voter.user_id)).is_closed, true);
  await assert.rejects(
    removeForumPollVote({ postId: multiPost.post_id, userId: voter.user_id }),
    /closed/
  );

  const timedPost = await createForumPost({
    categoryId: category.category_id,
    authorId: owner.user_id,
    title: "Timed poll",
    body: "This one is already over.",
    poll: basePoll,
  });
  await db.query(
    "UPDATE forum_polls SET closes_at = NOW() - INTERVAL '1 minute' WHERE post_id = $1",
    [timedPost.post_id]
  );
  assert.equal((await getForumPollForPost(timedPost.post_id, voter.user_id)).is_closed, true);
  await assert.rejects(
    replaceForumPollVote({
      postId: timedPost.post_id,
      userId: voter.user_id,
      optionIds: [timedPost.poll.options[0].option_id],
    }),
    /closed/
  );

  await db.query("DELETE FROM posts WHERE post_id = $1", [multiPost.post_id]);
  const cascade = await db.query("SELECT COUNT(*)::INT AS count FROM forum_polls WHERE post_id = $1", [multiPost.post_id]);
  assert.equal(cascade.rows[0].count, 0);

  console.log("FORUM_POLLS_INTEGRATION_OK single=covered multiple=covered privacy=covered lifecycle=covered");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
