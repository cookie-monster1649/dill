// ── Survey Posting ────────────────────────────────────────────────────────────
//
// Posts one person's completed answers to the survey's shared channel, in
// whichever mode the survey uses:
//   thread     → one parent message per day, answers as replies; the parent
//                is edited to show who has answered
//   individual → each person's answers as their own top-level message

const { DateTime } = require('luxon');
const { slackApiCall } = require('../utils/slackHelpers');
const { POST_MODES, buildAnswerBlocks, buildThreadParentBlocks } = require('../utils/surveyBlocks');
const { surveyKey } = require('./surveyLifecycle');

// Thread parents older than this are forgotten to keep state small
const THREAD_RETENTION_DAYS = 7;

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

// Drops thread records older than the retention window
function pruneThreads(threads, todayIso) {
  const cutoff = DateTime.fromISO(todayIso).minus({ days: THREAD_RETENTION_DAYS }).toISODate();
  return Object.fromEntries(Object.entries(threads).filter(([date]) => date >= cutoff));
}

// ── Individual mode ───────────────────────────────────────────────────────────

async function postIndividual(bot, survey, completed, userId) {
  await slackApiCall(bot.app.client.chat.postMessage, {
    channel: completed.channel,
    text: `${survey.name} answers from <@${userId}>`,
    blocks: buildAnswerBlocks(survey, userId, completed.answers),
  });
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
  await slackApiCall(bot.app.client.chat.postMessage, {
    channel,
    thread_ts: ts,
    text: `${name} answers from <@${userId}>`,
    blocks: buildAnswerBlocks(survey, userId, completed.answers),
  });

  if (thread.ts) {
    await slackApiCall(bot.app.client.chat.update, { channel, ts, text: parentText, blocks: parentBlocks });
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param {object} bot
 * @param {object} survey    - Survey config
 * @param {object} completed - { channel, name, date, answers: [...] }
 * @param {string} userId
 */
async function postCompletedSurvey(bot, survey, completed, userId) {
  await joinChannel(bot, completed.channel);

  if (survey.postMode === POST_MODES.INDIVIDUAL) {
    await postIndividual(bot, survey, completed, userId);
  } else {
    await postInThread(bot, survey, completed, userId);
  }
}

module.exports = { postCompletedSurvey, formatDateLabel, pruneThreads };
