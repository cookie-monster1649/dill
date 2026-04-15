# 🥒 Dill Bot

Dill is a Slack bot for managing team rotations and scheduled task queues. It provides a simple, interactive interface within Slack to create, manage, and automate fair user distribution across any channel – no engineering knowledge required.

Whether you're running on-call rotations, meeting facilitators, or any recurring team responsibility, Dill keeps things fair and hands-off.

> **GenAI project** – Dill was built with generative AI tooling and has been validated and in active use by a team for over a year.

---

## Features

### Rotations

- **Create, edit and delete rotations** – manage multiple independent rotations within any Slack channel
- **Fair distribution** – the queue is ordered by date of last accepted pick, with the least recently active member always at the front
- **Flexible scheduling** – weekly, fortnightly or monthly, on any day(s) of the week, at any 30-minute interval, in any timezone (UTC-12 to UTC+14)
- **Accept or skip** – each pick posts a message with Accept/Skip buttons; skipped members move to the back of the queue until the next day
- **In-place message updates** – accepted picks update the original message rather than posting a new one, keeping channels tidy
- **Silent skips** – when someone skips, the next person is picked silently; a record of skips is logged in the thread

### Leave management

- **Mark members as on leave** – remove a member from upcoming picks without removing them from the rotation
- **Automatic reinstatement** – members return to the queue automatically when leave ends

### Scheduling

- **Rotation settings** – manually set a member's last accepted date to reorder the queue (useful for bootstrapping a new rotation fairly)
- **Daily skip reset** – skip status is automatically cleared each day at 00:01 UTC
- **Fortnightly and monthly** – supports every-2-week and every-4-week frequencies, not just weekly

### Persistent storage

- **Slack-channel backup** – back up all rotation data to a private Slack channel; the bot restores from this backup on startup
- **Local JSON fallback** – data is also written to local JSON files for fast reads and startup

### UI

- **Central management modal** – `/dill` opens a modal listing all rotations with upcoming pick previews
- **Live updates** – saving a rotation immediately refreshes the modal
- **Easy navigation** – Save only appears when there is something to save; otherwise modals show Close

---

## Slash commands

| Command | Description |
|---------|-------------|
| `/dill` | Opens the main management modal |
| `/dill help` | Shows all available commands (private, ephemeral) |
| `/dill status` | Shows bot uptime, memory and active job counts |
| `/dill pick [name]` | Manually triggers a pick for a rotation |
| `/dill reset [name]` | Randomises a rotation's queue |
| `/dill restore-backup` | Restores data from the most recent Slack backup |
| `/dill delete-backup` | Deletes all backup messages from the backup channel |
| `/dill kill-kill-kill confirm` | Wipes all data and backups – irreversible |

---

## Requirements

