// ── Action Handlers – Facade ───────────────────────────────────────────────────
//
// This module is the single import point used by app.js when registering Bolt
// action and view callbacks. It composes two focused handler classes:
//
//   PickActionHandlers      →  src/handlers/pickActionHandlers.js
//     accept, skip, future_skip
//
//   RotationCrudHandlers    →  src/handlers/rotationCrudHandlers.js
//     create, edit, delete, settings form open/submit, delete confirm
//
// Adding a new handler: implement it in the appropriate focused class and add a
// one-line delegation here.

const PickActionHandlers    = require('./pickActionHandlers');
const RotationCrudHandlers  = require('./rotationCrudHandlers');

class ActionHandlers {
  /**
   * @param {import('../app')} bot - The main DillBot instance
   */
  constructor(bot) {
    this.bot  = bot;
    this._pick = new PickActionHandlers(bot);
    this._crud = new RotationCrudHandlers(bot);
  }

  // ── Pick actions ─────────────────────────────────────────────────────────────
  handleAcceptAction(p)     { return this._pick.handleAcceptAction(p); }
  handleSkipAction(p)       { return this._pick.handleSkipAction(p); }
  handleFutureSkipAction(p) { return this._pick.handleFutureSkipAction(p); }

  // ── Rotation CRUD actions ────────────────────────────────────────────────────
  handleCreateNewAction(p)                { return this._crud.handleCreateNewAction(p); }
  handleEditRotationAction(p)             { return this._crud.handleEditRotationAction(p); }
  handleDeleteStartAction(p)              { return this._crud.handleDeleteStartAction(p); }
  handleRotationSettingsAction(p)         { return this._crud.handleRotationSettingsAction(p); }

  // ── View submissions ─────────────────────────────────────────────────────────
  handleViewSubmission(p)                 { return this._crud.handleViewSubmission(p); }
  handleRotationFormSubmission(p)         { return this._crud.handleRotationFormSubmission(p); }
  handleRotationSettingsSubmission(p)     { return this._crud.handleRotationSettingsSubmission(p); }
  handleDeleteConfirmation(p)             { return this._crud.handleDeleteConfirmation(p); }
}

module.exports = ActionHandlers;
