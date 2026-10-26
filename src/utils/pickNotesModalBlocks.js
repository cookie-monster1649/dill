// ── Pick Notes Modal Blocks ───────────────────────────────────────────────────
//
// Block Kit fragments for editing pick notes in the rotation edit modal: a
// rich text editor (links, bold, lists…) plus a preview of the pick message
// as it will appear in the channel.

const { toRichText, isEmptyRichText, buildPickNotesMessageBlocks } = require('./pickNotes');

// ── Editor ────────────────────────────────────────────────────────────────────

function buildEditorBlock(existingConfig) {
  const initial = toRichText(existingConfig?.pickNotes);
  return {
    type: 'input',
    block_id: 'pick_notes',
    optional: true,
    label: { type: 'plain_text', text: 'Pick message notes' },
    hint: { type: 'plain_text', text: 'Shown in every pick message. Use the toolbar or ⌘K / Ctrl+K to add links.' },
    element: {
      type: 'rich_text_input',
      action_id: 'pick_notes_input',
      ...(initial && !isEmptyRichText(initial) && { initial_value: initial }),
    },
  };
}

// ── Preview ───────────────────────────────────────────────────────────────────

/**
 * A mock-up of the pick message using the saved notes. Only shown for saved
 * rotations that have notes; it reflects the last save, not unsaved edits,
 * because Slack doesn't send rich text changes until the form is submitted.
 *
 * Example rendering:
 *   Preview – how the pick message will look
 *   *Retro*: It's your turn, @Alex!
 *   Update the actions list and review the retro board
 */
function buildPreviewBlocks(existingConfig, preName) {
  const notesBlocks = buildPickNotesMessageBlocks(existingConfig?.pickNotes);
  if (!preName || notesBlocks.length === 0) return [];

  const sampleUser = existingConfig.members?.[0];
  const who = sampleUser ? `<@${sampleUser}>` : 'someone';

  return [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Preview* – how the pick message will look (updates when you save)' }],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*${preName}*: It's your turn, ${who}!` } },
    ...notesBlocks,
  ];
}

/**
 * Editor plus preview, ready to spread into the edit modal's blocks.
 */
function buildPickNotesInputBlocks(existingConfig, preName) {
  return [buildEditorBlock(existingConfig), ...buildPreviewBlocks(existingConfig, preName)];
}

// ── Submission parsing ────────────────────────────────────────────────────────

/**
 * Reads the notes from a modal submission. Empty editors become null so
 * configs don't carry an empty rich text structure.
 *
 * @example
 * readPickNotes(view.state.values)
 * // → { type: 'rich_text', elements: [...] }  or  null
 */
function readPickNotes(values) {
  const richText = values.pick_notes?.pick_notes_input?.rich_text_value;
  return richText && !isEmptyRichText(richText) ? richText : null;
}

module.exports = { buildPickNotesInputBlocks, readPickNotes };
