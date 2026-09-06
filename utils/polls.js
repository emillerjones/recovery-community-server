const RESULTS_VISIBILITY = new Set(["always", "after_vote", "after_close"]);
const VOTER_VISIBILITY = new Set(["private", "named"]);
const MAX_POLL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function pollInputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function normalizePollInput(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw pollInputError("Poll details are required.");
  }

  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question || question.length > 300) {
    throw pollInputError("Poll questions must be between 1 and 300 characters.");
  }

  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 10) {
    throw pollInputError("Polls need between 2 and 10 choices.");
  }

  const options = input.options.map((option) => typeof option === "string" ? option.trim() : "");
  if (options.some((option) => !option || option.length > 200)) {
    throw pollInputError("Each poll choice must be between 1 and 200 characters.");
  }
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    throw pollInputError("Poll choices must be different from one another.");
  }

  const allowMultiple = input.allow_multiple === true;
  const resultsVisibility = RESULTS_VISIBILITY.has(input.results_visibility)
    ? input.results_visibility
    : "after_vote";
  const voterVisibility = VOTER_VISIBILITY.has(input.voter_visibility)
    ? input.voter_visibility
    : "private";

  let closesAt = null;
  if (input.closes_at) {
    closesAt = new Date(input.closes_at);
    if (Number.isNaN(closesAt.getTime()) || closesAt <= now) {
      throw pollInputError("Choose a poll closing time in the future.");
    }
    if (closesAt.getTime() - now.getTime() > MAX_POLL_DURATION_MS + 5 * 60 * 1000) {
      throw pollInputError("Polls can remain open for up to one week.");
    }
  }

  return {
    question,
    options,
    allowMultiple,
    resultsVisibility,
    voterVisibility,
    closesAt,
  };
}
