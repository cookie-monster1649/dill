// ── Rotation Name Normalisation ──────────────────────────────────────────────
//
// Slack rotation names can contain emoji and vary in case. To avoid mismatches
// when comparing user-typed names against stored keys, we strip emoji and
// normalise to lowercase before any comparison.
//
// Example:
//   normalizeRotationName('🥒 On-Call')  →  'on-call'
//   normalizeRotationName('On-Call ')    →  'on-call'

function normalizeRotationName(name) {
  return (name || '')
    .replace(/[\p{Emoji_Presentation}\p{Emoji}\u200d]+/gu, '')
    .toLowerCase()
    .trim();
}

module.exports = { normalizeRotationName };
