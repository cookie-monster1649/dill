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

// ── Starting a survey ─────────────────────────────────────────────────────────

/**
 * Adds a newly due survey for a person.
 *
 * If the person is still mid-way through *yesterday's* copy of the same
 * survey, the new day replaces it – stale answers are dropped, as Geekbot
 * does. Otherwise it starts now or waits behind the active survey.
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
  const current = normaliseState(state);
  const queue = current.queue.filter(q => !isSameSurvey(q, run));
  const fresh = { channel: run.channel, name: run.name, date: run.date, answers: [] };

  if (!current.active || isSameSurvey(current.active, run)) {
    return { state: { active: fresh, queue }, startNow: true };
  }
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
  isIdle,
};
