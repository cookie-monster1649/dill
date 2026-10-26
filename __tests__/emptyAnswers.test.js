// Tests for spotting "nothing to say" survey answers that are left out of
// the channel post.

const { isEmptyAnswer } = require('../src/utils/emptyAnswers');

// ── Non-answers ───────────────────────────────────────────────────────────────

describe('isEmptyAnswer', () => {
  test.each([
    'No', 'no.', 'Nope!', 'nah', 'nada', 'Nothing', 'none', 'skip', 'Pass',
    'n/a', 'N/A', 'na', 'nil', '-', '.', '',
    'not really', 'No blockers', 'no blockers today :tada:', 'Nothing today',
    'none at the moment', 'nothing to report', 'Nothing new to share',
  ])('hides %p', (answer) => {
    expect(isEmptyAnswer(answer)).toBe(true);
  });

  // ── Real answers ────────────────────────────────────────────────────────────

  test.each([
    'No, but the deploy is stuck',
    'Nothing yet – waiting on design review',
    'Shipped the login page',
    'Not today, out sick tomorrow though',
    'Nobody replied to my PR',
    'yes',
    'all good',
  ])('keeps %p', (answer) => {
    expect(isEmptyAnswer(answer)).toBe(false);
  });
});
