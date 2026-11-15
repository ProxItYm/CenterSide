'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

const config = require('./config');
const { route, handleTicketMessage } = require('./handlers');
const { loadPack } = require('./knowledge');
const { setClient, restoreTimers, autoCloseStale } = require('./tickets');

if (!config.token) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

function buildClient(withMessageContent) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);
  return new Client({ intents, partials: [Partials.Channel] });
}

function wire(client, withMessageContent) {
  client.once(Events.ClientReady, async (ready) => {
    console.log(`[centerside] online as ${ready.user.tag} in ${ready.guilds.cache.size} guild(s)`);
    if (!withMessageContent) {
      console.warn('[centerside] Message Content intent is OFF — auto-answer is disabled until it is enabled in the Developer Portal (Bot → Privileged Gateway Intents). Tickets, panels, close, transcripts and stats all work.');
    }

    await restoreTimers(client).catch((err) => console.error('[ready] timer restore failed:', err.message));

    const sweep = setInterval(() => {
      autoCloseStale(client).catch((err) => console.error('[auto-close]', err.message));
    }, 10 * 60_000);
    sweep.unref();
  });

  client.on(Events.InteractionCreate, (interaction) => route(interaction, client));

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guildId || message.author.bot) return;
    try {
      const pack = await loadPack();
      await handleTicketMessage(message, pack);
    } catch (err) {
      console.error('[message]', err);
    }
  });

  client.on(Events.Error, (err) => console.error('[client]', err));
  client.on(Events.Warn, (msg) => console.warn('[warn]', msg));
  client.on(Events.GuildCreate, (guild) => console.log(`[centerside] joined ${guild.name} (${guild.id})`));
}

async function boot() {
  let withMessageContent = true;
  let client = buildClient(withMessageContent);
  wire(client, withMessageContent);

  try {
    await client.login(config.token);
  } catch (err) {
    const disallowed = err && (err.code === 4014 || /disallowed intents/i.test(err.message || ''));
    if (!disallowed) throw err;
    console.warn('[centerside] login rejected: Message Content intent is not enabled for this application. Retrying without it.');
    client.destroy();
    withMessageContent = false;
    client = buildClient(false);
    wire(client, withMessageContent);
    await client.login(config.token);
  }

  setClient(client);
  return client;
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

boot().catch((err) => {
  console.error('[login] failed:', err.message || err);
  process.exit(1);
});
