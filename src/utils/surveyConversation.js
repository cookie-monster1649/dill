// ── Survey Conversation ───────────────────────────────────────────────────────
//
// Pure state machine for the Geekbot-style DM conversation: Dill asks one
// question at a time and each DM reply becomes the answer to the current
// question. A person can only be mid-way through one survey at a time; any
// others due at the same time wait in a queue.
//
// State lives per person (keyed by Slack user ID) and looks like:
//   {
//     active: { channel: 'C1', name: 'Daily standup', date: '2026-10-26',
//               answers: ['Shipped the login page'] },
//     queue:  [{ channel: 'C2', name: 'Team check-in', date: '2026-10-26' }]
//   }
//
// Every function returns a new state object and never mutates its input.

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_STATE = Object.freeze({ active: null, queue: [] });

function normaliseState(state) {
  return { active: state?.active || null, queue: state?.queue || [] };
}

// Same survey = same channel and name, whatever the date
function isSameSurvey(a, b) {
  return !!a && !!b && a.channel === b.channel && a.name === b.name;
}

/**
 * Drops any survey from an earlier day than `today`. An ignored survey must
 * not block every other survey forever, and answers to it would land under
 * a stale day anyway.
 *
 * @example
 * expireStaleRuns({ active: { name: 'A', date: '2026-10-23', answers: [] }, queue: [{ name: 'B', date: '2026-10-26' }] }, '2026-10-26')
 * // → { active: { name: 'B', date: '2026-10-26' }, queue: [] }
 */
function expireStaleRuns(state, today) {
  const isCurrent = run => run.date >= today;
  const remaining = [state.active, ...state.queue].filter(run => run && isCurrent(run));
  const [active = null, ...queue] = remaining;
  return { active, queue };
}

// ── Starting a survey ─────────────────────────────────────────────────────────

/**
 * Adds a newly due survey for a person.
 *
 * Anything left over from an earlier day is dropped first – stale answers
 * are discarded, as Geekbot does. The new survey then starts now or waits
 * behind a survey from the same day.
 *
 * @param {object} state - Person's conversation state (may be undefined)
 * @param {object} run   - { channel, name, date }
 * @returns {{ state: object, startNow: boolean }}
 *
 * @example
 * enqueueSurvey(undefined, { channel: 'C1', name: 'Standup', date: '2026-10-26' })
 * // → { state: { active: { ...run, answers: [] }, queue: [] }, startNow: true }
 */
function enqueueSurvey(state, run) {
  const current = expireStaleRuns(normaliseState(state), run.date);
  const queue = current.queue.filter(q => !isSameSurvey(q, run));
  const fresh = { channel: run.channel, name: run.name, date: run.date, answers: [] };

  if (!current.active || isSameSurvey(current.active, run)) {
    return { state: { active: fresh, queue }, startNow: true };
  }
  // A same-day survey already in progress keeps its place
  return { state: { active: current.active, queue: [...queue, fresh] }, startNow: false };
}

// ── Answering ─────────────────────────────────────────────────────────────────

/**
 * Returns the question the person should answer next, or null if there is
 * no active survey.
 *
 * @param {object}   state
 * @param {string[]} questions - The active survey's questions
 * @returns {{ index: number, text: string } | null}
 */
function currentQuestion(state, questions) {
  const active = normaliseState(state).active;
  if (!active) return null;
  const index = active.answers.length;
  return index < questions.length ? { index, text: questions[index] } : null;
}

/**
 * Records a DM reply as the answer to the current question.
 *
 * When that was the last question, the finished survey is returned as
 * `completed` and the next queued survey (if any) becomes active and is
 * returned as `started`, so the caller can post its first question.
 *
 * @param {object}   state
 * @param {string[]} questions - The active survey's questions
 * @param {string}   text      - The person's reply
 * @returns {{ state: object, completed: object|null, started: object|null }}
 *
 * @example
 * recordAnswer({ active: { ...run, answers: ['A1'] }, queue: [] }, ['Q1', 'Q2'], 'A2')
 * // → { state: { active: null, queue: [] },
 * //     completed: { ...run, answers: ['A1', 'A2'] }, started: null }
 */
function recordAnswer(state, questions, text) {
  const current = normaliseState(state);
  if (!current.active) return { state: current, completed: null, started: null };

  const answers = [...current.active.answers, text.trim()];
  const active = { ...current.active, answers };

  if (answers.length < questions.length) {
    return { state: { active, queue: current.queue }, completed: null, started: null };
  }

  // Finished – promote the next queued survey, if any
  const [next = null, ...rest] = current.queue;
  return { state: { active: next, queue: rest }, completed: active, started: next };
}

/**
 * Drops a survey from a person's state, e.g. when it is deleted or the
 * person is removed from its member list.
 *
 * @param {object} state
 * @param {{ channel: string, name: string }} survey
 * @returns {{ state: object, started: object|null }}
 */
function removeSurvey(state, survey) {
  const current = normaliseState(state);
  const queue = current.queue.filter(q => !isSameSurvey(q, survey));

  if (!isSameSurvey(current.active, survey)) {
    return { state: { active: current.active, queue }, started: null };
  }
  const [next = null, ...rest] = queue;
  return { state: { active: next, queue: rest }, started: next };
}

/**
 * Points a person's in-progress and queued surveys at a renamed survey, so
 * a rename doesn't strand them mid-conversation.
 */
function renameSurveyInState(state, channel, oldName, newName) {
  const current = normaliseState(state);
  const rename = run => (run && run.channel === channel && run.name === oldName ? { ...run, name: newName } : run);
  return { active: rename(current.active), queue: current.queue.map(rename) };
}

function isIdle(state) {
  const current = normaliseState(state);
  return !current.active && current.queue.length === 0;
}

module.exports = {
  EMPTY_STATE,
  enqueueSurvey,
  currentQuestion,
  recordAnswer,
  removeSurvey,
  renameSurveyInState,
  expireStaleRuns,
  isIdle,
};
