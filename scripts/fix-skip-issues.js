#!/usr/bin/env node

/**
 * Script to fix skip-related issues in rotation data
 * 
 * This script:
 * 1. Resets all skip statuses to false
 * 2. Reorders queues based on last accepted dates
 * 3. Logs the current state for debugging
 */

const NestedStore = require('../src/stores/NestedStore');

function fixSkipIssues() {
  console.log('🔧 Fixing skip-related issues in rotation data...');
  
  const queueStore = new NestedStore('rotations.json');
  const configStore = new NestedStore('configs.json');
  
  const channels = queueStore.data || {};
  let totalRotations = 0;
  let totalFixed = 0;
  
  for (const channel in channels) {
    const channelRotations = channels[channel];
    
    for (const rotationName in channelRotations) {
      totalRotations++;
      let schedule = channelRotations[rotationName];
      
      if (!Array.isArray(schedule)) {
        console.log(`⚠️  Skipping ${rotationName} in ${channel}: invalid schedule format`);
        continue;
      }
      
      let hasChanges = false;
      
      // Reset skip status for all users
      schedule = schedule.map(turn => {
        if (!turn || typeof turn.user !== 'string') {
          return turn;
        }
        
        const updatedTurn = { ...turn };
        
        if (turn.isSkipped === true) {
          console.log(`🔧 Resetting skip status for ${turn.user} in ${rotationName}: true -> false`);
          updatedTurn.isSkipped = false;
          hasChanges = true;
          totalFixed++;
        }
        
        return updatedTurn;
      });
      
      // Reorder the queue based on last accepted dates
      schedule.sort((a, b) => {
        // If neither has been accepted, maintain current order
        if (!a.lastAcceptedDate && !b.lastAcceptedDate) {
          return 0;
        }
        // If only one has been accepted, the one without date comes first
        if (!a.lastAcceptedDate) return -1;
        if (!b.lastAcceptedDate) return 1;
        // Both have been accepted, sort by date (oldest first)
        return a.lastAcceptedDate.localeCompare(b.lastAcceptedDate);
      });
      
      if (hasChanges) {
        queueStore.setItem(channel, rotationName, schedule);
        console.log(`✅ Updated schedule for ${rotationName} in ${channel}`);
      }
      
      // Log current state
      console.log(`📊 ${rotationName} in ${channel}:`);
      schedule.forEach((turn, index) => {
        const skipStatus = turn.isSkipped ? ' (skipped)' : '';
        const lastAccepted = turn.lastAcceptedDate ? ` (accepted: ${turn.lastAcceptedDate})` : ' (never accepted)';
        console.log(`   ${index + 1}. ${turn.user}${skipStatus}${lastAccepted}`);
      });
    }
  }
  
  if (totalFixed > 0) {
    queueStore.save();
    console.log(`\n🎉 Successfully reset ${totalFixed} skip statuses across ${totalRotations} rotations!`);
  } else {
    console.log(`\n✅ No skip issues found in ${totalRotations} rotations.`);
  }
}

// Run the fix
if (require.main === module) {
  fixSkipIssues();
}

module.exports = { fixSkipIssues };
