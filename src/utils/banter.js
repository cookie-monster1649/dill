// ── Banter ────────────────────────────────────────────────────────────────────
//
// Spots short messages *about* Dill – thanks, praise, mild insults and
// outright rudeness – so Dill can respond in kind instead of replying with
// "you don't have a survey". Pure, so the phrase lists can be unit-tested.

// ── Responses ─────────────────────────────────────────────────────────────────

const BANTER = Object.freeze({
  LOVE: 'love', // "thanks", "good bot"  → ❤️ reaction
  SAD: 'sad',   // "bad bot", "dumb dill" → 😢 reaction
  RUDE: 'rude', // swearing at Dill      → "Is this Alex?"
});

// Slack reaction names (no colons)
const REACTIONS = Object.freeze({ [BANTER.LOVE]: 'heart', [BANTER.SAD]: 'cry' });

const RUDE_REPLY = 'Is this Alex?';

// Longer messages are probably real questions that happen to contain these
const MAX_WORDS = 8;

// ── Phrases ───────────────────────────────────────────────────────────────────
// Matched as whole words against the cleaned-up message

const BOT = '(bot|dill|dillbot|pickle|robot)';

const RUDE_PHRASES = [
  /\b(fuck|fucking|fucker|fck|fk|fuk|shit|shite|bullshit|bastard|wanker|dickhead|prick|twat|cunt|arsehole|asshole)\b/,
  /\b(stfu|gtfo|wtf)\b/,
  // 'f*** off' cleans down to 'f off'
  /\b(piss|bugger|sod|f|eff) off\b/,
  /\b(screw|damn) (you|u|this)\b/,
  /\bshut up\b/,
  /\b(i )?hate (you|u|this bot|dill)\b/,
  /\byou suck\b/,
  new RegExp(`\\b(piece of (crap|junk|garbage)|garbage ${BOT}|trash ${BOT})\\b`),
];

const SAD_PHRASES = [
  new RegExp(`\\b(bad|stupid|dumb|useless|silly|naughty|terrible|lazy|broken|annoying|rubbish|worst) ${BOT}\\b`),
  /\b(boo|ugh)\b/,
];

const LOVE_PHRASES = [
  /\bthank(s| you| u)\b/,
  /\b(thx|thnx|ty|tysm|ta|cheers)\b/,
  new RegExp(`\\b(good|great|nice|best|clever|smart|lovely|cute|helpful|awesome|amazing) ${BOT}\\b`),
  /\b(love|luv) (you|u|ya|dill|dillbot)\b/,
  /\bappreciate (it|you|u)\b/,
  /\bgood (boy|girl|job|work)\b/,
];

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Works out whether a DM is banter aimed at Dill, and which kind. Rudeness
 * wins over everything ("good bot, now shut up" is rude), then insults,
 * then praise.
 *
 * @param {string} text - Raw DM text
 * @returns {'love'|'sad'|'rude'|null}
 *
 * @example
 * classifyBanter('Thanks Dill! :pray:') // → 'love'
 * classifyBanter('bad bot')             // → 'sad'
 * classifyBanter('shut up dill')        // → 'rude'
 * classifyBanter('Thanks, but how do I change the time of my survey please?') // → null (too long)
 */
function classifyBanter(text) {
  // ':pray:' / '<@U123>' / punctuation → spaces, so only words remain
  const cleaned = (text || '')
    .toLowerCase()
    .replace(/<[^>]*>|:[a-z0-9_+-]+:/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.split(' ').length > MAX_WORDS) return null;

  const matches = patterns => patterns.some(pattern => pattern.test(cleaned));
  if (matches(RUDE_PHRASES)) return BANTER.RUDE;
  if (matches(SAD_PHRASES)) return BANTER.SAD;
  if (matches(LOVE_PHRASES)) return BANTER.LOVE;
  return null;
}

module.exports = { BANTER, REACTIONS, RUDE_REPLY, classifyBanter };
