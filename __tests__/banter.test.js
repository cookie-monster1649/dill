// Tests for spotting banter aimed at Dill in DMs: praise (❤️), mild
// insults (😢) and outright rudeness ("I'm going to report this to HR. BRB").

const { classifyBanter } = require('../src/utils/banter');

// ── Praise ────────────────────────────────────────────────────────────────────

describe('classifyBanter', () => {
  test.each([
    'thanks', 'Thanks Dill!', 'thank you', 'ty', 'thx :pray:', 'cheers mate',
    'good bot', 'Good bot <@U123>', 'clever bot', 'smart dill', 'great dill',
    'love you dill', 'appreciate it', 'good job',
  ])('%p is love', (text) => {
    expect(classifyBanter(text)).toBe('love');
  });

  // ── Mild insults ────────────────────────────────────────────────────────────

  test.each([
    'bad bot', 'Bad bot!', 'stupid bot', 'dumb dill', 'useless pickle', 'naughty bot', 'ugh',
  ])('%p is sad', (text) => {
    expect(classifyBanter(text)).toBe('sad');
  });

  // ── Rudeness ────────────────────────────────────────────────────────────────

  test.each([
    'fuck you', 'f*** off dill', 'shut up', 'stfu bot', 'piss off', 'screw you dill',
    'I hate you', 'you suck', 'piece of crap', 'good bot, now shut up',
  ])('%p is rude', (text) => {
    expect(classifyBanter(text)).toBe('rude');
  });

  // ── Not banter ──────────────────────────────────────────────────────────────

  test.each([
    '', 'hello', 'what time is my survey?',
    'thanks but how do I change the time of my survey please',
    'they', 'tasks for today', 'the build is broken',
  ])('%p is not banter', (text) => {
    expect(classifyBanter(text)).toBeNull();
  });
});
