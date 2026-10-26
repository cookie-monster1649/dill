// Tests for daily surveys: per-person local-time scheduling, the one-question-
// at-a-time DM conversation and the channel post formatting.

const { DateTime } = require('luxon');
const { isSurveyDue, minutesSinceSendTime, nowInZone, CATCH_UP_MINUTES } = require('../src/utils/surveySchedule');
const { enqueueSurvey, currentQuestion, recordAnswer, removeSurvey, isIdle } = require('../src/utils/surveyConversation');
const { buildAnswerBlocks, buildThreadParentBlocks, buildQuestionText } = require('../src/utils/surveyBlocks');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SURVEY = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '09:00' };

// 2026-10-26 is a Monday
function at(iso, zone = 'Australia/Sydney') {
  return DateTime.fromISO(iso, { zone });
}

const RUN = { channel: 'C1', name: 'Standup', date: '2026-10-26' };
const OTHER = { channel: 'C2', name: 'Check-in', date: '2026-10-26' };

// ── Schedule ──────────────────────────────────────────────────────────────────

describe('isSurveyDue', () => {
  test('is due at the send time on a configured day', () => {
    expect(isSurveyDue(SURVEY, at('2026-10-26T09:00'), undefined)).toBe(true);
  });

  test('is not due before the send time', () => {
    expect(isSurveyDue(SURVEY, at('2026-10-26T08:59'), undefined)).toBe(false);
  });

  test('is not due on a day the survey does not run', () => {
    expect(isSurveyDue(SURVEY, at('2026-10-25T09:00'), undefined)).toBe(false); // Sunday
  });

  test('is not sent twice on the same local day', () => {
    expect(isSurveyDue(SURVEY, at('2026-10-26T09:05'), '2026-10-26')).toBe(false);
  });

  test('catches up within the window after a restart, but not after it', () => {
    expect(isSurveyDue(SURVEY, at('2026-10-26T09:00').plus({ minutes: CATCH_UP_MINUTES }), undefined)).toBe(true);
    expect(isSurveyDue(SURVEY, at('2026-10-26T09:00').plus({ minutes: CATCH_UP_MINUTES + 1 }), undefined)).toBe(false);
  });

  test('uses each person’s own timezone', () => {
    const instant = DateTime.fromISO('2026-10-25T22:00Z'); // 09:00 Mon in Sydney, 22:00 Sun in London
    expect(isSurveyDue(SURVEY, nowInZone('Australia/Sydney', instant), undefined)).toBe(true);
    expect(isSurveyDue(SURVEY, nowInZone('Europe/London', instant), undefined)).toBe(false);
  });

  test('ignores surveys with no days or time', () => {
    expect(isSurveyDue({ days: [], time: '09:00' }, at('2026-10-26T09:00'))).toBe(false);
    expect(isSurveyDue({ days: ['mon'] }, at('2026-10-26T09:00'))).toBe(false);
  });
});

describe('minutesSinceSendTime / nowInZone', () => {
  test('counts minutes after the send time', () => {
    expect(minutesSinceSendTime('09:00', at('2026-10-26T09:45'))).toBe(45);
  });

  test('falls back to UTC for a missing or invalid zone', () => {
    const instant = DateTime.fromISO('2026-10-26T09:00Z');
    expect(nowInZone(undefined, instant).zoneName).toBe('UTC');
    expect(nowInZone('Not/AZone', instant).zoneName).toBe('UTC');
  });
});

// ── Conversation ──────────────────────────────────────────────────────────────

describe('enqueueSurvey', () => {
  test('starts immediately when the person is idle', () => {
    const { state, startNow } = enqueueSurvey(undefined, RUN);
    expect(startNow).toBe(true);
    expect(state.active).toEqual({ ...RUN, answers: [] });
  });

  test('queues behind a different active survey', () => {
    const first = enqueueSurvey(undefined, RUN).state;
    const { state, startNow } = enqueueSurvey(first, OTHER);
    expect(startNow).toBe(false);
    expect(state.active.name).toBe('Standup');
    expect(state.queue).toEqual([{ ...OTHER, answers: [] }]);
  });

  test('a new day replaces an unfinished copy of the same survey', () => {
    const stale = { active: { ...RUN, date: '2026-10-23', answers: ['old'] }, queue: [] };
    const { state, startNow } = enqueueSurvey(stale, RUN);
    expect(startNow).toBe(true);
    expect(state.active).toEqual({ ...RUN, answers: [] });
  });

  test('does not mutate the input state', () => {
    const before = { active: null, queue: [] };
    enqueueSurvey(before, RUN);
    expect(before).toEqual({ active: null, queue: [] });
  });
});

