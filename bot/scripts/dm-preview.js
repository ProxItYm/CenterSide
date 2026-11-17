'use strict';

require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const GUILD_ID = '1571623515197808651';

const TEXT = [
  '# How to set up CenterSide — fast and easy guide',
  '',
  '**1.** Add the bot from <#1571625569211129928>',
  '**2.** Tell the bot about your server with **/describe**',
  '**3.** Set up tickets with **/setup** (pick your support role + the questions)',
  '**4.** Post the panel with **/panel** — that is the door members use',
  '',
  'That is it!',
  '',
  '**Optional**',
  '- **/edit** — change the log channel, ticket category or support roles later',
  '- **/describe** again any time to rewrite your server description',
  '- **/welcome** — instant welcome embeds, no setup',
  '- Re-run **/panel** with new options to change the ticket menu',
  '',
  '__**IMPORTANT**__',
  '',
  '1. You will be notified when CenterSide updates — run **/update** when it happens and it updates itself.',
].join('\n');

(async () => {
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'CenterSide',
  };

  const guild = await (await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}`, { headers })).json();
  console.log('owner:', guild.owner_id, '| guild:', guild.name);

  const dm = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: guild.owner_id }),
  });
  const channel = await dm.json();
  if (!channel.id) {
    console.log('could not open DM:', JSON.stringify(channel).slice(0, 200));
    process.exit(1);
  }

  const sent = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: TEXT }),
  });

  const body = await sent.json();
  console.log('DM status:', sent.status, body.id ? 'sent' : JSON.stringify(body).slice(0, 200));
})();
