import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import {
  createUser,
  getUserByEmailAndPassword,
  getUserByUsername,
  getUsers,
  hardDeleteTestUser,
  searchActiveUsersForMention,
  updateOwnProfile,
} from "#db/queries/users";
import { createRegistration, verifyEmail } from "#db/queries/registration";
import {
  createPersonalInvite, createSharedCode, reviewApplication,
} from "#db/queries/admissions";
import {
  createForumComment,
  createForumPost,
  flagForumComment,
  flagForumPost,
  getForumPosts,
  getForumTags,
  setForumPostReaction,
  setForumPostTags,
  softDeleteForumComment,
  softDeleteForumPost,
  updateForumComment,
  updateForumPost,
  updateForumPostModeration,
} from "#db/queries/forum";
import {
  createDirectReplyNotification,
  createForumParticipantNotifications,
  createStaffFlagNotifications,
} from "#db/queries/notifications";
import { createSecureToken, hashSecret } from "#utils/secureTokens";

const schemaName = "codex_registration_integration";

function application(overrides = {}) {
  return {
    email: "applicant@example.com",
    username: "applicant",
    password: "correct-horse-42",
    reasonForJoining: "I would value private peer support.",
    howFound: "The community website.",
    admissionMethod: "standard",
    ...overrides,
  };
}

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  // Apply the deployment migration over the already-current schema too. This
  // verifies its syntax and idempotency without committing anything outside
  // this test's rollback transaction.
  const editMigration = (await fs.readFile(
    new URL("../db/migrations/009_add_forum_comment_edits.sql", import.meta.url),
    "utf8"
  )).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(editMigration);
  const tagMigration = (await fs.readFile(
    new URL("../db/migrations/010_add_forum_tags.sql", import.meta.url),
    "utf8"
  )).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(tagMigration);
  const feedIndexMigration = (await fs.readFile(
    new URL("../db/migrations/011_add_forum_feed_index.sql", import.meta.url),
    "utf8"
  )).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(feedIndexMigration);
  const { rows: [feedIndex] } = await db.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_comments_post_active_created'"
  );
  assert.equal(feedIndex.indexname, "idx_comments_post_active_created");
  const reactionMigration = (await fs.readFile(
    new URL("../db/migrations/012_remove_encouragement_reaction.sql", import.meta.url),
    "utf8"
  )).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(reactionMigration);
  const { rows: [reactionConstraint] } = await db.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'forum_reactions'::regclass
      AND conname = 'forum_reactions_reaction_type_check'
  `);
  assert.doesNotMatch(reactionConstraint.definition, /encouragement/);
  assert.match(reactionConstraint.definition, /support/);
  await db.query(`INSERT INTO user_roles (role_id, role_name) VALUES
    (1, 'owner'), (10, 'administrator'), (50, 'moderator'), (100, 'member'), (1000, 'system')`);
  const owner = await createUser("owner@example.com", "owner", "owner-password", 1);

  // The automated-content author exists as a real foreign-key-safe user, but
  // every human-member discovery and login path must pretend it is not there.
  const { rows: [systemUser] } = await db.query(`
    INSERT INTO users (role_id, email, password, username, is_system, account_status, email_verified_at)
    VALUES (1000, 'system@example.invalid', 'not-a-usable-password', 'Recovery Community', TRUE, 'approved', NOW())
    RETURNING user_id
  `);
  assert.equal((await getUsers()).some((user) => user.user_id === systemUser.user_id), false);
  assert.equal(await getUserByUsername("Recovery Community"), undefined);
  assert.equal(await getUserByEmailAndPassword("system@example.invalid", "not-a-usable-password"), null);
  assert.equal((await searchActiveUsersForMention("Recovery", owner.user_id)).length, 0);

  const completedProfile = await updateOwnProfile(owner.user_id, {
    bio: "Community founder", phoneNumber: "555-0100",
    dateOfBirth: "1980-01-02", gender: "Woman", avatarUrl: "preset:Butterfly:lavender",
  });
  assert.equal(completedProfile.bio, "Community founder");
  assert.equal(new Date(completedProfile.date_of_birth).toISOString().slice(0, 10), "1980-01-02");
  assert.equal(completedProfile.avatar_url, "preset:Butterfly:lavender");

  // Editing content stores the previous wording privately and sets the public
  // edited timestamp. Pin/lock moderation must not create a revision.
  const { rows: [category] } = await db.query(
    "INSERT INTO forum_categories (name, slug) VALUES ('Introductions', 'introductions') RETURNING category_id"
  );
  const { rows: [originalPost] } = await db.query(
    "INSERT INTO posts (category_id, author_id, title, body) VALUES ($1, $2, 'Original title', 'Original body') RETURNING *",
    [category.category_id, owner.user_id]
  );
  const { rows: [{ count: originalPostAlertCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM notifications WHERE post_id = $1 AND type = 'new_forum_post'",
    [originalPost.post_id]
  );
  assert.equal(originalPostAlertCount, 1);
  const editedPost = await updateForumPost(originalPost.post_id, owner.user_id, true, true, {
    title: "Edited title", body: "Edited body",
  });
  assert.ok(editedPost.content_edited_at);
  const { rows: [revision] } = await db.query(
    "SELECT * FROM forum_post_revisions WHERE post_id = $1", [originalPost.post_id]
  );
  assert.equal(revision.previous_title, "Original title");
  assert.equal(revision.previous_body, "Original body");
  assert.equal(revision.edited_by, owner.user_id);
  await updateForumPostModeration(originalPost.post_id, { pinned: true });
  const { rows: [{ count: revisionCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM forum_post_revisions WHERE post_id = $1", [originalPost.post_id]
  );
  assert.equal(revisionCount, 1);

  // Flow 1: standard applicant verifies, becomes pending, then is approved.
  const standardSecret = createSecureToken();
  const standard = await createRegistration(application({ tokenHash: standardSecret.tokenHash }));
  assert.equal(standard.account_status, "unverified");
  assert.equal((await verifyEmail(hashSecret(standardSecret.token))).account_status, "pending");
  const { rows: [pendingApplication] } = await db.query(
    "SELECT application_id FROM membership_applications WHERE user_id = $1", [standard.user_id]
  );
  assert.equal((await reviewApplication(pendingApplication.application_id, owner.user_id, "approved", "")).account_status, "approved");
  await assertWelcomePost(standard.user_id, standard.username, systemUser.user_id, 2);
  assert.equal((await hardDeleteTestUser(standard.user_id)).email, standard.email);
  assert.equal((await db.query("SELECT COUNT(*)::INT AS count FROM posts WHERE welcome_member_id = $1", [standard.user_id])).rows[0].count, 0);

  // Flow 2: a private, one-use invitation bypasses manual review after verification.
  const inviteSecret = createSecureToken();
  await createPersonalInvite({
    email: "invited@example.com", tokenHash: inviteSecret.tokenHash,
    createdBy: owner.user_id, expiresAt: new Date(Date.now() + 86400000),
  });
  const invitedVerification = createSecureToken();
  const invited = await createRegistration(application({
    email: "invited@example.com", username: "invited", admissionMethod: "personal_invite",
    tokenHash: invitedVerification.tokenHash, sourceHash: inviteSecret.tokenHash,
  }));
  assert.equal(invited.account_status, "approved");
  await assertWelcomePost(invited.user_id, invited.username, systemUser.user_id, 2);
  const { rows: [invitedTokenCount] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM email_verification_tokens WHERE user_id = $1", [invited.user_id]
  );
  assert.equal(invitedTokenCount.count, 0);
  assert.equal((await hardDeleteTestUser(invited.user_id)).email, invited.email);
  const { rows: [remainingInvite] } = await db.query("SELECT COUNT(*)::INT AS count FROM personal_invites");
  assert.equal(remainingInvite.count, 0);

  // Flow 3: an active shared code behaves like the invite, and counts its use.
  const readableCode = "FACEBOOK-TEST";
  await createSharedCode({
    name: "Facebook test", codeHash: hashSecret(readableCode), createdBy: owner.user_id,
    expiresAt: new Date(Date.now() + 86400000), maxUses: 2,
  });
  const codeVerification = createSecureToken();
  await createRegistration(application({
    email: "coded@example.com", username: "coded", admissionMethod: "shared_code",
    tokenHash: codeVerification.tokenHash, sourceHash: hashSecret(readableCode),
  }));
  const approvedCodedUser = await verifyEmail(codeVerification.tokenHash);
  assert.equal(approvedCodedUser.account_status, "approved");
  await assertWelcomePost(approvedCodedUser.user_id, approvedCodedUser.username, systemUser.user_id, 2);
  const { rows: [code] } = await db.query("SELECT use_count FROM shared_invite_codes");
  assert.equal(code.use_count, 1);
  assert.equal((await hardDeleteTestUser((await db.query("SELECT user_id FROM users WHERE email = 'coded@example.com'")).rows[0].user_id)).email, "coded@example.com");
  const { rows: [restoredCode] } = await db.query("SELECT use_count FROM shared_invite_codes");
  assert.equal(restoredCode.use_count, 0);

  // Delete permissions: members/moderators can remove only their own content;
  // owner/admin may remove anyone's. Comment removal recursively soft-deletes
  // the complete child branch, while post removal covers every reply.
  const memberAuthor = await createUser("delete-author@example.com", "delete-author", "password-123", 100);
  const otherMember = await createUser("delete-other@example.com", "delete-other", "password-123", 100);
  const moderator = await createUser("delete-mod@example.com", "delete-mod", "password-123", 50);
  const administrator = await createUser("delete-admin@example.com", "delete-admin", "password-123", 10);
  const nestedOnlyMember = await createUser("nested-only@example.com", "nested-only", "password-123", 100);

  // Owner-approved broad alerts go to the unique set of OG poster,
  // original-post reactors, and direct commenters. Nested-only participants
  // stay outside that group and the actor never receives their own alert.
  const participantPost = await createForumPost({
    categoryId: category.category_id, authorId: owner.user_id,
    title: "Participant alerts", body: "Everyone involved stays in the loop.",
  });
  await setForumPostReaction(participantPost.post_id, memberAuthor.user_id, "support");
  const existingDirectComment = await createForumComment({
    postId: participantPost.post_id, authorId: otherMember.user_id,
    parentCommentId: null, body: "Existing participant comment.",
  });
  const nestedReply = await createForumComment({
    postId: participantPost.post_id, authorId: nestedOnlyMember.user_id,
    parentCommentId: existingDirectComment.comment_id, body: "A targeted nested reply.",
  });
  const targetedReplyAlert = await createDirectReplyNotification({
    actorId: nestedOnlyMember.user_id,
    postId: participantPost.post_id,
    parentCommentId: existingDirectComment.comment_id,
    commentId: nestedReply.comment_id,
  });
  assert.equal(targetedReplyAlert.user_id, otherMember.user_id);
  assert.equal(targetedReplyAlert.type, "reply_to_comment");
  const moderatorComment = await createForumComment({
    postId: participantPost.post_id, authorId: moderator.user_id,
    parentCommentId: null, body: "New activity that triggers alerts.",
  });
  const commentAlerts = await createForumParticipantNotifications({
    actorId: moderator.user_id,
    postId: participantPost.post_id,
    commentId: moderatorComment.comment_id,
    activity: "comment",
  });
  assert.deepEqual(
    commentAlerts.map((alert) => alert.user_id).sort((a, b) => a - b),
    [owner.user_id, memberAuthor.user_id, otherMember.user_id].sort((a, b) => a - b)
  );
  assert.equal(commentAlerts.some((alert) => alert.user_id === nestedOnlyMember.user_id), false);
  assert.ok(commentAlerts.every((alert) => alert.type === "comment_on_participated_post"));

  await setForumPostReaction(participantPost.post_id, administrator.user_id, "care");
  const reactionAlerts = await createForumParticipantNotifications({
    actorId: administrator.user_id,
    postId: participantPost.post_id,
    activity: "reaction",
  });
  assert.deepEqual(
    reactionAlerts.map((alert) => alert.user_id).sort((a, b) => a - b),
    [owner.user_id, memberAuthor.user_id, otherMember.user_id, moderator.user_id].sort((a, b) => a - b)
  );
  assert.equal(reactionAlerts.some((alert) => alert.user_id === nestedOnlyMember.user_id), false);
  assert.ok(reactionAlerts.every((alert) => alert.type === "reaction_on_participated_post"));

  // Edit permissions: members cannot edit even their own content; moderator
  // and admin may edit only their own; owner may edit anyone's. Locked posts
  // remain editable by the staff member who authored them.
  const memberEditPost = await createForumPost({
    categoryId: category.category_id, authorId: memberAuthor.user_id,
    title: "Member permanent post", body: "Original member wording.",
  });
  const activeTags = await getForumTags();
  const questionTag = activeTags.find((tag) => tag.slug === "question");
  assert.ok(questionTag);
  await setForumPostTags(memberEditPost.post_id, [questionTag.tag_id]);
  const { posts: taggedPosts } = await getForumPosts({ tagSlugs: ["question"], viewerId: memberAuthor.user_id });
  assert.equal(taggedPosts.some((post) => post.post_id === memberEditPost.post_id), true);
  assert.equal(taggedPosts.find((post) => post.post_id === memberEditPost.post_id).tags[0].slug, "question");

  const stepsTag = activeTags.find((tag) => tag.slug === "12steps");
  const stepsPost = await createForumPost({
    categoryId: category.category_id, authorId: otherMember.user_id,
    title: "A twelve-step question", body: "Looking for shared experience.",
  });
  await setForumPostTags(stepsPost.post_id, [stepsTag.tag_id]);
  const { posts: eitherTagPosts } = await getForumPosts({
    tagSlugs: ["question", "12steps"], viewerId: memberAuthor.user_id,
  });
  assert.equal(eitherTagPosts.some((post) => post.post_id === memberEditPost.post_id), true);
  assert.equal(eitherTagPosts.some((post) => post.post_id === stepsPost.post_id), true);
  const firstFeedPage = await getForumPosts({ viewerId: memberAuthor.user_id, limit: 1, page: 0 });
  assert.equal(firstFeedPage.posts.length, 1);
  assert.equal(firstFeedPage.has_more, true);
  assert.equal(firstFeedPage.next_page, 1);
  const { posts: ownFeed } = await getForumPosts({ viewerId: memberAuthor.user_id, sort: "mine" });
  assert.ok(ownFeed.every((post) => post.author_id === memberAuthor.user_id));
  await db.query(
    "INSERT INTO forum_saved_posts (user_id, post_id) VALUES ($1, $2)",
    [otherMember.user_id, memberEditPost.post_id]
  );
  const { posts: savedFeed } = await getForumPosts({ viewerId: otherMember.user_id, sort: "saved" });
  assert.deepEqual(savedFeed.map((post) => post.post_id), [memberEditPost.post_id]);

  const { rows: [announcementCategory] } = await db.query(
    "SELECT category_id FROM forum_categories WHERE slug = 'announcements'"
  );
  assert.equal(await createForumPost({
    categoryId: announcementCategory.category_id, authorId: memberAuthor.user_id,
    title: "Member announcement attempt", body: "Members cannot publish here.",
  }), undefined);
  assert.ok(await createForumPost({
    categoryId: announcementCategory.category_id, authorId: moderator.user_id,
    title: "Staff announcement", body: "An official community update.", canPostAnnouncements: true,
  }));
  assert.equal(await updateForumPost(
    memberEditPost.post_id, memberAuthor.user_id, false, false,
    { body: "Member attempted edit." }
  ), undefined);
  assert.equal(await updateForumPost(
    memberEditPost.post_id, administrator.user_id, true, false,
    { body: "Administrator attempted another member edit." }
  ), undefined);

  const moderatorEditPost = await createForumPost({
    categoryId: category.category_id, authorId: moderator.user_id,
    title: "Moderator post", body: "Original moderator wording.",
  });
  await updateForumPostModeration(moderatorEditPost.post_id, { locked: true });
  assert.ok(await updateForumPost(
    moderatorEditPost.post_id, moderator.user_id, true, false,
    { body: "Corrected moderator wording." }
  ));
  assert.equal(await updateForumPost(
    memberEditPost.post_id, moderator.user_id, true, false,
    { body: "Moderator attempted another member edit." }
  ), undefined);

  const editableComment = await createForumComment({
    postId: memberEditPost.post_id, authorId: administrator.user_id,
    parentCommentId: null, body: "Original administrator reply",
  });
  const memberPermanentComment = await createForumComment({
    postId: memberEditPost.post_id, authorId: memberAuthor.user_id,
    parentCommentId: null, body: "Permanent member reply",
  });
  assert.equal(await updateForumComment(
    memberEditPost.post_id, memberPermanentComment.comment_id,
    memberAuthor.user_id, false, false, "Member attempted reply edit"
  ), undefined);
  assert.ok(await updateForumComment(
    memberEditPost.post_id, editableComment.comment_id,
    administrator.user_id, true, false, "Corrected administrator reply"
  ));
  assert.equal(await updateForumComment(
    memberEditPost.post_id, editableComment.comment_id,
    moderator.user_id, true, false, "Moderator attempted administrator edit"
  ), undefined);

  const ownerEditedPost = await updateForumPost(
    memberEditPost.post_id, owner.user_id, true, true,
    { body: "Owner-corrected member wording." }
  );
  assert.equal(ownerEditedPost.content_edited_by, owner.user_id);
  assert.equal(ownerEditedPost.content_edited_by_role_id, 1);
  const ownerEditedComment = await updateForumComment(
    memberEditPost.post_id, editableComment.comment_id,
    owner.user_id, true, true, "Owner-corrected administrator reply"
  );
  assert.equal(ownerEditedComment.content_edited_by, owner.user_id);
  assert.equal(ownerEditedComment.content_edited_by_role_id, 1);
  const { rows: [{ count: commentRevisionCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM forum_comment_revisions WHERE comment_id = $1",
    [editableComment.comment_id]
  );
  assert.equal(commentRevisionCount, 2);

  // Flag alerts: every active human staff account gets an in-app alert, while
  // members, the system account, and the person who raised the flag do not.
  const postFlag = await flagForumPost(
    memberEditPost.post_id, otherMember.user_id, "Needs staff review"
  );
  assert.ok(postFlag);
  const postFlagAlerts = await createStaffFlagNotifications({
    actorId: otherMember.user_id,
    postId: memberEditPost.post_id,
  });
  assert.deepEqual(
    postFlagAlerts.map(({ user_id }) => user_id).sort((a, b) => a - b),
    [owner.user_id, administrator.user_id, moderator.user_id].sort((a, b) => a - b)
  );
  assert.ok(postFlagAlerts.every(({ type }) => type === "flagged_post"));
  assert.equal(postFlagAlerts.some(({ user_id }) => user_id === memberAuthor.user_id), false);
  assert.equal(postFlagAlerts.some(({ user_id }) => user_id === systemUser.user_id), false);

  // When a staff member flags a reply, that actor is excluded from the alert
  // list. The query also returns the reply's real post for a safe direct link.
  const commentFlag = await flagForumComment(
    editableComment.comment_id, moderator.user_id, "Needs staff review"
  );
  assert.equal(commentFlag.post_id, memberEditPost.post_id);
  const commentFlagAlerts = await createStaffFlagNotifications({
    actorId: moderator.user_id,
    postId: commentFlag.post_id,
    commentId: editableComment.comment_id,
  });
  assert.deepEqual(
    commentFlagAlerts.map(({ user_id }) => user_id).sort((a, b) => a - b),
    [owner.user_id, administrator.user_id].sort((a, b) => a - b)
  );
  assert.ok(commentFlagAlerts.every(({ type }) => type === "flagged_comment"));
  assert.ok(commentFlagAlerts.every(({ comment_id }) => comment_id === editableComment.comment_id));

  const branchPost = await createForumPost({
    categoryId: category.category_id, authorId: memberAuthor.user_id,
    title: "Nested deletion", body: "Testing a complete reply branch.",
  });
  const rootReply = await createForumComment({
    postId: branchPost.post_id, authorId: memberAuthor.user_id,
    parentCommentId: null, body: "Root reply",
  });
  const childReply = await createForumComment({
    postId: branchPost.post_id, authorId: otherMember.user_id,
    parentCommentId: rootReply.comment_id, body: "Child reply",
  });
  await createForumComment({
    postId: branchPost.post_id, authorId: moderator.user_id,
    parentCommentId: childReply.comment_id, body: "Grandchild reply",
  });

  assert.equal(await softDeleteForumComment(
    branchPost.post_id, rootReply.comment_id, moderator.user_id, false
  ), undefined);
  const deletedBranch = await softDeleteForumComment(
    branchPost.post_id, rootReply.comment_id, memberAuthor.user_id, false
  );
  assert.equal(deletedBranch.deleted_count, 3);
  const { rows: [{ count: activeBranchCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM comments WHERE post_id = $1 AND deleted_at IS NULL",
    [branchPost.post_id]
  );
  assert.equal(activeBranchCount, 0);

  const adminPost = await createForumPost({
    categoryId: category.category_id, authorId: otherMember.user_id,
    title: "Administrator deletion", body: "Administrator permission test.",
  });
  await createForumComment({
    postId: adminPost.post_id, authorId: memberAuthor.user_id,
    parentCommentId: null, body: "Reply removed with post",
  });
  assert.equal(await softDeleteForumPost(adminPost.post_id, moderator.user_id, false), undefined);
  const adminDeletedPost = await softDeleteForumPost(adminPost.post_id, administrator.user_id, true);
  assert.equal(adminDeletedPost.deleted_comment_count, 1);

  const ownPost = await createForumPost({
    categoryId: category.category_id, authorId: memberAuthor.user_id,
    title: "Author deletion", body: "Authors retain deletion rights.",
  });
  await updateForumPostModeration(ownPost.post_id, { locked: true });
  assert.ok(await softDeleteForumPost(ownPost.post_id, memberAuthor.user_id, false));

  const ownerPost = await createForumPost({
    categoryId: category.category_id, authorId: otherMember.user_id,
    title: "Owner deletion", body: "Owner permission test.",
  });
  assert.ok(await softDeleteForumPost(ownerPost.post_id, owner.user_id, true));

  console.log("Integration test passed: registration, welcome alerts, participant alerts, staff flag alerts, protected system account, edit history, and recursive delete permissions.");
} finally {
  await db.query("ROLLBACK");
  await db.end();
}

async function assertWelcomePost(memberId, username, systemUserId, expectedAlertCount) {
  const { rows: [welcome] } = await db.query(
    `
      SELECT p.*, c.slug AS category_slug
      FROM posts p
      JOIN forum_categories c ON c.category_id = p.category_id
      WHERE p.welcome_member_id = $1
    `,
    [memberId]
  );
  assert.equal(welcome.author_id, systemUserId);
  assert.equal(welcome.category_slug, "introductions");
  assert.equal(welcome.title, `Welcome, ${username}!`);
  assert.match(welcome.body, new RegExp(`@${username}`));

  const { rows: [{ count: mentionCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM forum_mentions WHERE post_id = $1 AND mentioned_user_id = $2",
    [welcome.post_id, memberId]
  );
  assert.equal(mentionCount, 1);

  const { rows: [{ count: alertCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM notifications WHERE post_id = $1 AND type = 'new_forum_post'",
    [welcome.post_id]
  );
  assert.equal(alertCount, expectedAlertCount);

  // Re-saving an already-approved status fires the database trigger but must
  // not create a second automatic post or a second wave of notifications.
  await db.query("UPDATE users SET account_status = 'approved' WHERE user_id = $1", [memberId]);
  const { rows: [{ count: welcomeCount }] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM posts WHERE welcome_member_id = $1",
    [memberId]
  );
  assert.equal(welcomeCount, 1);
}