describe('recordAnswer', () => {
  const QUESTIONS = ['Q1', 'Q2'];

  test('records an answer and moves to the next question', () => {
    const start = enqueueSurvey(undefined, RUN).state;
    const { state, completed } = recordAnswer(start, QUESTIONS, '  A1  ');
    expect(completed).toBeNull();
    expect(state.active.answers).toEqual(['A1']);
    expect(currentQuestion(state, QUESTIONS)).toEqual({ index: 1, text: 'Q2' });
  });

  test('completes on the last answer and starts the next queued survey', () => {
    let state = enqueueSurvey(undefined, RUN).state;
    state = enqueueSurvey(state, OTHER).state;
    state = recordAnswer(state, QUESTIONS, 'A1').state;

    const result = recordAnswer(state, QUESTIONS, 'A2');
    expect(result.completed).toMatchObject({ ...RUN, answers: ['A1', 'A2'] });
    expect(result.started).toEqual({ ...OTHER, answers: [] });
    expect(result.state.active.name).toBe('Check-in');
  });

  test('does nothing when there is no active survey', () => {
    const result = recordAnswer(undefined, QUESTIONS, 'hello');
    expect(result.completed).toBeNull();
    expect(isIdle(result.state)).toBe(true);
  });
});

describe('removeSurvey', () => {
  test('removing the active survey promotes the queue', () => {
    let state = enqueueSurvey(undefined, RUN).state;
    state = enqueueSurvey(state, OTHER).state;
    const result = removeSurvey(state, RUN);
    expect(result.started).toEqual({ ...OTHER, answers: [] });
    expect(result.state.queue).toEqual([]);
  });

  test('removing a queued survey leaves the active one alone', () => {
    let state = enqueueSurvey(undefined, RUN).state;
    state = enqueueSurvey(state, OTHER).state;
    const result = removeSurvey(state, OTHER);
    expect(result.started).toBeNull();
    expect(result.state.active.name).toBe('Standup');
    expect(result.state.queue).toEqual([]);
  });
});

// ── Blocks ────────────────────────────────────────────────────────────────────

describe('survey blocks', () => {
  test('numbers questions', () => {
    expect(buildQuestionText('Blockers?', 2, 3)).toBe('*3/3* Blockers?');
  });

  test('answer blocks pair each question with its answer', () => {
    const blocks = buildAnswerBlocks({ name: 'Standup', questions: ['Q1', 'Q2'] }, 'U1', ['A1']);
    expect(blocks[0].text.text).toBe('<@U1> posted *Standup*');
    expect(blocks[1].text.text).toBe('*Q1*\nA1');
    expect(blocks[2].text.text).toBe('*Q2*\n_No answer_');
  });

  test('long answers are truncated to fit Slack limits', () => {
    const blocks = buildAnswerBlocks({ name: 'S', questions: ['Q'] }, 'U1', ['x'.repeat(5000)]);
    expect(blocks[1].text.text.length).toBeLessThanOrEqual(2900);
  });

  test('thread parent shows who is still to answer', () => {
    const [, context] = buildThreadParentBlocks('Standup', 'Mon 26 Oct', ['U1', 'U2'], ['U1']);
    expect(context.elements[0].text).toBe('1/2 answered · Waiting on <@U2>');
  });

  test('thread parent celebrates when everyone is in', () => {
    const [, context] = buildThreadParentBlocks('Standup', 'Mon 26 Oct', ['U1'], ['U1']);
    expect(context.elements[0].text).toContain('Everyone');
  });
});
