'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const config = require('../src/config');

const GUILDS = [
  '1571623515197808651',
  '1526073165980242000',
  '1363796232736080004',
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  for (const id of GUILDS) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, id), { body: [] });
      console.log(`cleared guild commands in ${id}`);
    } catch (err) {
      console.warn(`skipped ${id}: ${err.message}`);
    }
  }

  const global = await rest.get(Routes.applicationCommands(config.clientId));
  console.log(`global commands remaining: ${global.length} (${global.map((c) => c.name).join(', ')})`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
