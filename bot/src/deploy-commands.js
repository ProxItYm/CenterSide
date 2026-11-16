'use strict';

require('./env');

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');
const config = require('./config');

/*
 * Global command updates propagate lazily and clients cache the old list, which
 * is how deleted commands keep showing up for an hour. When GUILD_ID is set we
 * clear the global set and publish to that guild instead: instant, no ghosts.
 */

async function main() {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  if (!config.clientId) throw new Error('CLIENT_ID is missing in .env.');

  const rest = new REST({ version: '10' }).setToken(config.token);

  if (config.devGuildId) {
    await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
    console.log('Cleared global commands.');

    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.devGuildId),
      { body: commands },
    );
    console.log(`Registered ${commands.length} commands to guild ${config.devGuildId} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`Registered ${commands.length} commands globally (can take up to an hour to appear).`);

    // Clear per-guild copies for servers this install already knows about, or the
    // commands show up twice in those guilds.
    try {
      const state = JSON.parse(require('node:fs').readFileSync(config.stateFile, 'utf8'));
      for (const guildId of Object.keys(state.guilds || {})) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: [] });
        console.log(`Cleared guild-scoped commands in ${guildId}.`);
      }
    } catch {
      // fresh install, no state file yet
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
