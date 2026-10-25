// ── Speaking Order Helpers ────────────────────────────────────────────────────
//
// Pure logic for the optional speaking-order list: building the randomised
// order, applying ❌ opt-outs and rendering the numbered list. No Slack or
// store I/O lives here so it can be unit-tested directly.
//
// Any rotation can enable it with `speakingOrder: true` (e.g. a fortnightly
// retro picks a facilitator on Tue and posts the speaking order on Wed).

// ── Constants ─────────────────────────────────────────────────────────────────

// Slack reaction name (no colons) that removes someone from the list
const OPT_OUT_REACTION = 'x';

// Prefix keeps speaking-order state from colliding with other stateStore keys
const STATE_PREFIX = 'speakingOrder::';

// The list only posts if a pick happened within this window, which ties the
// list to the same cycle as the pick for any rotation frequency
const PICK_LOOKBACK_DAYS = 6;

// ── Config checks ─────────────────────────────────────────────────────────────

function hasSpeakingOrder(cfg) {
  return cfg?.speakingOrder === true;
}

function speakingOrderStateKey(name) {
  return `${STATE_PREFIX}${name}`;
}

// ── Speaking order ────────────────────────────────────────────────────────────

/**
 * Returns a Fisher–Yates shuffled copy of the given members, leaving out
 * anyone the `isOnLeave` predicate flags.
 *
 * @param {string[]} members
 * @param {(userId: string) => boolean} isOnLeave
 * @param {() => number} [random] - Injectable for deterministic tests
 * @returns {string[]}
 *
 * @example
 * buildSpeakingOrder(['U1', 'U2', 'U3'], u => u === 'U2')
 * // → ['U3', 'U1']
 */
function buildSpeakingOrder(members, isOnLeave, random = Math.random) {
  const available = members.filter(m => !isOnLeave(m));

  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Returns the speaking order with opted-out people removed. Numbering closes
 * up because the caller renders from this filtered array.
 *
 * @example
 * visibleOrder({ order: ['U1', 'U2', 'U3'], removed: ['U2'] })
 * // → ['U1', 'U3']
 */
function visibleOrder(list) {
  const removed = new Set(list.removed || []);
  return list.order.filter(u => !removed.has(u));
}

// ── Opt-out updates ───────────────────────────────────────────────────────────

/**
 * Applies a ❌ reaction add/remove to the list. Only people in the original
 * order can opt out, and only themselves – a reaction always refers to the
 * reacting user. Returns null when nothing changed so callers can skip the
 * Slack update.
 *
 * @param {{ order: string[], removed: string[] }} list
 * @param {string}  userId
 * @param {boolean} optOut - true for reaction_added, false for reaction_removed
 * @returns {object|null} New list, or null if unchanged
 *
 * @example
 * applyOptOut({ order: ['U1', 'U2'], removed: [] }, 'U2', true)
 * // → { order: ['U1', 'U2'], removed: ['U2'] }
 */
function applyOptOut(list, userId, optOut) {
  if (!list.order.includes(userId)) return null;

  const removed = list.removed || [];
  const isRemoved = removed.includes(userId);
  if (optOut === isRemoved) return null;

  const nextRemoved = optOut
    ? [...removed, userId]
    : removed.filter(u => u !== userId);
  return { ...list, removed: nextRemoved };
}

// ── Pick-window check ─────────────────────────────────────────────────────────

/**
 * True when the last pick is recent enough that today is still in the same
 * cycle. Both dates are ISO strings in the rotation's timezone.
 *
 * @example
 * isWithinPickWindow('2026-10-27', '2026-10-28') // → true
 * isWithinPickWindow('2026-10-13', '2026-10-28') // → false
 */
function isWithinPickWindow(lastPickIso, todayIso) {
  if (!lastPickIso) return false;
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = (Date.parse(todayIso) - Date.parse(lastPickIso)) / msPerDay;
  return days >= 0 && days <= PICK_LOOKBACK_DAYS;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Builds the Slack blocks for the speaking-order message.
 *
 * @example
 * buildSpeakingOrderBlocks('Retro', { order: ['U1', 'U2'], removed: ['U1'] })
 * // section text → "*Retro* speaking order\n1. <@U2>"
 */
function buildSpeakingOrderBlocks(name, list) {
  const people = visibleOrder(list);
  const lines = people.length > 0
    ? people.map((u, i) => `${i + 1}. <@${u}>`).join('\n')
    : '_Nobody left on the list._';

  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${name}* speaking order\n${lines}` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `React with :${OPT_OUT_REACTION}: if you can't make it and you'll be taken off the list. Remove the reaction to rejoin.` }],
    },
  ];
}

module.exports = {
  OPT_OUT_REACTION,
  hasSpeakingOrder,
  speakingOrderStateKey,
  buildSpeakingOrder,
  visibleOrder,
  applyOptOut,
  isWithinPickWindow,
  buildSpeakingOrderBlocks,
};
