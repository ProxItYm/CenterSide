'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { loadPack } = require('../src/knowledge');
const { systemPrompt } = require('../src/converse');
const serverInfo = require('../src/serverinfo');
const ai = require('../src/ai');

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((r) => client.once('clientReady', r));

  const guild = client.guilds.cache.first();
  const map = await serverInfo.snapshot(guild);
  console.log('--- SERVER MAP ---');
  console.log(map);

  const pack = await loadPack();
  console.log('\n--- REPLY TEST ---');
  const t = Date.now();
  const answer = await ai.complete({
    system: systemPrompt(pack, { category: 'report' }, {}, map),
    messages: [{ role: 'user', content: 'where is the ticket channel' }],
    maxTokens: 200,
  });
  console.log(`(${Date.now() - t}ms)`, answer);

  await client.destroy();
})().catch((e) => { console.error(e.message); process.exit(1); });
