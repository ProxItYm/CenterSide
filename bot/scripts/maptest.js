'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { loadPack } = require('../src/knowledge');
const { systemPrompt } = require('../src/converse');
const serverInfo = require('../src/serverinfo');
const ai = require('../src/ai');
const { settingsFor } = require('../src/state');

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((r) => client.once('clientReady', r));

  const guild = client.guilds.cache.first();
  const map = await serverInfo.snapshot(guild);

  const settings = await settingsFor(guild.id);
  const panel = settings.panelChannelId ? guild.channels.cache.get(settings.panelChannelId) : null;
  const category = settings.categoryId ? guild.channels.cache.get(settings.categoryId) : null;

  const ticketInfo = [
    panel ? `The ticket panel is posted in #${panel.name}.` : 'No ticket panel has been posted yet; staff need to run /panel.',
    category ? `New tickets are created under the "${category.name}" category.` : '',
    'This conversation is happening in #ticket-test.',
  ].filter(Boolean).join(' ');

  const pack = await loadPack();

  for (const question of ['where is the panel', 'where are the tickets made']) {
    const t = Date.now();
    const answer = await ai.complete({
      system: systemPrompt(pack, { category: 'report' }, {}, map, ticketInfo),
      messages: [{ role: 'user', content: question }],
      maxTokens: 200,
    });
    console.log(`\nQ: ${question}\nA (${Date.now() - t}ms): ${answer}`);
  }

  await client.destroy();
})().catch((e) => { console.error(e.message); process.exit(1); });
