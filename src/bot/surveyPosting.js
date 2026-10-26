// ── Survey Posting ────────────────────────────────────────────────────────────
//
// Posts one person's completed answers to the survey's shared channel, in
// whichever mode the survey uses:
//   thread     → one parent message per day, answers as replies; the parent
//                is edited to show who has answered
//   individual → each person's answers as their own top-level message
//
// Answer messages are posted with the person's name and avatar (needs the
// chat:write.customize scope) and recorded so they can be edited later:
//   posts → "C1::Daily standup" → { U1: { date: '2026-10-26', ts: '1730…', answers: [...],
//                                          dmChannel: 'D1', dmTs: '1730…' } }

const { DateTime } = require('luxon');
const { slackApiCall } = require('../utils/slackHelpers');
const { POST_MODES, buildAnswerMessage, buildThreadParentBlocks, buildDoneBlocks, buildDoneText } = require('../utils/surveyBlocks');
const { surveyKey, getUserProfile } = require('./surveyLifecycle');
const { indexAnswerPost } = require('../handlers/surveyReplyHandlers');

// Thread parents older than this are forgotten to keep state small
const THREAD_RETENTION_DAYS = 7;

// ── Per-survey lock ───────────────────────────────────────────────────────────
//
// Posting reads state, awaits Slack, then writes state. Two people finishing
// at the same moment would both see "no parent yet" and post two threads, so
// posts for one survey run one at a time.

const locks = new Map(); // "C1::Daily standup" → promise of the last queued post

function withSurveyLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(key, run);
  // Forget the chain once idle so the map doesn't grow forever
  run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => {});
  return run;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// '2026-10-26' → 'Mon 26 Oct'
function formatDateLabel(isoDate) {
  return DateTime.fromISO(isoDate).toFormat('ccc d LLL');
}

// Private channels need membership; public ones are covered by
// chat:write.public, so a failed join is only a warning
async function joinChannel(bot, channel) {
  try {
    await bot.app.client.conversations.join({ channel });
  } catch (e) {
    console.warn(`[WARN] Could not join channel ${channel}: ${e.data?.error || e.message}`);
  }
}

// Drops records older than the retention window. `dateOf` reads each
// record's ISO date (thread records are keyed by date, posts hold one).
function pruneByDate(records, todayIso, dateOf) {
  const cutoff = DateTime.fromISO(todayIso).minus({ days: THREAD_RETENTION_DAYS }).toISODate();
  return Object.fromEntries(Object.entries(records).filter(([key, value]) => dateOf(value, key) >= cutoff));
}

function pruneThreads(threads, todayIso) {
  return pruneByDate(threads, todayIso, (_, date) => date);
}

// Shows the answers as posted by the person rather than by Dill. Falls back
// to Dill's own identity if the profile lookup failed.
//
// @example
// await authorFields(bot, 'U1') // → { username: 'JJ Monester', icon_url: 'https://…_72.png' }
async function authorFields(bot, userId) {
  const { name, avatar } = (await getUserProfile(bot, userId)) || {};
  return name ? { username: name, ...(avatar ? { icon_url: avatar } : {}) } : {};
}

// The answer message, introduced with the person's name like Geekbot
async function answerMessage(bot, survey, userId, answers, extra = '') {
  const { realName } = (await getUserProfile(bot, userId)) || {};
  return buildAnswerMessage(survey, { userId, name: realName }, answers, extra);
}

// ── Individual mode ───────────────────────────────────────────────────────────

async function postIndividual(bot, survey, completed, userId) {
  const result = await slackApiCall(bot.app.client.chat.postMessage, {
    channel: completed.channel,
    ...(await answerMessage(bot, survey, userId, completed.answers)),
    ...(await authorFields(bot, userId)),
  });
  // So replies in this post's thread can summon the person
  indexAnswerPost(bot, completed.channel, result.ts, userId, completed.date);
  return result.ts;
}

// ── Thread mode ───────────────────────────────────────────────────────────────

/**
 * Posts the answers as a reply under the day's parent message, creating the
 * parent on the first answer of the day, then refreshes the parent's
 * "who's answered" line.
 */
