// ── Pick Notes ────────────────────────────────────────────────────────────────
//
// Optional per-rotation notes shown in every pick message (e.g. what to
// prepare and a Trello link). Notes are edited with Slack's rich text input
// and stored as a rich_text block, so formatting and links post exactly as
// typed.
//
// Stored shape (cfg.pickNotes):
//   { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
//       { type: 'text', text: 'Update the ' },
//       { type: 'link', url: 'https://trello.com/b/…', text: 'retro board' },
//   ] }] }
//
// Older configs stored a plain mrkdwn string; toRichText converts those.

// ── Legacy conversion ─────────────────────────────────────────────────────────

// Matches Slack link syntax <url|label> or <url>, and bare http(s) URLs
const LINK_PATTERN = /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>|(https?:\/\/[^\s<>]+)/g;

/**
 * Converts one line of legacy mrkdwn text into rich text elements, turning
 * links into link elements so they stay clickable.
 *
 * @example
 * lineToElements('See <https://x.io|board>')
 * // → [{ type: 'text', text: 'See ' }, { type: 'link', url: 'https://x.io', text: 'board' }]
 */
function lineToElements(line) {
  const elements = [];
  let lastIndex = 0;

  for (const match of line.matchAll(LINK_PATTERN)) {
    if (match.index > lastIndex) {
      elements.push({ type: 'text', text: line.slice(lastIndex, match.index) });
    }
    const url = match[1] || match[3];
    const label = match[2];
    elements.push(label ? { type: 'link', url, text: label } : { type: 'link', url });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) elements.push({ type: 'text', text: line.slice(lastIndex) });
  return elements;
}

/**
 * Normalises stored notes to a rich_text block. Rich text passes through;
 * legacy strings are converted; empty notes become null.
 */
function toRichText(notes) {
  if (!notes) return null;
  if (typeof notes === 'object' && notes.type === 'rich_text') return notes;
  if (typeof notes !== 'string' || !notes.trim()) return null;

  const text = notes.split('\n').map(lineToElements);
  const elements = text.flatMap((line, i) =>
    i < text.length - 1 ? [...line, { type: 'text', text: '\n' }] : line
  );
  return { type: 'rich_text', elements: [{ type: 'rich_text_section', elements }] };
}

// ── Emptiness ─────────────────────────────────────────────────────────────────

/**
 * True when rich text has no visible content. Slack submits an empty
 * rich_text structure when the field is cleared, so this treats it as none.
 */
function isEmptyRichText(richText) {
  const hasContent = node => {
    if (!node) return false;
    if (node.type === 'text') return node.text.trim().length > 0;
    if (node.type !== undefined && !node.elements) return true; // link, emoji, user…
    return (node.elements || []).some(hasContent);
  };
  return !hasContent(richText);
}

// ── Message blocks ────────────────────────────────────────────────────────────

/**
 * Blocks to append to a pick message: the notes as a rich_text block, or
 * nothing when there are no notes.
 */
function buildPickNotesMessageBlocks(notes) {
  const richText = toRichText(notes);
  if (!richText || isEmptyRichText(richText)) return [];
  // Strip any block_id Slack attached on submit so messages don't clash
  const { block_id: _ignored, ...block } = richText;
  return [block];
}

module.exports = { toRichText, isEmptyRichText, buildPickNotesMessageBlocks };
