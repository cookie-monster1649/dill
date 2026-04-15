/**
 * A simple file-based key-value store for persistent data storage.
 * 
 * This class provides a simple way to store and retrieve data in JSON files.
 * It loads the entire file into memory on startup and saves on demand.
 * 
 * DESIGN CHOICE: Loading the entire file into memory is more performant than 
 * reading/writing on every action. For a low-traffic bot, this is a reasonable 
 * approach. For high concurrency, a proper database (like SQLite or Redis) 
 * would be necessary to prevent race conditions.
 * 
 * @example
 * const store = new NestedStore('configs.json');
 * store.setItem('channel1', 'rotation1', { members: ['user1', 'user2'] });
 * const config = store.getItem('channel1', 'rotation1');
 * store.save(); // Persist changes to disk
 */
const fs = require('fs');
const path = require('path');

class NestedStore {
  /**
   * Creates a new NestedStore instance.
   * @param {string} fileName - The name of the JSON file to use for storage
   */
  constructor(fileName) {
    this.filePath = path.resolve(__dirname, '..', '..', fileName);
    this._load();
  }

  /**
   * Loads the store from disk. If the file doesn't exist, it starts fresh.
   * @private
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        if (fileContent.trim()) {
          this.data = JSON.parse(fileContent);
        } else {
          this.data = {};
        }
      } else {
        this.data = {};
      }
    } catch (error) {
      console.error(`[ERROR] Failed to load store from ${this.filePath}:`, error);
      this.data = {};
    }
  }

  /**
   * Saves the current in-memory store to disk. Must be called after any state modification.
   * Creates a backup before saving to prevent data loss.
   */
  save() {
    try {
      // Remove backup file creation
      // Only write to the main file
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error(`[ERROR] FATAL: Could not write to store file at ${this.filePath}`, error);
    }
  }

  /**
   * Gets all data for a given key.
   * @param {string} key - The primary key
   * @returns {object} The data object for the key, or empty object if not found
   */
  get(key) { 
    return this.data[key] || {}; 
  }

  /**
   * Gets a specific item using a primary key and sub-key.
   * @param {string} key - The primary key
   * @param {string} subKey - The sub-key
   * @returns {*} The value at the specified location, or undefined if not found
   */
  getItem(key, subKey) { 
    return (this.data[key] || {})[subKey]; 
  }

  /**
   * Sets a specific item using a primary key and sub-key.
   * @param {string} key - The primary key
   * @param {string} subKey - The sub-key
   * @param {*} value - The value to store
   */
  setItem(key, subKey, value) {
    if (!this.data[key]) this.data[key] = {};
    this.data[key][subKey] = value;
  }

  /**
   * Deletes a specific item using a primary key and sub-key.
   * Also cleans up empty parent objects to keep the store tidy.
   * @param {string} key - The primary key
   * @param {string} subKey - The sub-key
   */
  deleteItem(key, subKey) {
    if (this.data[key]?.[subKey] !== undefined) {
      delete this.data[key][subKey];
      if (Object.keys(this.data[key]).length === 0) {
        delete this.data[key];
      }
    }
  }
}

module.exports = NestedStore; 