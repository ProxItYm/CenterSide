'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('../src/commands');
const config = require('../src/config');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  console.log(`global registered: ${commands.length}`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
