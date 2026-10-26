// Tests for spotting short thank-you / praise DMs that Dill ❤️s.

const { isGratitude } = require('../src/utils/gratitude');

// ── Matches ───────────────────────────────────────────────────────────────────

describe('isGratitude', () => {
  test.each([
    'thanks', 'Thanks Dill!', 'thank you', 'ty', 'thx :pray:', 'cheers mate',
    'good bot', 'Good bot <@U123>', 'great dill', 'love you dill', 'appreciate it',
  ])('matches %p', (text) => {
    expect(isGratitude(text)).toBe(true);
  });

  // ── Non-matches ─────────────────────────────────────────────────────────────

  test.each([
    '', 'hello', 'bad bot', 'what time is my survey?',
    'thanks but how do I change the time of my survey please',
    'they', 'tasks for today',
  ])('ignores %p', (text) => {
    expect(isGratitude(text)).toBe(false);
  });
});
