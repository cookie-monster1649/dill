// ── Empty Answers ─────────────────────────────────────────────────────────────
//
// Spots "nothing to say" answers ("no", "nope", "n/a", "skip"…) so they can
// be left out of the channel post – a wall of "Blockers? No" is noise.
// Only answers that are *entirely* a non-answer match; "No, but I'm stuck
// on the deploy" is real content and is kept.

// Matched against the whole cleaned-up answer
const EMPTY_PATTERNS = [
  /^(no|nope|nah|naw|nada|nil|none|nothing|zip|zilch|skip|pass)$/,
  /^n ?a$/,                                            // n/a, na
  /^not (really|today|much|yet)$/,
  /^no(pe)? (blockers?|issues?|problems?|updates?)( today)?$/,
  /^(none|nothing|nada|no) (today|here|new|yet|right now|atm|for now|to report|to share|at the moment)$/,
  /^nothing (new )?to (report|share|add)$/,
];

/**
 * @param {string} answer - Answer as stored (Slack-escaped text)
 * @returns {boolean}
 *
 * @example
 * isEmptyAnswer('Nope!')                        // → true
 * isEmptyAnswer('n/a')                          // → true
 * isEmptyAnswer('No blockers today :tada:')     // → true
 * isEmptyAnswer('No, but the deploy is stuck')  // → false
 */
function isEmptyAnswer(answer) {
  // ':tada:' / punctuation / '-' → spaces, so only words remain
  const cleaned = (answer || '')
    .toLowerCase()
    .replace(/:[a-z0-9_+-]+:/g, ' ')
    .replace(/&amp;|&lt;|&gt;/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A bare "-" or "." cleans down to nothing – also a non-answer
  if (!cleaned) return true;
  return EMPTY_PATTERNS.some(pattern => pattern.test(cleaned));
}

module.exports = { isEmptyAnswer };
