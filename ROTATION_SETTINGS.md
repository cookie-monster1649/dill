# Rotation Settings Feature

## Overview

The rotation settings feature allows administrators to manually set the last accepted date for each member in a rotation. This affects the rotation order by determining who goes next in the queue.

## How to Use

1. Open the Dill Rotations overview modal by running `/dill` in a Slack channel
2. For any rotation, click the ⚙️ (settings) button next to the "Edit" button
3. In the settings modal, you can set the last accepted date for each member:
   - Use the format `YYYY-MM-DD` (e.g., `2025-01-15`)
   - Leave the field empty if the member has never accepted a pick
4. Click "Save" to apply the changes

## How It Works

- **Rotation Order**: Members are ordered by their last accepted date
  - Members who have never accepted a pick (empty date) appear first
  - Members who have accepted picks are ordered by date (oldest first)
- **Data Persistence**: Changes are automatically saved and backed up
- **Real-time Updates**: The overview modal is updated immediately after saving

## Use Cases

- **Manual Corrections**: Fix incorrect last accepted dates
- **Historical Data**: Set dates for members who accepted picks before the feature was implemented
- **Rotation Balancing**: Adjust the order to ensure fair distribution of on-call duties

## Technical Details

- The settings are stored in the rotation queue data structure
- Each member has a `lastAcceptedDate` field in ISO date format (`YYYY-MM-DD`)
- The rotation is automatically reordered when settings are saved
- All changes are backed up to persistent storage
