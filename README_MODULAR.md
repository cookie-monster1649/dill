# 🥒 Dill Bot - Modular Architecture

This is the refactored version of Dill Bot, designed to be **human-readable and maintainable** for junior engineers. The code has been broken down into logical modules with clear separation of concerns.

## 📁 Project Structure

```
dill/
├── src/                          # Source code directory
│   ├── app.js                    # Main application class
│   ├── index.js                  # Entry point
│   ├── stores/                   # Data storage layer
│   │   └── NestedStore.js        # File-based key-value store
│   ├── services/                 # Business logic services
│   │   ├── analyticsService.js   # Analytics tracking
│   │   ├── schedulerService.js   # Cron job management
│   │   └── timeoutService.js     # Pick timeout handling
│   ├── utils/                    # Utility functions
│   │   ├── dateHelpers.js        # Date/time calculations
│   │   ├── rotationHelpers.js    # Rotation queue logic
│   │   └── slackHelpers.js       # Slack API utilities
│   └── handlers/                 # Event handlers
│       └── actionHandlers.js     # Slack action responses
├── config.js                     # Configuration constants
├── package.json                  # Dependencies and scripts
└── README.md                     # Original documentation
```

## 🏗️ Architecture Overview

### Core Principles

1. **Single Responsibility**: Each module has one clear purpose
2. **Dependency Injection**: Services receive their dependencies as parameters
3. **Clear Interfaces**: Each module exports well-defined functions/classes
4. **Comprehensive Documentation**: Every function has JSDoc comments with examples

### Module Breakdown

#### 📦 Stores (`src/stores/`)
- **NestedStore.js**: Simple file-based key-value storage
  - Handles JSON file persistence
  - Provides backup functionality
  - Includes error handling and validation

#### 🔧 Services (`src/services/`)
- **AnalyticsService**: Tracks user interactions and events
- **SchedulerService**: Manages cron jobs for rotation scheduling

#### 🛠️ Utils (`src/utils/`)
- **dateHelpers.js**: Date calculations, timezone handling, week numbers
- **rotationHelpers.js**: Queue management, user selection, skip logic
- **slackHelpers.js**: Slack API calls, rate limiting, UI building

#### 🎯 Handlers (`src/handlers/`)
- **actionHandlers.js**: All Slack interaction responses (buttons, modals, etc.)

## 🚀 Getting Started

### Prerequisites
- Node.js (v20.14.0 or higher)
- Slack App with Socket Mode enabled

### Installation
```bash
npm install
```

### Configuration
Create a `.env` file:
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
```

### Running the Bot
```bash
# Production
npm start

# Development (with auto-restart)
npm run dev
```

## 📚 Understanding the Code

### For Junior Engineers

#### 1. Start with the Entry Point
Begin with `src/index.js` - it's just 20 lines and shows how the bot starts.

#### 2. Main Application Class
`src/app.js` is the orchestrator that:
- Initializes all services
- Sets up Slack event handlers
- Manages the application lifecycle

#### 3. Follow the Data Flow
When a user clicks a button:
1. **Slack** → sends event to `app.js`
2. **app.js** → routes to appropriate handler in `actionHandlers.js`
3. **actionHandlers.js** → calls relevant service methods
4. **Services** → update data stores and respond to Slack

#### 4. Key Concepts

**Stores**: Think of these as "databases" that save data to JSON files
```javascript
// Example: Saving a rotation configuration
configStore.setItem('channel123', 'On-Call', {
  members: ['U123', 'U456'],
  days: ['mon', 'wed', 'fri'],
  time: '09:00'
});
```

**Services**: These handle business logic
```javascript
// Example: Starting a rotation pick
const turn = getNextUser(queueStore, channel, name, config);
if (turn) {
  await startPick(channel, name);
}
```

**Utils**: Helper functions for common tasks
```javascript
// Example: Calculating next rotation dates
const occurrences = getNextOccurrences(config, 5);
// Returns: [Date, Date, Date, Date, Date]
```

## 🔍 Key Features Explained

### Rotation Management
- **Cycles**: Each rotation maintains 3 cycles (current, next, after-next)
- **Shuffling**: Members are randomly ordered in each cycle
- **Skipping**: Users can skip, moving them to the back of their cycle
- **Deferral**: If someone skips at the end of a cycle, they're "deferred" to the next cycle

### Scheduling
- **Cron Jobs**: Uses the `cron` library for precise scheduling
- **Timezone Support**: Full timezone support with UTC offset selection
- **Frequency Options**: Weekly, fortnightly, or monthly rotations



## 🧪 Testing and Debugging

### Logging
The bot uses structured logging:
- `[INFO]` for normal operations
- `[WARN]` for recoverable issues
- `[ERROR]` for problems that need attention

### Common Issues
1. **"Could not join channel"**: Normal in DMs, ignore this warning
2. **"Trigger ID expired"**: User took too long, they need to try again
3. **"Hash conflict"**: Multiple users edited the same modal simultaneously

### Debug Mode
Set `LOG_LEVEL=DEBUG` in your `.env` file for more detailed logging.

## 🔧 Configuration

All configuration is in `config.js`:
- Rate limiting settings
- Timeout limits
- Display options
- Analytics retention

## 📈 Analytics

The bot tracks:
- Pick acceptances and skips
- User interactions
- Rotation usage

Data is stored in `analytics.json` and automatically cleaned up after 90 days.

## 🤝 Contributing

### Code Style
- Use JSDoc comments for all functions
- Include examples in documentation
- Follow the existing module structure
- Add error handling for all external calls

### Adding Features
1. Identify which module should handle the feature
2. Add the functionality to the appropriate service/util
3. Update the main app to wire up the new feature
4. Add comprehensive documentation

## 🆚 Comparison with Original

### Before (Original)
- Single 1,396-line file
- Mixed concerns (UI, business logic, data storage)
- Hard to find specific functionality
- Difficult to test individual components

### After (Modular)
- 8 focused modules
- Clear separation of concerns
- Easy to locate and modify specific features
- Testable individual components
- Comprehensive documentation

## 🎯 Benefits for Junior Engineers

1. **Learnable**: Each module can be understood independently
2. **Maintainable**: Changes are isolated to specific modules
3. **Testable**: Individual functions can be unit tested
4. **Documented**: Every function has clear documentation and examples
5. **Patterned**: Consistent structure across all modules

## 📖 Further Reading

- [Slack Bolt Framework](https://slack.dev/bolt-js/)
- [Node.js Cron Jobs](https://www.npmjs.com/package/cron)
- [JSDoc Documentation](https://jsdoc.app/)

---

This modular architecture makes Dill Bot much more approachable for junior engineers while maintaining all the original functionality. Each piece has a clear purpose and can be understood and modified independently. 