- Node.js v20.14.0 or higher (or Docker)
- A Slack workspace where you can install apps
- A way to host the bot 24/7 (see [Hosting](#hosting))

---

## Setup

### 1. Create your Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app **from scratch**.

**Enable Socket Mode** under *Settings → Socket Mode*. Generate an App-Level Token with the `connections:write` scope – this becomes your `SLACK_APP_TOKEN`.

**Add a slash command** under *Features → Slash Commands*:
- Command: `/dill`
- Description: Manage team rotations
- Usage hint: `[help | pick | reset | status | ...]`

**Add OAuth scopes** under *Features → OAuth & Permissions → Bot Token Scopes*:

| Scope | Purpose |
|-------|---------|
| `chat:write` | Post and update rotation messages |
| `chat:delete` | Remove old backup messages |
| `commands` | Register the `/dill` slash command |
| `users:read` | Resolve member display names |
| `channels:read` | Read public channel info |
| `groups:read` | Read private channel info |
| `channels:history` | Read backup channel history |
| `groups:history` | Read backup channel history (private channels) |
| `channels:join` | Join public channels when a pick is triggered |

**Install the app** to your workspace under *Settings → Install App*. Copy the **Bot Token** (`xoxb-…`) – this becomes your `SLACK_BOT_TOKEN`.

Copy the **Signing Secret** from *Settings → Basic Information* – this becomes your `SLACK_SIGNING_SECRET`.

### 2. Clone and install

```bash
git clone https://github.com/cookie-monster1649/dill.git
cd dill
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```env
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Optional – enables Slack-channel backup (recommended)
DILL_STORAGE_CHANNEL_ID=C1234567890

# Optional – AES-256 encryption key for backups (64 hex chars)
DILL_BACKUP_ENCRYPTION_KEY=

# Optional
NODE_ENV=production
LOG_LEVEL=INFO
PORT=3000
```

See [Persistent Storage](#persistent-storage) for details on `DILL_STORAGE_CHANNEL_ID`.

### 4. Run the bot

```bash
npm start
```

You should see `⚡️ Dill Bot is running!` in the console.

**Add the bot to a channel:**
- Public channels: run `/dill` – the bot joins automatically
- Private channels: run `/invite @dillbot` first, then `/dill`

---

## Hosting

Dill requires a persistent process that stays online 24/7. It uses Slack's Socket Mode, so no public inbound URL is needed.

### Docker (recommended)

A pre-built image is published to the GitHub Container Registry on every release.

**Run with Docker:**

```bash
docker run -d \
  --name dill-bot \
  --restart unless-stopped \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_APP_TOKEN=xapp-... \
  -e SLACK_SIGNING_SECRET=... \
  -e DILL_STORAGE_CHANNEL_ID=C... \
  -e NODE_ENV=production \
  ghcr.io/cookie-monster1649/dill:latest
```

**Run with Docker Compose:**

```yaml
services:
  dill-bot:
    image: ghcr.io/cookie-monster1649/dill:latest
    restart: unless-stopped
    environment:
      SLACK_BOT_TOKEN: xoxb-...
      SLACK_APP_TOKEN: xapp-...
      SLACK_SIGNING_SECRET: ...
      DILL_STORAGE_CHANNEL_ID: C...
      NODE_ENV: production
```

**Build from source:**

```bash
docker build -t dill-bot .
docker run -d --name dill-bot --restart unless-stopped --env-file .env dill-bot
```

> **Note on data persistence with Docker:** By default, local JSON files are written inside the container and lost on restart. Use `DILL_STORAGE_CHANNEL_ID` (Slack-channel backup) for persistence without volume mounts – the bot restores from Slack on every startup.

### Railway

1. Fork this repo to your own GitHub account
2. Create a new project at [railway.app](https://railway.app) and connect your fork
3. Add environment variables in the Railway dashboard
4. Railway deploys automatically on every push to `main`

Railway's free tier has sleep behaviour – upgrade to a paid plan for always-on operation.

### Fly.io

```bash
fly launch          # creates fly.toml
fly secrets set \
  SLACK_BOT_TOKEN=xoxb-... \
  SLACK_APP_TOKEN=xapp-... \
  SLACK_SIGNING_SECRET=... \
  DILL_STORAGE_CHANNEL_ID=C...
fly deploy
```

Fly's smallest machine (`shared-cpu-1x`, 256MB RAM) is sufficient. Set `min_machines_running = 1` in `fly.toml` to prevent sleeping.

### Heroku

```bash
heroku create your-dill-bot
heroku config:set \
  SLACK_BOT_TOKEN=xoxb-... \
  SLACK_APP_TOKEN=xapp-... \
  SLACK_SIGNING_SECRET=... \
  DILL_STORAGE_CHANNEL_ID=C... \
  NODE_ENV=production
git push heroku main
heroku ps:scale web=1
```

Heroku's Eco dynos sleep after 30 minutes of inactivity. Use a Basic dyno or higher for always-on operation.

---

## Persistent storage

Dill can back up all rotation data to a private Slack channel. On startup the bot restores from the most recent backup, so data survives restarts and redeployments.

**Setup:**

1. Create a private Slack channel (e.g. `#dill-storage`) and invite your bot to it
2. Get the channel ID – right-click the channel name → *Copy link*, then extract the `C…` segment from the URL
3. Add it to your environment: `DILL_STORAGE_CHANNEL_ID=C1234567890`

**How it works:**

- One backup message is kept in the channel at all times (previous messages are deleted on each write)
- Backups are triggered automatically after any data change
- Large backups are split into multiple messages and automatically reassembled on restore
- Optionally set `DILL_BACKUP_ENCRYPTION_KEY` (64 hex characters) to encrypt backups with AES-256 before posting

---

## Rotation settings

For each rotation, a ⚙️ settings button lets you manually set each member's **last accepted date** (`YYYY-MM-DD`). This controls queue order and is useful for:

- Bootstrapping a fair starting order for a new rotation
- Correcting order after members are added or removed
- Re-balancing after extended absences

Members with no date set appear at the front of the queue (they go first).

---

## Architecture

```
src/
├── index.js              # Entry point – starts the app
├── app.js                # Orchestrator – wires up Slack handlers and services
├── bot/                  # Slack lifecycle and modal building
├── commands/             # Slash command handlers
├── handlers/             # Slack action (button/modal) handlers
├── services/             # Business logic – scheduling, analytics, storage
├── stores/               # Data layer – JSON file persistence
└── utils/                # Helpers – dates, rotations, Slack API wrappers
config.js                 # All tunable constants
```

Data is stored in JSON files (`configs.json`, `rotations.json`, `activestate.json`, `analytics.json`, `leave.json`) in the project root. These are created automatically on first run and excluded from version control.

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss what you'd like to change.

```bash
npm run dev    # Start with auto-restart on file changes
npm test       # Run the test suite
```

Log verbosity can be increased with `LOG_LEVEL=DEBUG` in your `.env`.
