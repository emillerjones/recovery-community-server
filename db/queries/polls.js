import db, { withTransaction } from "#db/client";

function pollRuleError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isEffectivelyClosed(poll) {
  return Boolean(poll.closed_at || (poll.closes_at && new Date(poll.closes_at) <= new Date()));
}

function canViewResults(poll) {
  if (poll.results_visibility === "always") return true;
  if (isEffectivelyClosed(poll)) return true;
  return poll.results_visibility === "after_vote" && poll.has_voted;
}

function publicPoll(poll, options) {
  const isClosed = isEffectivelyClosed(poll);
  const showResults = canViewResults(poll);
  return {
    poll_id: poll.poll_id,
    post_id: poll.post_id,
    question: poll.question,
    allow_multiple: poll.allow_multiple,
    results_visibility: poll.results_visibility,
    voter_visibility: poll.voter_visibility,
    closes_at: poll.closes_at,
    closed_at: poll.closed_at,
    updated_at: poll.updated_at,
    is_closed: isClosed,
    voting_started: Boolean(poll.voting_started_at),
    has_voted: poll.has_voted,
    my_option_ids: options.filter((option) => option.selected).map((option) => option.option_id),
    total_voters: poll.total_voters,
    can_view_results: showResults,
    can_view_voters: showResults && poll.voter_visibility === "named",
    options: options.map((option) => ({
      option_id: option.option_id,
      option_text: option.option_text,
      display_order: option.display_order,
      selected: option.selected,
      vote_count: showResults ? option.vote_count : null,
      percentage: showResults && poll.total_voters > 0
        ? Math.round((option.vote_count / poll.total_voters) * 100)
        : showResults ? 0 : null,
    })),
  };
}

