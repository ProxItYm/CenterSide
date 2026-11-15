'use strict';

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');
const config = require('./config');

async function main() {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  if (!config.clientId) throw new Error('CLIENT_ID is missing in .env.');

  const rest = new REST({ version: '10' }).setToken(config.token);
  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);

  console.log(`Registering ${commands.length} commands ${config.devGuildId ? `to guild ${config.devGuildId}` : 'globally'}…`);
  await rest.put(route, { body: commands });
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
