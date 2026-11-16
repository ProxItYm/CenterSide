'use strict';

/*
 * Instant command registration for the servers this install already knows about.
 * Global commands can take an hour to show up; guild commands appear immediately.
 * Run with: node scripts/deploy-guilds.js
 */

require('dotenv').config();
const fs = require('node:fs');

const { REST, Routes } = require('discord.js');
const { commands } = require('../src/commands');
const config = require('../src/config');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);

  let guildIds = [];
  try {
    const state = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
    guildIds = Object.keys(state.guilds || {});
  } catch {
    console.log('no state.json yet — nothing to target');
  }

  if (!guildIds.length) process.exit(1);

  await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
  console.log('cleared global commands');

  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commands });
      console.log(`registered ${commands.length} commands in ${guildId}`);
    } catch (err) {
      console.warn(`skipped ${guildId}: ${err.message}`);
    }
  }

  console.log('done — commands appear immediately in those servers');
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
