# CenterSide

A Discord ticket bot with a memory — plus the site that sells it.

CenterSide runs a support desk inside Discord: panels, private ticket channels, transcripts, SLA
timers, escalation lanes, staff notes and stats. The part that makes it different is the **server
briefing**: you tell it once what your community is about, and it answers the first message itself,
using only answers you approved. If nothing matches, it says so and pulls in a human instead of
inventing a policy.

```
CenterSide/
├── index.html              the website (single file, no build step)
├── .github/workflows/      GitHub Pages deploy
└── bot/                    the Discord bot
    ├── src/                bot source
    ├── data/pack.json      the knowledge pack (server briefing + saved answers)
    ├── scripts/selftest.js offline tests, no token needed
    └── .env.example        copy to .env
```

## Website

`index.html` is the whole site — one file, no dependencies except a Google Fonts link. Open it
directly in a browser, or serve the folder:

```bash
npx serve .
```

It includes a live knowledge-pack editor that builds the same reply shape the bot uses, so what you
see on the site is what the bot says in a ticket.

## Bot requirements

- Node.js 18.17 or newer
- A Discord application with a bot user
- Bot **privileged intents**: *Message Content* (auto-answer) and *Server Members* (welcome messages).
  Enable both in the Developer Portal → Bot → Privileged Gateway Intents. Missing either one only
disables that feature — the bot logs it and keeps running.

### Required permissions

When inviting the bot, grant:

- Manage Channels — create and delete ticket channels
- Manage Roles — apply channel permission overwrites
- View Channels, Send Messages, Read Message History
- Embed Links, Attach Files, Manage Messages
- Use Application Commands

## Setup

```bash
cd bot
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Fill `.env`:

| Variable        | Where to get it                                                    |
| --------------- | ------------------------------------------------------------------ |
| `DISCORD_TOKEN` | Developer Portal → Bot → Reset Token                               |
| `CLIENT_ID`     | Developer Portal → General Information → Application ID            |
| `GUILD_ID`      | optional — your test server id for instant command registration    |

Register the slash commands, then start it:

```bash
npm run deploy
npm start
```

## Setup, in one command

In your server, run:

```
/setup
```

That is it. It creates a **Tickets** category, creates a private **#transcripts** channel locked to your
staff role, saves your server briefing, and replies with a summary of exactly what it made. The modal
asks four plain questions: what the server is about, tone, support hours, and what should hand off to a
human.

Optional arguments if you already have your own channels:

```
/setup staff:@Support category:#Tickets log:#transcripts
```

Then post the panel wherever members should ask:

```
/panel
```

Members pick a lane from the dropdown and a private channel opens, visible only to them, the staff
role and the bot.

To change the briefing later, run `/setup` again — it updates in place and never duplicates channels.

## Teaching it about your server

```
/setup              four questions: what the server is, tone, hours, escalation triggers
/answer             one question + one approved answer (form)
/answers            every saved answer with its id
/answers remove:<id> delete an answer by id
```

A saved answer carries a keyword list generated from its question. Matching is deterministic: keyword
hits score 3 points, question-word overlap scores 1, and anything under `minConfidence` (3) is treated
as **not known** — the bot escalates instead of guessing. No model call, no hallucinations, no API
keys, no per-message cost.

Edit `bot/data/pack.json` directly if you prefer; the site's editor exports the same shape.

## What the bot does on its own

- Answers the opener's first message in an unclaimed ticket when a saved answer matches.
- One auto-reply per channel per 20 seconds, so a stuck loop cannot spam.
- Escalates on missing answers and on pack-defined triggers (chargeback, legal threat, compromised
  account…) — those also ping the staff roles.
- Auto-closes tickets that have been silent past the configured window.

Staff silence it permanently with the **Claim** button. Nothing resumes until a new ticket opens.

## Commands

Five, flat, no subcommands — Discord lists subcommands as separate picker entries, which is what makes
a small bot look enormous.

| Command    | What it does                                                                |
| ---------- | --------------------------------------------------------------------------- |
| `/setup`   | Creates the category and transcript channel, saves the briefing, sets staff. |
| `/panel`   | Posts the ticket panel in the current channel.                               |
| `/answer`  | One form: question members ask + answer the bot may give.                    |
| `/answers` | Lists saved answers with ids; pass an id to delete it.                       |
| `/welcome` | Posts a bot-built welcome embed; creates `#welcome` if missing.               |
| `/stats`   | Open / closed counts, average resolution, staff leaderboard.                 |

Everything a ticket needs is a button on the ticket itself:

| Button      | Effect                                                        |
| ----------- | ------------------------------------------------------------- |
| **Claim**   | Silences the bot for this ticket.                              |
| **Add user**| Gives another member access (modal, id or @mention).          |
| **Escalate**| Pings the staff roles and flags the ticket.                   |
| **Close**   | Writes the transcript, DMs the opener, deletes the channel.    |

## Welcome messages

```
/welcome                       enable in #welcome (created if missing)
/welcome message:Hey {user}!   set the line of copy
/welcome channel:#general      post somewhere else
/welcome off                   disable
```

The embed is built by the bot — title, avatar thumbnail, member number, join timestamp, brand colour.
You never touch an embed builder. `{server}`, `{count}` and `{user}` get substituted in your line.

Requires the **Server Members** intent (Developer Portal → Bot → Privileged Gateway Intents). Without
it the bot still runs; it logs that welcome is off and keeps the desk going.

## Data

- `data/pack.json` — the briefing and saved answers. Safe to commit; it is your content.
- `data/state.json` — guild settings, open tickets, closed history. Git-ignored, created on first run.
- `data/transcripts/` — local copies of closed-ticket transcripts. Git-ignored.

Writes are atomic (temp file + rename), and a corrupt state file is preserved as
`state.json.corrupt-<timestamp>` rather than overwritten.

## Testing

```bash
npm run selftest
```

Runs matching, escalation, tone and store round-trip checks with no token and no network.

## Hosting

On a VPS or a Raspberry Pi: `npm ci --omit=dev` and run it under a process manager
(`pm2 start src/index.js --name centerside`, or a systemd unit). Any Node host works — there is no
database and no external service.

## Notes

- Transcripts are capped at 1,000 messages per ticket.
- The bot never deletes a ticket without writing the transcript first; if the log channel is
  unreachable it still DMs the file to the opener.
- `Message Content` is required. Without it the auto-answer silently does nothing.