export async function createForumPoll(client, postId, poll) {
  const { rows: [created] } = await client.query(
    `INSERT INTO forum_polls (
       post_id, question, allow_multiple, results_visibility, voter_visibility, closes_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      postId,
      poll.question,
      poll.allowMultiple,
      poll.resultsVisibility,
      poll.voterVisibility,
      poll.closesAt,
    ]
  );
  await client.query(
    `INSERT INTO forum_poll_options (poll_id, option_text, display_order)
     SELECT $1, choice.option_text, choice.display_order - 1
     FROM unnest($2::TEXT[]) WITH ORDINALITY AS choice(option_text, display_order)`,
    [created.poll_id, poll.options]
  );
  return created;
}

export async function getForumPollsForPosts(postIds, viewerId) {
  if (!postIds.length) return new Map();
  const { rows: polls } = await db.query(
    `SELECT poll.*, post.author_id,
            COUNT(DISTINCT vote.user_id)::INT AS total_voters,
            EXISTS (
              SELECT 1
              FROM forum_poll_options my_option
              JOIN forum_poll_votes my_vote ON my_vote.option_id = my_option.option_id
              WHERE my_option.poll_id = poll.poll_id AND my_vote.user_id = $2
            ) AS has_voted
     FROM forum_polls poll
     JOIN posts post ON post.post_id = poll.post_id
     LEFT JOIN forum_poll_options option ON option.poll_id = poll.poll_id
     LEFT JOIN forum_poll_votes vote ON vote.option_id = option.option_id
     WHERE poll.post_id = ANY($1::INT[])
     GROUP BY poll.poll_id, post.author_id`,
    [postIds, viewerId]
  );
  if (!polls.length) return new Map();

  const { rows: options } = await db.query(
    `SELECT option.option_id, option.poll_id, option.option_text, option.display_order,
            COUNT(vote.user_id)::INT AS vote_count,
            COALESCE(BOOL_OR(vote.user_id = $2), FALSE) AS selected
     FROM forum_poll_options option
     LEFT JOIN forum_poll_votes vote ON vote.option_id = option.option_id
     WHERE option.poll_id = ANY($1::BIGINT[])
     GROUP BY option.option_id
     ORDER BY option.poll_id, option.display_order`,
    [polls.map((poll) => poll.poll_id), viewerId]
  );

  const optionsByPoll = new Map();
  for (const option of options) {
    const existing = optionsByPoll.get(String(option.poll_id)) || [];
    existing.push(option);
    optionsByPoll.set(String(option.poll_id), existing);
  }

  return new Map(polls.map((poll) => [
    String(poll.post_id),
    publicPoll(poll, optionsByPoll.get(String(poll.poll_id)) || []),
  ]));
}

export async function getForumPollForPost(postId, viewerId) {
  const polls = await getForumPollsForPosts([postId], viewerId);
  return polls.get(String(postId)) || null;
}

async function lockedOpenPoll(client, postId) {
  const { rows: [poll] } = await client.query(
    `SELECT poll.*,
            (poll.closed_at IS NOT NULL OR (poll.closes_at IS NOT NULL AND poll.closes_at <= NOW())) AS is_closed
     FROM forum_polls poll
     JOIN posts post ON post.post_id = poll.post_id
     WHERE poll.post_id = $1 AND post.active = TRUE AND post.deleted_at IS NULL
     FOR UPDATE OF poll`,
    [postId]
  );
  if (!poll) throw pollRuleError("Poll not found.", 404);
  if (poll.is_closed) throw pollRuleError("This poll is closed.", 409);
  return poll;
}

export async function replaceForumPollVote({ postId, userId, optionIds }) {
  await withTransaction(async (client) => {
    const poll = await lockedOpenPoll(client, postId);
    const uniqueOptionIds = [...new Set(optionIds.map(Number))];
    if (!uniqueOptionIds.length || uniqueOptionIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw pollRuleError("Choose at least one poll option.");
    }
    if (!poll.allow_multiple && uniqueOptionIds.length !== 1) {
      throw pollRuleError("This poll allows one choice.");
    }

    const { rows: validOptions } = await client.query(
      `SELECT option_id FROM forum_poll_options
       WHERE poll_id = $1 AND option_id = ANY($2::BIGINT[])`,
      [poll.poll_id, uniqueOptionIds]
    );
    if (validOptions.length !== uniqueOptionIds.length) {
      throw pollRuleError("One or more poll choices are invalid.");
    }

    await client.query(
      `UPDATE forum_polls
       SET voting_started_at = COALESCE(voting_started_at, NOW()), updated_at = NOW()
       WHERE poll_id = $1`,
      [poll.poll_id]
    );

    await client.query(
      `DELETE FROM forum_poll_votes vote
       USING forum_poll_options option
       WHERE vote.option_id = option.option_id
         AND option.poll_id = $1
         AND vote.user_id = $2`,
      [poll.poll_id, userId]
    );
    await client.query(
      `INSERT INTO forum_poll_votes (option_id, user_id)
       SELECT option_id, $2
       FROM forum_poll_options
       WHERE poll_id = $1 AND option_id = ANY($3::BIGINT[])`,
      [poll.poll_id, userId, uniqueOptionIds]
    );
  });
  return getForumPollForPost(postId, userId);
}

export async function removeForumPollVote({ postId, userId }) {
  await withTransaction(async (client) => {
    const poll = await lockedOpenPoll(client, postId);
    await client.query(
      `DELETE FROM forum_poll_votes vote
       USING forum_poll_options option
       WHERE vote.option_id = option.option_id
         AND option.poll_id = $1
         AND vote.user_id = $2`,
      [poll.poll_id, userId]
    );
    await client.query(
      `UPDATE forum_polls SET updated_at = NOW() WHERE poll_id = $1`,
      [poll.poll_id]
    );
  });
  return getForumPollForPost(postId, userId);
}

export async function updateForumPoll({ postId, actingUserId, canManageAny, poll: changes }) {
  await withTransaction(async (client) => {
    const poll = await lockedOpenPoll(client, postId);
    const { rows: [post] } = await client.query(
      `SELECT author_id FROM posts WHERE post_id = $1`,
      [postId]
    );
    if (post.author_id !== actingUserId && !canManageAny) {
      throw pollRuleError("You cannot edit this poll.", 403);
    }
    if (poll.voting_started_at) {
      throw pollRuleError("Poll details cannot be changed after voting begins.", 409);
    }

    await client.query(
      `UPDATE forum_polls
       SET question = $2, allow_multiple = $3, results_visibility = $4,
           voter_visibility = $5, closes_at = $6, updated_at = NOW()
       WHERE poll_id = $1`,
      [
        poll.poll_id,
        changes.question,
        changes.allowMultiple,
        changes.resultsVisibility,
        changes.voterVisibility,
        changes.closesAt,
      ]
    );
    await client.query(`DELETE FROM forum_poll_options WHERE poll_id = $1`, [poll.poll_id]);
    await client.query(
      `INSERT INTO forum_poll_options (poll_id, option_text, display_order)
       SELECT $1, choice.option_text, choice.display_order - 1
       FROM unnest($2::TEXT[]) WITH ORDINALITY AS choice(option_text, display_order)`,
      [poll.poll_id, changes.options]
    );
  });
  return getForumPollForPost(postId, actingUserId);
}

export async function closeForumPoll({ postId, actingUserId, canManageAny }) {
  await withTransaction(async (client) => {
    const poll = await lockedOpenPoll(client, postId);
    const { rows: [post] } = await client.query(`SELECT author_id FROM posts WHERE post_id = $1`, [postId]);
    if (post.author_id !== actingUserId && !canManageAny) {
      throw pollRuleError("You cannot close this poll.", 403);
    }
    await client.query(
      `UPDATE forum_polls SET closed_at = NOW(), closed_by = $2, updated_at = NOW()
       WHERE poll_id = $1`,
      [poll.poll_id, actingUserId]
    );
  });
  return getForumPollForPost(postId, actingUserId);
}

export async function getNamedPollVoters({ postId, viewerId, optionId, page = 0, limit = 50 }) {
  const poll = await getForumPollForPost(postId, viewerId);
  if (!poll) throw pollRuleError("Poll not found.", 404);
  if (poll.voter_visibility !== "named") throw pollRuleError("Votes in this poll are private.", 403);
  if (!poll.can_view_results) throw pollRuleError("Vote or wait for the poll to close to see voters.", 403);
  if (!poll.options.some((option) => String(option.option_id) === String(optionId))) {
    throw pollRuleError("Poll choice not found.", 404);
  }

  const { rows } = await db.query(
    `SELECT member.user_id, member.username, member.avatar_url,
            COUNT(*) OVER()::INT AS total_count
     FROM forum_poll_votes vote
     JOIN forum_poll_options option ON option.option_id = vote.option_id
     JOIN users member ON member.user_id = vote.user_id
     WHERE option.poll_id = $1 AND option.option_id = $2
       AND member.is_system = FALSE
       AND member.account_status = 'approved'
       AND member.active = TRUE
       AND member.deleted_at IS NULL
     ORDER BY vote.created_at, member.user_id
     LIMIT $3 OFFSET $4`,
    [poll.poll_id, optionId, limit, page * limit]
  );
  return {
    voters: rows.map(({ total_count, ...voter }) => voter),
    total: rows[0]?.total_count || 0,
    page,
    has_more: rows.length === limit && (page + 1) * limit < (rows[0]?.total_count || 0),
  };
}
