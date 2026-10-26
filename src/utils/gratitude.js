// ── Gratitude ─────────────────────────────────────────────────────────────────
//
// Spots short "thanks" / "good bot" messages so Dill can ❤️ them instead of
// replying. Pure, so the phrase list can be unit-tested.

// Slack reaction name (no colons)
const LOVE_REACTION = 'heart';

// Longer messages are probably real questions that happen to say thanks
const MAX_WORDS = 6;

// Matched as whole words against the cleaned-up message
const PHRASES = [
  /\bthank(s| you| u)\b/,
  /\b(thx|thnx|ty|tysm|ta|cheers)\b/,
  /\b(good|great|nice|best|clever|lovely|cute) (bot|dill|dillbot|pickle)\b/,
  /\b(love|luv) (you|u|ya|dill|dillbot)\b/,
  /\bappreciate (it|you|u)\b/,
];

/**
 * @param {string} text - Raw DM text
 * @returns {boolean}
 *
 * @example
 * isGratitude('Thanks Dill! :pray:') // → true
 * isGratitude('good bot')            // → true
 * isGratitude('Thanks, but how do I change the time of my survey?') // → false (too long)
 */
function isGratitude(text) {
  // ':pray:' / '<@U123>' / punctuation → spaces, so only words remain
  const cleaned = (text || '')
    .toLowerCase()
    .replace(/<[^>]*>|:[a-z0-9_+-]+:/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.split(' ').length > MAX_WORDS) return false;
  return PHRASES.some(pattern => pattern.test(cleaned));
}

module.exports = { LOVE_REACTION, isGratitude };
