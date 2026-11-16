'use strict';

require('./env');

const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require('discord.js');

const config = require('./config');
const { route, handleTicketMessage, handleMemberJoin, ensurePanelForGuild } = require('./handlers');
const { loadPack } = require('./knowledge');
const { setClient, autoCloseStale } = require('./tickets');
const ai = require('./ai');
const serverInfo = require('./serverinfo');
const web = require('./web');
const { guildRecord, save: saveState } = require('./state');

if (!config.token) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

function buildClient({ messageContent, members }) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (messageContent) intents.push(GatewayIntentBits.MessageContent);
  if (members) intents.push(GatewayIntentBits.GuildMembers);
  return new Client({ intents, partials: [Partials.Channel] });
}

function wire(client, flags) {
  client.once(Events.ClientReady, async (ready) => {
    console.log(`[centerside] online as ${ready.user.tag} in ${ready.guilds.cache.size} guild(s)`);
    if (!flags.messageContent) {
      console.warn('[centerside] Message Content intent is OFF — auto-answer is disabled. Enable it under Bot → Privileged Gateway Intents (you can keep the bot running).');
    }
    if (!flags.members) {
      console.warn('[centerside] Server Members intent is OFF — welcome messages are disabled. Enable it in the same panel to turn them on.');
    }

    web.start();

    for (const guild of ready.guilds.cache.values()) {
      try {
        const built = await ensurePanelForGuild(guild);
        if (built) console.log(`[centerside] panel ready in #${built.channel.name} (${guild.name})`);
      } catch (err) {
        console.error(`[panel] ${guild.name}: ${err.message}`);
      }
    }

    await notifyAdmins(ready).catch((err) => console.error('[notify]', err.message));

    const engine = await ai.describeProvider().catch(() => null);
    console.log(`[centerside] reply engine: ${engine || 'built-in conversational agent'}`);


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

  client.on(Events.GuildMemberAdd, (member) => {
    if (!flags.members) return;
    handleMemberJoin(member).catch((err) => console.error('[welcome]', err));
  });

  client.on(Events.Error, (err) => console.error('[client]', err));
  client.on(Events.Warn, (msg) => console.warn('[warn]', msg));
  client.on(Events.GuildCreate, (guild) => {
    console.log(`[centerside] joined ${guild.name} (${guild.id})`);
    serverInfo.invalidate(guild.id);
  });
  client.on(Events.ChannelCreate, (channel) => serverInfo.invalidate(channel.guildId));
  client.on(Events.ChannelDelete, (channel) => serverInfo.invalidate(channel.guildId));
  client.on(Events.ChannelUpdate, (_, channel) => serverInfo.invalidate(channel.guildId));
  client.on(Events.GuildRoleCreate, (role) => serverInfo.invalidate(role.guild.id));
  client.on(Events.GuildRoleDelete, (role) => serverInfo.invalidate(role.guild.id));
  client.on(Events.GuildRoleUpdate, (_, role) => serverInfo.invalidate(role.guild.id));
}

function isDisallowedIntents(err) {
  return Boolean(err) && (err.code === 4014 || /disallowed intents/i.test(err.message || ''));
}


async function notifyAdmins(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const record = await guildRecord(guild.id);
      if (record.settings.notifiedVersion === config.VERSION) continue;

      const owner = await client.users.fetch(guild.ownerId).catch(() => null);
      if (owner) {
        await owner.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x25d9ff)
              .setTitle(`CenterSide ${config.VERSION} is available`)
              .setDescription([
                `Your server **${guild.name}** is running an older build.`,
                '',
                'Run **/update** in that server and the bot pulls the latest code itself.',
                '',
                'Settings, panels, saved answers and tickets are kept.',
              ].join('\n'))
              .setFooter({ text: 'You are getting this because you own the server.' }),
          ],
        }).catch(() => {});
      }

      record.settings.notifiedVersion = config.VERSION;
      await saveState();
      console.log(`[notify] ${guild.name}: notice sent`);
    } catch (err) {
      console.warn(`[notify] ${guild.name}: ${err.message}`);
    }
  }
}

async function boot() {
  // Richest set first. A missing privileged intent in the Developer Portal is a
  // portal setting, not a reason for the bot to be down: drop the feature, log
  // it loudly, keep the desk running.
  const attempts = [
    { messageContent: true, members: true },
    { messageContent: true, members: false },
    { messageContent: false, members: false },
  ];

  let lastError;
  for (const flags of attempts) {
    const client = buildClient(flags);
    wire(client, flags);
    try {
      await client.login(config.token);
      setClient(client);
      return client;
    } catch (err) {
      lastError = err;
      if (!isDisallowedIntents(err)) throw err;
      console.warn(`[centerside] login rejected for intents ${JSON.stringify(flags)} — retrying with less.`);
      client.destroy();
    }
  }

  throw lastError;
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

boot().catch((err) => {
  console.error('[login] failed:', err.message || err);
  process.exit(1);
});
