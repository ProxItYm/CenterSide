'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { loadPack } = require('../src/knowledge');
const { systemPrompt } = require('../src/converse');
const serverInfo = require('../src/serverinfo');
const ai = require('../src/ai');
const { settingsFor } = require('../src/state');
const { panelCategories } = require('../src/config');

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise((r) => client.once('clientReady', r));

  const guild = client.guilds.cache.first();
  const map = await serverInfo.snapshot(guild);
  const settings = await settingsFor(guild.id);

  const panel = settings.panelChannelId ? guild.channels.cache.get(settings.panelChannelId) : null;
  const link = panel && settings.panelMessageId
    ? `https://discord.com/channels/${guild.id}/${panel.id}/${settings.panelMessageId}`
    : '';

  const ticketInfo = [
    panel ? `The ticket panel is posted in #${panel.name} and has NOTHING to do with slash commands.` : 'No panel yet.',
    link ? `Direct link to the panel: ${link}` : '',
    `Members open a ticket by clicking the dropdown on that panel and picking a lane. Lanes: ${panelCategories.map((c) => c.label).join(', ')}.`,
    'If someone asks how to open a ticket, give them the panel channel and link.',
  ].filter(Boolean).join(' ');

  const pack = await loadPack();
  console.log('panel channel:', panel ? `#${panel.name}` : 'none');
  console.log('link:', link);

  for (const question of ['wheres the ticket panel', 'how do i open a ticket']) {
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
