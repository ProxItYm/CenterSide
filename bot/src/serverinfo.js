'use strict';

/*
 * Live description of the guild, handed to the model so it stops inventing
 * channels. Built from cache, refreshed on a short TTL, and small enough to sit
 * in a system prompt without eating the context window.
 */

const TTL_MS = 120_000;
const cache = new Map();
const MAX_CHANNELS = 90;

const TYPE_LABEL = {
  0: '',
  2: '🔊 ',
  4: '🗂️ ',
  5: '📣 ',
  13: '🎙️ ',
  15: '🧵 ',
};

function channelLine(channel) {
  const prefix = TYPE_LABEL[channel.type] ?? '';
  return `${prefix}#${channel.name}`;
}

async function build(guild) {
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const categories = [...channels.values()].filter((c) => c && c.type === 4);
  const orphans = [...channels.values()].filter(
    (c) => c && c.type !== 4 && c.type !== 2 && !c.parentId,
  );

  const lines = [];
  let count = 0;

  for (const category of categories) {
    const children = [...channels.values()].filter((c) => c && c.parentId === category.id);
    if (!children.length) continue;
    lines.push(`${category.name}/`);
    for (const child of children) {
      if (count >= MAX_CHANNELS) break;
      lines.push(`  ${channelLine(child)}`);
      count += 1;
    }
  }

  if (orphans.length && count < MAX_CHANNELS) {
    lines.push('(no category)');
    for (const orphan of orphans) {
      if (count >= MAX_CHANNELS) break;
      lines.push(`  ${channelLine(orphan)}`);
      count += 1;
    }
  }

  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .slice(0, 25)
    .map((role) => role.name)
    .join(', ');

  return [
    `SERVER MAP — ${guild.name} · ${guild.memberCount} members · ${channels.size} channels`,
    'Categories and channels:',
    ...lines,
    `Roles: ${roles || 'none'}`,
  ].join('\n');
}

/** Cached map for a guild. Returns a string, never throws. */
async function snapshot(guild) {
  if (!guild) return '';
  const hit = cache.get(guild.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;

  try {
    const text = await build(guild);
    cache.set(guild.id, { at: Date.now(), text });
    return text;
  } catch (err) {
    return hit ? hit.text : '';
  }
}

function invalidate(guildId) {
  cache.delete(guildId);
}

module.exports = { snapshot, invalidate };
