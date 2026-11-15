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
- Bot **privileged intent**: *Message Content* (needed to read the first message of a ticket and
  auto-answer it). Enable it in the Developer Portal → Bot → Privileged Gateway Intents.

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

## First five minutes in your server

1. Create a category called **Tickets** and a channel called **#transcripts** (private, staff only).
2. `/config category` → the Tickets category.
3. `/config log` → #transcripts.
4. `/config staff` → add the role that should see tickets (repeat for each role).
5. `/panel` in #support.

Members pick a lane from the dropdown and a private channel opens, visible only to them, the staff
roles and the bot.

## Teaching it about your server

```
/knowledge setup     five-field briefing: what the server is, tone, hours, hard facts, escalation triggers
/knowledge add       one question + one approved answer (opens a form)
/knowledge list      every saved answer with its id
/knowledge test      ask a question privately and see the exact first reply + which entry matched
/knowledge export    download the pack as JSON
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
- Pings staff when the first-reply SLA is missed.
- Auto-closes tickets that have been silent past the configured window.

Staff silence it permanently with `/ticket claim`. Nothing resumes until a new ticket opens.

## Commands

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `/panel`             | Post the ticket panel                                      |
| `/ticket claim`      | Take the ticket, stop the SLA clock                        |
| `/ticket close`      | Transcript to the log + DM to the opener, then delete      |
| `/ticket add/remove` | Give or remove a member's access                           |
| `/ticket note`       | Internal note — log and transcript only, never shown       |
| `/ticket escalate`   | Ping staff roles and flag the ticket                       |
| `/ticket rename`     | Rename the channel                                         |
| `/knowledge …`       | Setup, add, list, remove, test, export                     |
| `/config …`          | Category, log, staff roles, auto-answer, SLA, auto-close   |
| `/stats`             | Open/closed counts, average resolution, staff leaderboard  |

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