async function postInThread(bot, survey, completed, userId) {
  const { channel, name, date } = completed;
  const key = surveyKey(channel, name);
  const threads = pruneThreads(bot.surveyStateStore.getItem('threads', key) || {}, date);
  const thread = threads[date] || { ts: null, completed: [] };
  const done = [...new Set([...thread.completed, userId])];
  const parentBlocks = buildThreadParentBlocks(name, formatDateLabel(date), survey.members, done);
  const parentText = `${name} – ${formatDateLabel(date)}`;

  // ── Parent message ──
  let ts = thread.ts;
  if (!ts) {
    const parent = await slackApiCall(bot.app.client.chat.postMessage, { channel, text: parentText, blocks: parentBlocks });
    ts = parent.ts;
  }

  // Save before the reply so a second finisher reuses this parent
  threads[date] = { ts, completed: done };
  bot.surveyStateStore.setItem('threads', key, threads);
  bot.surveyStateStore.save();

  // ── Reply + parent refresh ──
  const reply = await slackApiCall(bot.app.client.chat.postMessage, {
    channel,
    thread_ts: ts,
    ...(await answerMessage(bot, survey, userId, completed.answers)),
    ...(await authorFields(bot, userId)),
  });

  if (thread.ts) {
    await slackApiCall(bot.app.client.chat.update, { channel, ts, text: parentText, blocks: parentBlocks });
  }
  return reply.ts;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param {object} bot
 * @param {object} survey    - Survey config
 * @param {object} completed - { channel, name, date, answers: [...] }
 * @param {string} userId
 */
async function postCompletedSurvey(bot, survey, completed, userId) {
  return withSurveyLock(surveyKey(completed.channel, completed.name), () => postLocked(bot, survey, completed, userId));
}

async function postLocked(bot, survey, completed, userId) {
  await joinChannel(bot, completed.channel);

  const ts = survey.postMode === POST_MODES.INDIVIDUAL
    ? await postIndividual(bot, survey, completed, userId)
    : await postInThread(bot, survey, completed, userId);

  // Only the latest post per person is kept – that's the one they can edit.
  // Posts older than the thread window are dropped to keep backups small.
  const key = surveyKey(completed.channel, completed.name);
  const posts = pruneByDate(bot.surveyStateStore.getItem('posts', key) || {}, completed.date, post => post.date);
  posts[userId] = { date: completed.date, ts, answers: completed.answers, answerTs: completed.answerTs || [] };
  bot.surveyStateStore.setItem('posts', key, posts);
  bot.surveyStateStore.save();
}

// ── Editing ───────────────────────────────────────────────────────────────────

/**
 * Returns a person's latest posted answers for a survey, or null.
 *
 * @example
 * getLatestPost(bot, 'C1', 'Daily standup', 'U1')
 * // → { date: '2026-10-26', ts: '1730000000.000200', answers: ['Shipped it', 'None'] }
 */
function getLatestPost(bot, channel, name, userId) {
  return (bot.surveyStateStore.getItem('posts', surveyKey(channel, name)) || {})[userId] || null;
}

/**
 * Finds which posted answer a DM message produced, across every survey the
 * person has a latest post in.
 *
 * @example
 * findPostByAnswerTs(bot, 'U1', '1730000000.000300')
 * // → { channel: 'C1', name: 'Daily standup', index: 1, post: { ts, answers, answerTs, ... } }
 */
function findPostByAnswerTs(bot, userId, messageTs) {
  const allPosts = bot.surveyStateStore.get('posts');
  for (const [key, people] of Object.entries(allPosts)) {
    const post = people?.[userId];
    const index = (post?.answerTs || []).indexOf(messageTs);
    if (index === -1) continue;
    const [channel, name] = key.split('::');
    return { channel, name, index, post };
  }
  return null;
}

// Saves where the "done" DM summary is so an edit can refresh it
function recordDoneMessage(bot, channel, name, userId, dmChannel, dmTs) {
  const key = surveyKey(channel, name);
  const posts = bot.surveyStateStore.getItem('posts', key) || {};
  if (!posts[userId]) return;
  posts[userId] = { ...posts[userId], dmChannel, dmTs };
  bot.surveyStateStore.setItem('posts', key, posts);
  bot.surveyStateStore.save();
}

/**
 * Changes a person's existing channel post – their answers and/or their
 * "Anything else?" note – then refreshes the summary in their DM. The post keeps
 * its original author name and avatar – chat.update can't change those.
 */
async function updatePostedAnswers(bot, survey, channel, userId, patch) {
  return withSurveyLock(surveyKey(channel, survey.name), () => updateLocked(bot, survey, channel, userId, patch));
}

/**
 * Applies `patch` – { answers?, extra? } or a function of the current post
 * returning one – then redraws the channel post and the DM summary.
 * A function lets "Say something else" append to the note inside the lock,
 * so two quick additions can't overwrite each other.
 */
async function updateLocked(bot, survey, channel, userId, patch) {
  const post = getLatestPost(bot, channel, survey.name, userId);
  if (!post) throw new Error('No posted answers to edit');

  const changes = typeof patch === 'function' ? patch(post) : patch;
  const answers = changes.answers ?? post.answers;
  const extra = changes.extra ?? post.extra ?? '';

  await slackApiCall(bot.app.client.chat.update, {
    channel,
    ts: post.ts,
    ...(await answerMessage(bot, survey, userId, answers, extra)),
  });

  const key = surveyKey(channel, survey.name);
  const posts = bot.surveyStateStore.getItem('posts', key) || {};
  posts[userId] = { ...post, answers, extra };
  bot.surveyStateStore.setItem('posts', key, posts);
  bot.surveyStateStore.save();

  // Older posts pre-date the DM summary, so there may be nothing to refresh
  if (post.dmChannel && post.dmTs) {
    await slackApiCall(bot.app.client.chat.update, {
      channel: post.dmChannel,
      ts: post.dmTs,
      text: buildDoneText(survey.name, channel),
      blocks: buildDoneBlocks(survey, channel, post.date, answers, { edited: true, extra }),
    });
  }
}

module.exports = { postCompletedSurvey, recordDoneMessage, findPostByAnswerTs, getLatestPost, updatePostedAnswers, formatDateLabel, pruneThreads };
