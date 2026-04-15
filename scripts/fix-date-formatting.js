#!/usr/bin/env node

/**
 * Script to fix malformed dates in rotation data.
 * This script normalizes all lastAcceptedDate fields to ensure proper sorting.
 */

const NestedStore = require('../src/stores/NestedStore');
const { normalizeDate } = require('../src/utils/rotationHelpers');

function fixDateFormatting() {
  console.log('🔧 Fixing date formatting in rotation data...');
  
  const queueStore = new NestedStore('rotations.json');
  const configStore = new NestedStore('configs.json');
  
  let totalFixed = 0;
  let totalRotations = 0;
  
  // Get all channels from the queue store data
  const channels = Object.keys(queueStore.data);
  
  for (const channel of channels) {
    const channelConfig = configStore.get(channel);
    if (!channelConfig) continue;
    
    const rotations = Object.keys(channelConfig);
    
    for (const rotationName of rotations) {
      const cfg = channelConfig[rotationName];
      if (!cfg || !Array.isArray(cfg.members)) continue;
      
      totalRotations++;
      let schedule = queueStore.getItem(channel, rotationName);
      
      if (!Array.isArray(schedule)) {
        console.log(`⚠️  Skipping ${rotationName} in ${channel}: invalid schedule format`);
        continue;
      }
      
      let hasChanges = false;
      
      // Check and fix each schedule entry
      schedule = schedule.map(turn => {
        if (!turn || typeof turn.user !== 'string') {
          return turn;
        }
        
        const updatedTurn = { ...turn };
        
        if (turn.lastAcceptedDate) {
          const normalizedDate = normalizeDate(turn.lastAcceptedDate);
          if (normalizedDate !== turn.lastAcceptedDate) {
            console.log(`🔧 Fixed date for ${turn.user} in ${rotationName}: ${turn.lastAcceptedDate} -> ${normalizedDate}`);
            updatedTurn.lastAcceptedDate = normalizedDate;
            hasChanges = true;
            totalFixed++;
          }
        }
        
        return updatedTurn;
      });
      
      if (hasChanges) {
        queueStore.setItem(channel, rotationName, schedule);
        console.log(`✅ Updated schedule for ${rotationName} in ${channel}`);
      }
    }
  }
  
  if (totalFixed > 0) {
    queueStore.save();
    console.log(`\n🎉 Successfully fixed ${totalFixed} malformed dates across ${totalRotations} rotations!`);
  } else {
    console.log(`\n✅ No malformed dates found in ${totalRotations} rotations.`);
  }
}

// Run the fix
if (require.main === module) {
  try {
    fixDateFormatting();
  } catch (error) {
    console.error('❌ Error fixing date formatting:', error);
    process.exit(1);
  }
}

module.exports = { fixDateFormatting };
