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
| `chat:write` | Post, update and delete Dill's own messages (including old backups) |
| `commands` | Register the `/dill` slash command |
| `users:read` | Resolve member display names |
| `channels:read` | Read public channel info |
| `groups:read` | Read private channel info |
| `channels:history` | Read backup channel history |
| `groups:history` | Read backup channel history (private channels) |
| `chat:write.public` | Post in public channels Dill hasn't joined |
| `groups:write` | Manage private channels Dill is in |
| `channels:join` | Join public channels when a pick is triggered |
| `reactions:read` | Read :x: reactions on speaking-order lists |
| `im:history` | Read survey answers people send Dill by DM |
| `reactions:write` | ❤️ thank-you DMs to Dill |
| `chat:write.customize` | Post survey answers with the person's name and avatar |

**Subscribe to bot events** under *Features → Event Subscriptions*: `reaction_added` and `reaction_removed` (used by speaking-order lists), `message.im` (survey answers) and `message.channels` / `message.groups` (summoning people when someone replies to their survey post).

**Allow DMs** under *Features → App Home*: tick *Allow users to send Slash commands and messages from the messages tab*, or nobody can reply to a survey.

Alternatively, paste [`slack-app-manifest.json`](slack-app-manifest.json) into *App Manifest* to configure all of the above in one go.

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

### Pick message notes

Every rotation has an optional **Pick message notes** field. It's a rich text editor, so you can add links (toolbar or ⌘K / Ctrl+K), bold, lists and so on. Whatever you write there (e.g. what to prepare, a Trello board link) is shown in each pick message, and **Preview pick message** shows how it will look before you save.

### Speaking order

Tick **Post a speaking order list** on any rotation to post a shuffled, numbered list of members after each pick. For example, a fortnightly retro picks a facilitator on Tue and posts the speaking order on Wed.

- **List day** – the list posts at the rotation's pick time on this day (default Wed), but only in a week with a pick, so it follows the rotation's frequency
- **Leave** – members on leave that day are left off
- **Opting out** – anyone who reacts :x: to the list is removed and the numbers close up. Removing the reaction puts them back in their original spot
- **Post Speaking Order Now** – posts the list immediately, handy for testing

---

## Daily surveys

Async standups in the style of Geekbot. Open `/dill` in the channel where answers should appear and choose **Surveys → New Survey**.

- **Who and when** – pick the people, days and a time. Each person gets a DM at that time **in their own Slack timezone**
- **Answering** – Dill asks one question at a time in the DM, and each reply answers the current question
- **Posting** – when someone finishes, their answers post to the channel, either as replies in **one thread per day** (the parent shows who's still to answer) or as **one message per person**. Posts show the person's name and avatar
- **Replies** – in one-message-per-person mode, the first reply from someone else under a person's post makes Dill reply "Summoning @person :wand:", since Slack doesn't notify them about replies to a post Dill made for them
- **Non-answers** – answers like "no", "nope", "n/a", "skip" or "no blockers" are left out of the channel post (the person's DM summary still shows them, marked as not posted). Longer answers such as "No, but the deploy is stuck" are kept
- **Thanks** – a short "thanks" or "good bot" DM to Dill (outside a survey) gets a :heart: reaction
- **Editing** – edit any of your DM replies in Slack and the change is used, whether you're still answering or already posted. The "Thanks!" DM also has an **Edit answers** button. Either way the channel post updates in place
- **Leave** – people on leave in that channel aren't sent the survey
- **Catch-up** – if Dill was offline at send time, it still sends the survey up to 2 hours late, but no later
- **Overlaps** – if two surveys are due at once, the second waits until the first is finished. A new day's survey replaces yesterday's unfinished one

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
