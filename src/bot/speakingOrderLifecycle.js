// ── Speaking Order Lifecycle ──────────────────────────────────────────────────
//
// Runs the optional speaking-order steps that sit on top of the pick flow
// for rotations with `speakingOrder: true`:
//   1. Record when the pick posts (the cycle begins)
//   2. Post the randomised speaking-order list on the list day
//   3. Keep that list in sync with ❌ reactions
//
// State is stored in stateStore under channel → "speakingOrder::<name>":
//   {
//     lastPickDate: '2026-10-27',
//     list: { ts: '1730000000.000100', date: '2026-10-28',
//             order: ['U1', 'U2', 'U3'], removed: ['U2'] }
//   }

const { DateTime } = require('luxon');
const { slackApiCall } = require('../utils/slackHelpers');
const { isUserOnLeave } = require('./leaveHelpers');
const {
  OPT_OUT_REACTION,
  hasSpeakingOrder,
  speakingOrderStateKey,
  buildSpeakingOrder,
  applyOptOut,
  isWithinPickWindow,
  buildSpeakingOrderBlocks,
} = require('../utils/speakingOrderHelpers');

// ── State access ──────────────────────────────────────────────────────────────

function getListState(bot, channel, name) {
  return bot.stateStore.getItem(channel, speakingOrderStateKey(name)) || {};
}

function setListState(bot, channel, name, state) {
  bot.stateStore.setItem(channel, speakingOrderStateKey(name), state);
  bot.stateStore.save();
}

// ── Step 1: pick ──────────────────────────────────────────────────────────────

/**
 * Marks today as the start of a cycle. Called by startPick after the pick
 * message posts, so the list step knows which week to run.
 */
function recordSpeakingOrderPick(bot, channel, name, isoDate) {
  const state = getListState(bot, channel, name);
  setListState(bot, channel, name, { ...state, lastPickDate: isoDate });
}

// ── Step 2: speaking-order list ───────────────────────────────────────────────

/**
 * Posts the shuffled speaking order. Skips quietly on off-weeks (no pick in
 * the last few days) unless `force` is set, and never posts twice a day.
 *
 * @param {object}  bot
 * @param {string}  channel
 * @param {string}  name
 * @param {boolean} [force] - Bypass the pick-window check (manual trigger)
 */
async function postSpeakingOrder(bot, channel, name, force = false) {
  const cfg = bot.configStore.getItem(channel, name);
  if (!hasSpeakingOrder(cfg)) return;

  const todayIso = DateTime.now().setZone(cfg.tz).toISODate();
  const state = getListState(bot, channel, name);

  if (!force && !isWithinPickWindow(state.lastPickDate, todayIso)) {
    console.log(`[INFO] Skipping speaking order for '${name}' – no recent pick`);
    return;
  }
  if (state.list?.date === todayIso) {
    console.log(`[INFO] Speaking order for '${name}' already posted today`);
    return;
  }

  // ── Build the order ──
  // People on leave today are left off entirely rather than struck through
  const order = buildSpeakingOrder(
    cfg.members || [],
    userId => isUserOnLeave(bot.leaveStore, channel, userId, todayIso)
  );
  const list = { date: todayIso, order, removed: [] };

  // Join first: chat:write.public lets Dill post without being a member, but
  // Slack only sends reaction events for channels the bot has joined
  try {
    await bot.app.client.conversations.join({ channel });
  } catch (e) {
    console.warn(`[WARN] Could not join channel ${channel}: ${e.data?.error || e.message}`);
  }

  try {
    const result = await slackApiCall(bot.app.client.chat.postMessage, {
      channel,
      text: `${name} speaking order`,
      blocks: buildSpeakingOrderBlocks(name, list),
    });
    setListState(bot, channel, name, { ...state, list: { ...list, ts: result.ts } });
    await bot.createBackup();
  } catch (error) {
    console.error(`[ERROR] Failed to post speaking order for '${name}' in ${channel}:`, error);
  }
}

// ── Step 3: ❌ reactions ──────────────────────────────────────────────────────

/**
 * Finds the rotation (if any) whose current speaking-order message is `ts`.
 * Returns its name, or null for reactions on unrelated messages.
 */
function findRotationByListTs(bot, channel, ts) {
  const channelRotations = bot.configStore.data?.[channel] || {};
  return Object.keys(channelRotations).find(name =>
    hasSpeakingOrder(channelRotations[name])
    && getListState(bot, channel, name).list?.ts === ts
  ) || null;
}

/**
 * Handles reaction_added / reaction_removed. Removes (or restores) the
 * reacting user and edits the list message so the numbering closes up.
 *
 * @param {object}  bot
 * @param {object}  event  - Slack reaction event
 * @param {boolean} optOut - true when the reaction was added
 */
async function handleSpeakingOrderReaction(bot, event, optOut) {
  // Slack sends skin-tone variants as "x::skin-tone-2"; ❌ has none, but be safe
  const reaction = (event.reaction || '').split('::')[0];
  if (reaction !== OPT_OUT_REACTION || event.item?.type !== 'message') return;

  const channel = event.item.channel;
  const name = findRotationByListTs(bot, channel, event.item.ts);
  if (!name) return;

  const state = getListState(bot, channel, name);
  const nextList = applyOptOut(state.list, event.user, optOut);
  if (!nextList) return;

  setListState(bot, channel, name, { ...state, list: nextList });

  try {
    await slackApiCall(bot.app.client.chat.update, {
      channel,
      ts: nextList.ts,
      text: `${name} speaking order`,
      blocks: buildSpeakingOrderBlocks(name, nextList),
    });
  } catch (error) {
    console.error(`[ERROR] Failed to update speaking order for '${name}':`, error);
  }
  await bot.createBackup();
}

module.exports = { recordSpeakingOrderPick, postSpeakingOrder, handleSpeakingOrderReaction };
