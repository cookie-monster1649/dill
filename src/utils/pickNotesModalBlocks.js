// ── Pick Notes Modal Blocks ───────────────────────────────────────────────────
//
// Block Kit fragments for editing pick notes in the rotation edit modal: a
// rich text editor (links, bold, lists…) plus a button that previews the
// pick message as it will appear in the channel.

const { toRichText, isEmptyRichText } = require('./pickNotes');

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

// ── Preview button ────────────────────────────────────────────────────────────

// Opens the pick-message preview on top of the form (see pickNotesHandlers).
// Block actions from a modal carry its current, unsaved input values, so the
// preview shows exactly what has been typed.
const PREVIEW_BUTTON_BLOCK = {
  type: 'actions',
  elements: [{
    type: 'button',
    action_id: 'pick_notes_preview',
    text: { type: 'plain_text', text: 'Preview pick message' },
  }],
};

/**
 * Editor plus preview button, ready to spread into the edit modal's blocks.
 */
function buildPickNotesInputBlocks(existingConfig) {
  return [buildEditorBlock(existingConfig), PREVIEW_BUTTON_BLOCK];
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
