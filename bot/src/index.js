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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

setClient(client);

client.once(Events.ClientReady, async (ready) => {
  console.log(`[centerside] online as ${ready.user.tag} in ${ready.guilds.cache.size} guild(s)`);

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

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

client.login(config.token).catch((err) => {
  console.error('[login] failed:', err.message);
  process.exit(1);
});
