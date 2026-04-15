#!/usr/bin/env node

/**
 * Setup script for Dill Bot persistent storage
 * 
 * This script helps users configure persistent storage by:
 * 1. Creating a private Slack channel
 * 2. Inviting the bot to the channel
 * 3. Updating the .env file with the channel ID
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupPersistentStorage() {
  console.log('🥒 Dill Bot Persistent Storage Setup\n');
  
  // Check if .env file exists
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found. Please create one first with your Slack tokens.');
    process.exit(1);
  }
  
  // Check if bot token is available
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (!envContent.includes('SLACK_BOT_TOKEN=')) {
    console.error('❌ SLACK_BOT_TOKEN not found in .env file. Please add your bot token first.');
    process.exit(1);
  }
  
  console.log('📋 Setup Steps:');
  console.log('1. Create a private Slack channel for Dill Bot storage');
  console.log('2. Invite your Dill Bot to the channel');
  console.log('3. Get the channel ID and add it to your .env file');
  console.log('');
  
  const channelId = await question('Enter the Slack channel ID (e.g., C1234567890): ');
  
  if (!channelId.match(/^C[A-Z0-9]{9,}$/)) {
    console.error('❌ Invalid channel ID format. Channel IDs should start with "C" followed by 9+ characters.');
    process.exit(1);
  }
  
  // Check if DILL_STORAGE_CHANNEL_ID already exists
  if (envContent.includes('DILL_STORAGE_CHANNEL_ID=')) {
    const update = await question('DILL_STORAGE_CHANNEL_ID already exists. Update it? (y/N): ');
    if (update.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    
    // Remove existing line
    const lines = envContent.split('\n');
    const filteredLines = lines.filter(line => !line.startsWith('DILL_STORAGE_CHANNEL_ID='));
    const newContent = filteredLines.join('\n') + '\nDILL_STORAGE_CHANNEL_ID=' + channelId;
    fs.writeFileSync(envPath, newContent);
  } else {
    // Add new line
    fs.appendFileSync(envPath, '\nDILL_STORAGE_CHANNEL_ID=' + channelId);
  }
  
  console.log('✅ Persistent storage configured successfully!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Restart your Dill Bot');
  console.log('2. The bot will automatically create an initial backup');
  console.log('3. Check the storage channel for backup messages');
  console.log('');
  console.log('For more information, see PERSISTENT_STORAGE.md');
  
  rl.close();
}

// Handle script execution
if (require.main === module) {
  setupPersistentStorage().catch(error => {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  });
}

module.exports = { setupPersistentStorage }; 