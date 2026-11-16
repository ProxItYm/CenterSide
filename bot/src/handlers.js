'use strict';

const {
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { panelCategories, color, autoReplyCooldownMs, resolvedCloseSeconds } = require('./config');
const { panelMessage, baseEmbed, welcomeEmbed } = require('./ui');
const {
  openTicket,
  claimTicket,
  closeTicket,
  isStaff,
} = require('./tickets');
const {
  loadPack,
  updatePack,
  addAnswer,
  removeAnswer,
  shouldEscalate,
} = require('./knowledge');
const {
  nextReply,
  systemPrompt,
  getHistory,
  pushHistory,
  clearHistory,
} = require('./converse');
const ai = require('./ai');
const serverInfo = require('./serverinfo');
const web = require('./web');
const { guildRecord, settingsFor, save } = require('./state');

const autoReplyAt = new Map();
const pendingClose = new Map();

function clearPendingClose(channelId) {
  const timer = pendingClose.get(channelId);
  if (timer) clearTimeout(timer);
  pendingClose.delete(channelId);
}

/** Archiving a resolved ticket, unless someone speaks up first. */
function scheduleResolvedClose(channel, ticket) {
  clearPendingClose(channel.id);
  const timer = setTimeout(async () => {
    pendingClose.delete(channel.id);
    try {
      const record = await guildRecord(channel.guild.id);
      const live = record.tickets[channel.id];
      if (!live || live.status === 'closed') return;
      await closeTicket(
        channel,
        { id: channel.client.user.id, tag: 'CenterSide (resolved)' },
        'Resolved — closed automatically',
      );
      console.log(`[ticket] #${live.number} auto-closed after resolution`);
    } catch (err) {
      console.error('[auto-close]', err.message);
    }
  }, resolvedCloseSeconds * 1000);
  timer.unref?.();
  pendingClose.set(channel.id, timer);
}

function slugify(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'lane';
}

/** Configured ticket lanes. No invented defaults; one plain fallback lane. */
function lanesFor(settings) {
  const configured = (settings.lanes || [])
    .filter((lane) => lane && lane.label && lane.value)
    .slice(0, 5);
  return configured.length ? configured : [{ label: 'Support', value: 'support' }];
}

const DEFAULT_INTAKE = [
  'What is the reason for opening this ticket?',
  'Is it urgent or can it wait?',
  'Please provide your USER ID',
];

/** Does this message mean "shut my ticket" rather than "tell me something"? */
function openerWantsClose(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t || t.length > 160) return false;

  if (/^(done|resolved|that'?s all|thats all|no longer needed|all good|we'?re good)\b/.test(t)) return true;
  if (/(close|shut)\s+(this|the|my|it)\b/.test(t)) return true;
  if (/(can|could|would|will|please)\s+(you\s+)?(please\s+)?(close|shut)\b/.test(t)) return true;
  if (/\b(close|shut)\s+(it\s+)?for\s+me\b/.test(t)) return true;
  if (/\b(you|u)\s+can\s+(close|shut)\b/.test(t)) return true;
  return false;
}

/** Configured questions, or the defaults, never more than five. */
function intakeQuestions(settings) {
  const configured = (settings.intakeQuestions || [])
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, 5);
  return configured.length ? configured : DEFAULT_INTAKE;
}
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function staffOnly(member, settings) {
  if (isStaff(member, settings)) return null;
  return 'Staff only — you need the staff role set in `/setup`, or Manage Server.';
}

async function safeReply(message, content) {
  try {
    await message.reply({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error(`[auto-answer] reply failed in #${message.channel?.name}: ${err.message}`);
    try {
      await message.channel.send({ content, allowedMentions: { parse: [] } });
      return true;
    } catch (second) {
      console.error(`[auto-answer] fallback send failed: ${second.message}`);
      return false;
    }
  }
}

async function reply(interaction, content, extra = {}) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ...EPHEMERAL, ...extra });
  }
  return interaction.reply({ content, ...EPHEMERAL, ...extra });
}

/* ------------------------------------------------------------------ */
/* /setup                                                              */
/* ------------------------------------------------------------------ */

async function ensureCategory(guild, settings) {
  let category = settings.categoryId ? guild.channels.cache.get(settings.categoryId) : null;
  if (!category) {
    category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets',
    );
  }
  if (!category) {
    category = await guild.channels.create({
      name: 'Tickets',
      type: ChannelType.GuildCategory,
      reason: 'CenterSide setup',
    });
  }
  settings.categoryId = category.id;
  return category;
}

async function ensureLogChannel(guild, settings, category, staffRoleIds) {
  let log = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
  if (!log) {
    log = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === 'transcripts',
    );
  }
  if (!log) {
    log = await guild.channels.create({
      name: 'transcripts',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'CenterSide transcripts and staff notes',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        ...staffRoleIds.map((roleId) => ({
          id: roleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        })),
      ],
      reason: 'CenterSide setup',
    });
  }
  settings.logChannelId = log.id;
  return log;
}

/**
 * Every admin action needs a finished description first. /describe is the only
 * command that works on a fresh install; everything else points back at it.
 */
async function promptDescribe(interaction, prefix) {
  const record = await guildRecord(interaction.guildId);
  record.settings.guildName = interaction.guild?.name || record.settings.guildName;
  const token = web.tokenFor(record.settings);
  await save();
  try { web.start(); } catch (err) { console.warn('[web] start failed:', err.message); }

  const url = web.urlFor(token);
  const publicUrl = Boolean(process.env.WEB_BASE);

  const buttons = [];
  if (publicUrl) {
    buttons.push(new ButtonBuilder()
      .setLabel('Open the setup page')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Link)
      .setURL(url));
  }
  buttons.push(new ButtonBuilder()
    .setCustomId('describe:form')
    .setLabel('Fill it in here')
    .setEmoji('✍️')
    .setStyle(ButtonStyle.Primary));

  const row = new ActionRowBuilder().addComponents(buttons);

  return reply(interaction, [
    prefix,
    '',
    '**Describe your server first.** The bot needs to know what this place is before it can answer tickets.',
    publicUrl ? `Page: ${url}` : 'Use the button below — a short form, saved straight into the bot.',
    '',
    'What it is, tone, support hours, and hard facts it must never get wrong. Saved answers can be added afterwards with `/answer`.',
  ].join('\n'), { components: [row] });
}

/** In-Discord briefing: works for every server, no tunnel required. */
async function describeModal(interaction) {
  const pack = await loadPack();
  const modal = new ModalBuilder().setCustomId('describe:form').setTitle('Describe your server');

  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('server')
      .setLabel('Server name')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(80)
      .setRequired(true)
      .setValue('')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('about')
      .setLabel('What is this server about?')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(700)
      .setRequired(true)
      .setValue('')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('tone')
      .setLabel('Tone (or leave blank for friendly)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(40)
      .setRequired(false)
      .setValue('')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('hours')
      .setLabel('Support hours')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(70)
      .setRequired(false)
      .setValue('')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('facts')
      .setLabel('Facts it must never get wrong')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(700)
      .setRequired(false)
      .setValue('')),
  );

  return interaction.showModal(modal);
}

async function saveDescribeModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const server = interaction.fields.getTextInputValue('server').trim();
  const about = interaction.fields.getTextInputValue('about').trim();
  const tone = interaction.fields.getTextInputValue('tone').trim() || 'Friendly & casual';
  const hours = interaction.fields.getTextInputValue('hours').trim();
  const facts = interaction.fields.getTextInputValue('facts').trim();

  await updatePack((pack) => {
    pack.server = (server || pack.server || '').slice(0, 80);
    pack.about = about.slice(0, 700);
    pack.tone = (tone || pack.tone || '').slice(0, 40);
    if (hours) pack.hours = hours.slice(0, 120);
    if (facts) pack.hardFacts = facts.slice(0, 700);
  });

  const record = await guildRecord(interaction.guildId);
  record.settings.describedAt = Date.now();
  await save();

  const { clearAllHistory } = require('./converse');
  clearAllHistory();

  return interaction.editReply({
    content: 'Saved. Everything is unlocked now — run `/setup` to pick your questions, then `/panel` to open the desk.',
  });
}

async function ensureDescribed(interaction) {
  const record = await guildRecord(interaction.guildId);
  if (record.settings.describedAt) return true;
  const label = interaction.commandName ? `\`/${interaction.commandName}\`` : 'This action';
  await promptDescribe(interaction, `${label} is locked until CenterSide knows what this server is.`);
  return false;
}

function settingsEmbed(guild, settings) {
  const channel = (id) => (id ? `<#${id}>` : 'not set');
  return baseEmbed()
    .setTitle('CenterSide setup')
    .setDescription('Change any of these with `/edit` — one option at a time, nothing is recreated.')
    .addFields(
      { name: 'Ticket category', value: channel(settings.categoryId), inline: true },
      { name: 'Transcript log', value: channel(settings.logChannelId), inline: true },
      { name: 'Staff role', value: (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'everyone with Manage Server', inline: true },
      { name: 'Panel posted in', value: channel(settings.panelChannelId), inline: true },
      { name: 'Welcome channel', value: settings.welcomeEnabled ? channel(settings.welcomeChannelId) : 'off', inline: true },
      { name: 'Auto-answer', value: settings.autoAnswer ? 'on' : 'off', inline: true },
    )
    .setFooter({ text: 'Examples: /edit log:#transcripts · /edit staff:@Support · /edit briefing:true' });
}

async function handleSetup(interaction) {
  if (!(await ensureDescribed(interaction))) return;

  const record = await guildRecord(interaction.guildId);
  const current = intakeQuestions(record.settings);

  const modal = new ModalBuilder().setCustomId('setup:intake').setTitle('Ticket questions');
  const inputs = [];
  for (let i = 0; i < 5; i += 1) {
    inputs.push(new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setLabel(`Question ${i + 1}${i > 2 ? ' (optional)' : ''}`)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(45)
      .setRequired(false)
      .setValue(current[i] || ''));
  }

  modal.addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));
  return interaction.showModal(modal);
}

/** Saves the question set, then provisions channels + panel. */
async function confirmSetup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const questions = [];
  for (let i = 0; i < 5; i += 1) {
    const value = interaction.fields.getTextInputValue(`q${i}`).trim();
    if (value) questions.push(value.slice(0, 45));
  }

  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;
  settings.intakeQuestions = questions;
  await save();

  const guild = interaction.guild;
  const category = await ensureCategory(guild, settings);
  const log = await ensureLogChannel(guild, settings, category, settings.staffRoleIds || []);
  await save();
  const built = await ensurePanelForGuild(guild).catch(() => null);

  const embed = baseEmbed()
    .setColor(color.ok)
    .setTitle('CenterSide is set up')
    .setDescription(
      questions.length
        ? `Members will be asked ${questions.length} question${questions.length === 1 ? '' : 's'} before a ticket opens:`
        : 'No custom questions — members get the three default ones (reason, urgency, user id).',
    )
    .addFields(
      ...(questions.length ? [{ name: 'Ticket questions', value: questions.map((q, i) => `${i + 1}. ${q}`).join('\n') }] : []),
      { name: 'Tickets category', value: category ? `<#${category.id}>` : 'not set', inline: true },
      { name: 'Transcripts', value: log ? `<#${log.id}>` : 'not set', inline: true },
      { name: 'Panel', value: built ? `<#${built.channel.id}>` : 'not posted', inline: true },
    );

  return interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction) {
  if (!(await ensureDescribed(interaction))) return;
  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  const logChannel = interaction.options.getChannel('log');
  const categoryChannel = interaction.options.getChannel('category');
  const staffRole = interaction.options.getRole('staff');
  const welcomeChannel = interaction.options.getChannel('welcome');
  const wantsBriefing = interaction.options.getBoolean('briefing');

  if (!logChannel && !categoryChannel && !staffRole && !welcomeChannel && !wantsBriefing) {
    return reply(interaction, '', { embeds: [settingsEmbed(interaction.guild, settings)] });
  }

  if (logChannel) settings.logChannelId = logChannel.id;
  if (categoryChannel) settings.categoryId = categoryChannel.id;
  if (welcomeChannel) {
    settings.welcomeChannelId = welcomeChannel.id;
    settings.welcomeEnabled = true;
  }
  if (staffRole) {
    const set = new Set(settings.staffRoleIds || []);
    if (set.has(staffRole.id)) set.delete(staffRole.id);
    else set.add(staffRole.id);
    settings.staffRoleIds = [...set];
  }
  await save();

  if (wantsBriefing) {
    return handleSetup(interaction);
  }

  return reply(interaction, '', { embeds: [settingsEmbed(interaction.guild, settings)] });
}

/* ------------------------------------------------------------------ */
/* /panel                                                              */
/* ------------------------------------------------------------------ */


/**
 * Guarantees a panel exists and is remembered. Finds an existing support channel,
 * creates one if needed, posts the dropdown, stores channel + message id. Runs on
 * /setup, /panel, and on every boot so a deleted panel heals itself.
 */
async function ensurePanelForGuild(guild) {
  const record = await guildRecord(guild.id);
  const settings = record.settings;
  settings.guildName = guild.name;

  // No description, no panel. Nothing on the desk before the briefing exists.
  if (!settings.describedAt) return null;

  if (settings.panelChannelId && settings.panelMessageId) {
    const existingChannel = guild.channels.cache.get(settings.panelChannelId);
    if (existingChannel) {
      const existing = await existingChannel.messages.fetch(settings.panelMessageId).catch(() => null);
      if (existing) return { channel: existingChannel, message: existing };
    }
  }

  let channel = settings.panelChannelId ? guild.channels.cache.get(settings.panelChannelId) : null;
  if (!channel) {
    // Match on the word, not the whole name — servers decorate channels as
    // "#🎫│tickets" and an exact regex silently misses the obvious room.
    const candidates = [...guild.channels.cache.values()].filter(
      (c) => c.type === ChannelType.GuildText && /ticket|support|help/i.test(c.name),
    );
    candidates.sort((a, b) => {
      const score = (name) => (/ticket/i.test(name) ? 0 : /support/i.test(name) ? 1 : 2);
      return score(a.name) - score(b.name);
    });
    channel = candidates[0] || null;
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: 'support',
      type: ChannelType.GuildText,
      topic: 'Open a ticket from the panel below',
      reason: 'CenterSide panel',
    });
  }

  // Moving the panel: remove the old one so members never see two.
  if (settings.panelChannelId && settings.panelMessageId && settings.panelChannelId !== channel.id) {
    const previousChannel = guild.channels.cache.get(settings.panelChannelId);
    if (previousChannel) {
      const previous = await previousChannel.messages.fetch(settings.panelMessageId).catch(() => null);
      if (previous) await previous.delete().catch(() => {});
    }
  }

  const message = await channel.send(panelMessage());
  settings.panelChannelId = channel.id;
  settings.panelMessageId = message.id;
  await save();
  return { channel, message };
}

async function handleNotify(interaction) {
  const app = await interaction.client.application?.fetch().catch(() => null);
  const ownerId = app?.owner?.id;
  if (!ownerId || interaction.user.id !== ownerId) {
    return reply(interaction, 'Only the bot owner can send update notices.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const version = require('./config').VERSION;
  let sent = 0;
  let failed = 0;

  for (const guild of interaction.client.guilds.cache.values()) {
    try {
      const record = await guildRecord(guild.id);
      const owner = await interaction.client.users.fetch(guild.ownerId).catch(() => null);
      if (!owner) { failed += 1; continue; }

      await owner.send({
        embeds: [
          baseEmbed()
            .setTitle(`CenterSide ${version} is available`)
            .setDescription([
              `Your server **${guild.name}** is running an older build.`,
              '',
              'Run **/update** in that server and the bot pulls the latest code itself.',
              '',
              'Settings, panels, saved answers and tickets are kept.',
            ].join('\n')),
        ],
      }).catch(() => { failed += 1; });

      record.settings.notifiedVersion = version;
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  await save();
  return interaction.editReply({ content: `Notified ${sent} server owner(s) about ${version}${failed ? `, ${failed} could not be reached` : ''}.` });
}

async function handleUpdate(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { runUpdate } = require('./update');
    const written = await runUpdate();
    await interaction.editReply({
      content: `Updated ${written.length} file(s) from GitHub:\n${written.map((f) => `\`src/${f}\``).join(', ')}\n\nYour settings, saved answers and tickets were not touched. Restarting…`,
    });

    const shouldRestart = Boolean(process.env.PORT) || String(process.env.AUTO_RESTART || '').toLowerCase() === 'true';
    if (shouldRestart) setTimeout(() => process.exit(0), 1500);
    else await interaction.followUp({ content: 'Running locally — restart the bot to load the new code.', flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[update]', err);
    await interaction.editReply({ content: `Update failed: ${err.message}` });
  }
}

async function handleJoinCommand(interaction) {
  try { web.start(); } catch (err) { console.warn('[web] start failed:', err.message); }

  const oauthReady = Boolean(process.env.DISCORD_CLIENT_SECRET
    && process.env.AUTOJOIN_GUILD_ID
    && process.env.WEB_BASE);

  if (oauthReady) {
    const url = web.authorizeUrl();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Authorise and join')
        .setEmoji('➡️')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    );
    return reply(interaction, `Authorise the app and you are added automatically:\n${url}`, { components: [row] });
  }

  // No public URL for the OAuth callback: hand out a permanent invite instead.
  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  let invite = process.env.INVITE_URL || settings.inviteUrl || null;

  if (!invite) {
    const me = interaction.guild.members.me;
    const channel = interaction.guild.channels.cache.get(settings.panelChannelId)
      || interaction.guild.channels.cache.find((c) => c.type === ChannelType.GuildText
        && c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite));

    if (channel) {
      const created = await interaction.guild.invites.create(channel.id, {
        maxAge: 0,
        maxUses: 0,
        unique: false,
        reason: 'CenterSide join link',
      }).catch(() => null);
      if (created) {
        invite = created.url;
        settings.inviteUrl = invite;
        await save();
      }
    }
  }

  if (!invite) {
    return reply(interaction, 'I could not create an invite — give me **Create Invite** in a channel and try again, or set `INVITE_URL` on the bot host.');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Join the server')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Link)
      .setURL(invite),
  );

  return reply(interaction, `Here is the invite:\n${invite}`, { components: [row] });
}

async function handleDescribe(interaction) {
  const record = await guildRecord(interaction.guildId);
  const existing = await loadPack();

  const status = record.settings.describedAt
    ? `Description on file (saved <t:${Math.floor(record.settings.describedAt / 1000)}:R>) with ${existing.answers.length} saved answer${existing.answers.length === 1 ? '' : 's'}. You can rewrite it any time.`
    : 'Nothing saved yet — this is the first thing the bot needs.';

  return promptDescribe(interaction, status);
}

async function handlePanel(interaction) {
  try {
    const record = await guildRecord(interaction.guildId);
    const lanes = lanesFor(record.settings);

    // Preferred path: let them edit the lanes first.
    {
      try {
        const modal = new ModalBuilder().setCustomId('panel:lanes').setTitle('Ticket options');
        const inputs = [];
        for (let i = 0; i < 5; i += 1) {
          inputs.push(new TextInputBuilder()
            .setCustomId(`lane${i}`)
            .setLabel(`Option ${i + 1}`)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(45)
            .setRequired(false)
            .setValue(''));
        }
        modal.addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));
        await interaction.showModal(modal);
        return;
      } catch (modalError) {
        console.error('[panel] modal failed, posting panel directly:', modalError.message);
      }
    }

    // Fallback: post the panel with the lanes we already have.
    const channel = interaction.channel
      || await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return reply(interaction, 'I cannot post here. Run `/panel` in a normal text channel.');
    }

    const me = interaction.guild.members?.me;
    const perms = me ? channel.permissionsFor(me) : null;
    const missing = [];
    if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push('Send Messages');
    if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missing.push('Embed Links');
    if (missing.length) {
      return reply(interaction, `I cannot post in <#${channel.id}> — I am missing **${missing.join('** and **')}** there. Fix the channel permissions, or run \`/panel\` somewhere else.`);
    }

    const sent = await channel.send(panelMessage(lanes));
    record.settings.panelChannelId = channel.id;
    record.settings.panelMessageId = sent.id;
    await save();

    return reply(interaction, `Panel posted in <#${channel.id}>. Options: ${lanes.map((l) => l.label).join(', ') || 'defaults'}.`);
  } catch (err) {
    console.error('[panel]', err);
    return reply(interaction, `Panel failed: ${err.message}`);
  }
}

async function confirmPanel(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const labels = [];
  for (let i = 0; i < 5; i += 1) {
    const value = interaction.fields.getTextInputValue(`lane${i}`).trim();
    if (value) labels.push(value.slice(0, 45));
  }

  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  settings.lanes = labels.map((label) => ({
    label,
    value: slugify(label),
    description: '',
  }));

  const lanes = lanesFor(settings);
  const channel = interaction.channel
    || await interaction.client.channels.fetch(interaction.channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return interaction.editReply({ content: 'I cannot post here — run `/panel` in a normal text channel.' });
  }

  const me = interaction.guild.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (perms && (!perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks))) {
    return interaction.editReply({ content: `I cannot post in <#${channel.id}> — I need **Send Messages** and **Embed Links** there.` });
  }

  const sent = await channel.send(panelMessage(lanes));
  settings.panelChannelId = channel.id;
  settings.panelMessageId = sent.id;
  await save();

  return interaction.editReply({
    content: [
      `Panel posted in <#${channel.id}>.`,
      '',
      `Options: ${lanes.map((l) => `**${l.label}**`).join(', ')}`,
      '',
      'Run `/panel` again anywhere to change them.',
    ].join('\n'),
  });
}

/* ------------------------------------------------------------------ */
/* /answer  /answers                                                   */
/* ------------------------------------------------------------------ */

async function handleWelcome(interaction) {
  if (!(await ensureDescribed(interaction))) return;
  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  if (interaction.options.getBoolean('off')) {
    settings.welcomeEnabled = false;
    await save();
    return reply(interaction, 'Welcome messages are off. Run `/welcome` again to turn them back on.');
  }

  const channelOption = interaction.options.getChannel('channel');
  const message = interaction.options.getString('message');

  let channel = channelOption
    || (settings.welcomeChannelId ? interaction.guild.channels.cache.get(settings.welcomeChannelId) : null)
    || interaction.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === 'welcome',
    );

  if (!channel) {
    channel = await interaction.guild.channels.create({
      name: 'welcome',
      type: ChannelType.GuildText,
      topic: 'New members land here',
      reason: 'CenterSide welcome setup',
    });
  }

  settings.welcomeChannelId = channel.id;
  settings.welcomeEnabled = true;
  if (message) settings.welcomeMessage = message;
  if (!settings.welcomeMessage) settings.welcomeMessage = '';
  await save();

  const preview = welcomeEmbed(interaction.member, settings, interaction.guild);

  return reply(interaction, `Welcome messages will post in <#${channel.id}>. Preview:`, {
    embeds: [preview],
  });
}

/** Fired on guildMemberAdd. */
async function handleMemberJoin(member) {
  if (!member || member.user.bot) return;

  const record = await guildRecord(member.guild.id);
  const settings = record.settings;
  if (!settings.welcomeEnabled || !settings.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId)
    || await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [welcomeEmbed(member, settings, member.guild)],
    allowedMentions: { parse: [] },
  }).catch((err) => {
    console.warn(`[welcome] failed for ${member.guild.id}: ${err.message}`);
  });
}

/* ------------------------------------------------------------------ */
/* /stats                                                              */
/* ------------------------------------------------------------------ */

async function handleStats(interaction) {
  if (!(await ensureDescribed(interaction))) return;
  const record = await guildRecord(interaction.guildId);
  const history = record.history || [];
  const open = Object.values(record.tickets || {});

  const closeTimes = history.filter((t) => t.closedAt && t.openedAt).map((t) => t.closedAt - t.openedAt);
  const avgMs = closeTimes.length ? closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length : 0;

  const byCategory = new Map();
  for (const ticket of history) byCategory.set(ticket.category, (byCategory.get(ticket.category) || 0) + 1);

  const byStaff = new Map();
  for (const ticket of history) {
    if (!ticket.claimedBy) continue;
    byStaff.set(ticket.claimedBy, (byStaff.get(ticket.claimedBy) || 0) + 1);
  }
  const leaderboard = [...byStaff.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => `<@${id}> — ${count}`)
    .join('\n') || 'no claims yet';

  const embed = baseEmbed()
    .setTitle('CenterSide stats')
    .addFields(
      { name: 'Open now', value: String(open.length), inline: true },
      { name: 'Closed all time', value: String(history.length), inline: true },
      { name: 'Avg. resolution', value: avgMs ? `${(avgMs / 3_600_000).toFixed(1)}h` : '—', inline: true },
      { name: 'By lane', value: [...byCategory.entries()].map(([k, v]) => `${k}: ${v}`).join('\n') || '—' },
      { name: 'Staff leaderboard', value: leaderboard },
    );

  return reply(interaction, '', { embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* components + modals                                                 */
/* ------------------------------------------------------------------ */

async function handlePanelSelect(interaction) {
  const record = await guildRecord(interaction.guildId);
  if (!record.settings.describedAt) {
    return reply(interaction, 'This server has not finished setup yet — an admin needs to run `/describe` once.');
  }

  const lanes = lanesFor(record.settings);
  const category = interaction.values[0];
  const lane = lanes.find((c) => c.value === category);
  if (!lane) {
    return reply(interaction, 'That lane is no longer available — the panel may have been updated.');
  }

  // Ask the configured questions before the channel exists. The modal must be
  // the first response, so nothing is deferred here.
  const questions = intakeQuestions(record.settings);
  const modal = new ModalBuilder()
    .setCustomId(`panel:intake:${category}`)
    .setTitle(lane.label.slice(0, 45));

  questions.forEach((question, index) => {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(`q${index}`)
        .setLabel(question.slice(0, 45))
        .setStyle(index === 0 ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setMaxLength(index === 0 ? 500 : 200)
        .setRequired(true),
    ));
  });

  return interaction.showModal(modal);
}

async function handleIntake(interaction) {
  const lane = interaction.customId.split(':')[2];

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const record = await guildRecord(interaction.guildId);
  const questions = intakeQuestions(record.settings);
  const answers = questions.map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue(`q${index}`).trim(),
  }));

  const pack = await loadPack();
  const laneConfig = lanesFor(record.settings).find((entry) => entry.value === lane);
  const result = await openTicket({
    guild: interaction.guild,
    member: interaction.member,
    category: lane,
    pack,
    laneLabel: laneConfig ? laneConfig.label : lane,
  });

  if (result.error) return interaction.editReply({ content: result.error });

  const ticket = result.ticket;
  ticket.intake = answers;
  await save();

  await result.channel.send({
    embeds: [
      baseEmbed()
        .setColor(color.brand)
        .setTitle('Ticket answers')
        .addFields(answers.map((entry, index) => ({
          name: entry.question.slice(0, 256),
          value: entry.answer.slice(0, 1024) || '—',
          inline: index > 0,
        }))),
    ],
  }).catch(() => {});

  const digest = answers.map((a) => `${a.question} ${a.answer}`).join(' | ');

  await answerIntake({
    channel: result.channel,
    ticket,
    pack,
    settings: record.settings,
    guild: interaction.guild,
    memberName: interaction.member?.displayName || interaction.user.username,
    reason: digest,
    urgency: answers[1] ? answers[1].answer : '',
  }).catch((err) => console.error('[intake] answer failed:', err.message));

  return interaction.editReply({ content: `Ticket opened: <#${result.channel.id}>` });
}

async function answerIntake({ channel, ticket, pack, settings, guild, memberName, reason, urgency }) {
  pushHistory(channel.id, 'user', reason);

  let text = null;
  const provider = await ai.describeProvider();
  if (provider) {
    await channel.sendTyping().catch(() => {});
    const serverMap = await serverInfo.snapshot(guild);
    text = await ai.complete({
      system: systemPrompt(pack, ticket, settings, serverMap, `This is a new ticket. The member already answered the intake form: "${reason}" (urgency: ${urgency}).`),
      messages: getHistory(channel.id),
      maxTokens: 180,
    });
    if (text && /^\s*ESCALATE\b/i.test(text.trim())) text = null;
  }

  if (!text) {
    const replyResult = nextReply({ pack, ticket, text: `${reason} ${urgency}`, memberName });
    text = replyResult.text;
    if (replyResult.mode === 'escalate') {
      const mention = (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ');
      await channel.send({ content: mention || undefined, embeds: [baseEmbed().setColor(color.warn).setTitle('Needs a human').setDescription(replyResult.text)] }).catch(() => {});
      return;
    }
  }

  ticket.autoAnswered = true;
  await save();
  pushHistory(channel.id, 'assistant', text);
  await channel.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
}

async function handleTicketButton(interaction) {
  const action = interaction.customId.split(':')[1];
  const settings = await settingsFor(interaction.guildId);
  const record = await guildRecord(interaction.guildId);
  const ticket = record.tickets[interaction.channelId];

  if (!ticket) return reply(interaction, 'This channel is not an open ticket.');

  if (action === 'claim') {
    const denied = staffOnly(interaction.member, settings);
    if (denied) return reply(interaction, denied);
    const result = await claimTicket(interaction.channel, interaction.user);
    if (result.error) return reply(interaction, result.error);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel(`Claimed by ${interaction.user.username}`).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('ticket:escalate').setLabel('Escalate').setEmoji('🚨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    );
    await interaction.message.edit({ components: [row] }).catch(() => {});
    return interaction.reply({ content: `Claimed by <@${interaction.user.id}>.`, allowedMentions: { parse: [] } });
  }

  if (action === 'add') {
    const denied = staffOnly(interaction.member, settings);
    if (denied) return reply(interaction, denied);

    const modal = new ModalBuilder().setCustomId('ticket:addmember').setTitle('Add someone to this ticket');
    const input = new TextInputBuilder()
      .setCustomId('member')
      .setLabel('Member id or @mention')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === 'escalate') {
    const denied = staffOnly(interaction.member, settings);
    if (denied) return reply(interaction, denied);
    ticket.escalated = true;
    await save();
    const mention = (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ');
    await interaction.channel.send({
      content: mention || undefined,
      embeds: [
        baseEmbed()
          .setColor(color.danger)
          .setTitle(`Ticket #${ticket.number} escalated`)
          .setDescription(`Escalated by <@${interaction.user.id}>.`),
      ],
    });
    return reply(interaction, 'Escalated.');
  }

  if (action === 'close') {
    const isOpener = interaction.user.id === ticket.userId;
    if (!isOpener && !isStaff(interaction.member, settings)) {
      return reply(interaction, 'Only the opener or staff can close this ticket.');
    }
    await reply(interaction, 'Closing and archiving this ticket…');
    await closeTicket(interaction.channel, interaction.user, 'Closed via panel button');
    return;
  }

  return reply(interaction, 'Unknown action.');
}

async function handleModal(interaction) {
  if (interaction.customId === 'describe:form') return saveDescribeModal(interaction);
  if (interaction.customId === 'setup:intake') return confirmSetup(interaction);
  if (interaction.customId === 'panel:lanes') return confirmPanel(interaction);
  if (interaction.customId.startsWith('panel:intake:')) return handleIntake(interaction);

  if (interaction.customId === 'ticket:addmember') {
    const raw = interaction.fields.getTextInputValue('member').trim();
    const id = raw.replace(/[^0-9]/g, '');

    const record = await guildRecord(interaction.guildId);
    const settings = record.settings;
    const ticket = record.tickets[interaction.channelId];
    if (!ticket) return reply(interaction, 'This channel is not an open ticket.');
    if (!isStaff(interaction.member, settings)) return reply(interaction, staffOnly(interaction.member, settings));

    if (!id) return reply(interaction, 'That does not look like a member id or mention.');
    if (id === ticket.userId) return reply(interaction, 'The opener is already in this ticket.');

    await interaction.channel.permissionOverwrites.edit(id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    return reply(interaction, `Added <@${id}> to ticket #${ticket.number}.`);
  }

  if (interaction.customId === 'knowledge:add') {
    const question = interaction.fields.getTextInputValue('question').trim();
    const answer = interaction.fields.getTextInputValue('answer').trim();
    const id = await updatePack((pack) => addAnswer(pack, question, answer));
    return reply(interaction, `Saved as \`${id}\`. Test it with \`/knowledge test\`.`);
  }

  return reply(interaction, 'Unknown form.');
}

/* ------------------------------------------------------------------ */
/* auto-answer                                                         */
/* ------------------------------------------------------------------ */

async function handleTicketMessage(message, pack) {
  if (message.author.bot || !message.guildId) return;

  const record = await guildRecord(message.guildId);
  let ticket = record.tickets[message.channelId];

  // A ticket channel the bot lost track of (state write dropped, bot restarted
  // mid-creation) used to make the bot go silent. Adopt it from the channel topic.
  if (!ticket) {
    const topic = message.channel.topic || '';
    const parsed = topic.match(/Ticket #(\d+) · ([^·]+) ·.*\((\d+)\)/);
    if (!parsed) {
      console.log(`[auto-answer] ignored #${message.channel.name}: not a tracked ticket`);
      return;
    }
    ticket = {
      id: message.channelId,
      number: Number(parsed[1]),
      userId: parsed[3],
      category: parsed[2].trim(),
      status: 'open',
      claimedBy: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      escalated: false,
      notes: [],
    };
    record.tickets[message.channelId] = ticket;
    await save();
    console.log(`[auto-answer] adopted #${message.channel.name} as ticket #${ticket.number}`);
  }

  if (ticket.status === 'closed') return;

  // Any new message means the ticket is still alive.
  clearPendingClose(message.channelId);

  const settings = record.settings;
  ticket.lastActivity = Date.now();
  await save();

  const isOpener = message.author.id === ticket.userId;

  // Staff replying means no answer from me. The opener can be staff too (owners
  // test their own desk), so opener messages still get an answer.
  if (isStaff(message.member, settings) && !isOpener) {
    if (!ticket.aiPaused) {
      ticket.aiPaused = true;
      ticket.aiPausedBy = message.author.id;
      await save();
      console.log(`[ticket] #${ticket.number} staff arrived (${message.author.username}) — AI paused`);
      await message.channel.send({
        embeds: [
          baseEmbed()
            .setColor(color.quiet)
            .setDescription(`<@${message.author.id}> is here — I'll stay quiet and leave this to staff.`),
        ],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    pushHistory(message.channelId, 'assistant', `(staff ${message.author.username} replied)`);
    await save();
    return;
  }

  if (!settings.autoAnswer) {
    console.log(`[auto-answer] skipped #${ticket.number}: autoanswer is off`);
    return;
  }
  if (!isOpener) return;
  if (ticket.claimedBy) {
    console.log(`[auto-answer] skipped #${ticket.number}: claimed by ${ticket.claimedBy}`);
    return;
  }

  if (ticket.aiPaused) {
    console.log(`[auto-answer] skipped #${ticket.number}: staff are handling it`);
    return;
  }

  const last = autoReplyAt.get(message.channelId) || 0;
  if (Date.now() - last < autoReplyCooldownMs) {
    console.log(`[auto-answer] skipped #${ticket.number}: cooldown`);
    return;
  }

  const text = (message.content || '').trim();
  if (!text) {
    console.log(`[auto-answer] #${ticket.number} empty content — is the Message Content intent on?`);
    return;
  }
  console.log(`[auto-answer] #${ticket.number} received ${text.length} chars`);

  // The opener can close their own ticket by simply asking.
  if (isOpener && /^(?:please\s+)?(?:close|close\s+(?:this|the)?\s*ticket|close\s+this|done|that'?s\s+all|resolved|you\s+can\s+close(?:\s+it)?|no\s+longer\s+needed)\b/i.test(text)) {
    console.log(`[ticket] #${ticket.number} opener asked to close`);
    autoReplyAt.set(message.channelId, Date.now());
    clearPendingClose(message.channelId);
    await safeReply(message, 'Closing this ticket and saving the transcript. Thanks for the detail — reopen any time.');
    await closeTicket(message.channel, message.author, 'Closed at the opener\'s request');
    return;
  }

  const thanks = /\b(thanks|thank you|ty|that worked|it worked|fixed|solved|sorted|got it|all good)\b/i.test(text);
  if (thanks && ticket.autoAnswered) {
    autoReplyAt.set(message.channelId, Date.now());
    ticket.autoAttempts = 0;
    await save();
    pushHistory(message.channelId, 'user', text);
    pushHistory(message.channelId, 'assistant', 'acknowledged the resolution');
    console.log(`[auto-answer] #${ticket.number} resolved by member — closing in ${resolvedCloseSeconds}s`);
    await safeReply(
      message,
      `Glad that's sorted. I'll close this ticket in ${resolvedCloseSeconds} seconds and file the transcript — say anything before then if you need more.`,
    );
    scheduleResolvedClose(message.channel, ticket);
    return;
  }

  pushHistory(message.channelId, 'user', text);
  autoReplyAt.set(message.channelId, Date.now());

  // "Where is the panel" is a fact, not a writing task. Answer it from config so
  // the model cannot name a channel it merely saw in the map.
  const panelQuestion = /(where.{0,25}(panel|ticket)|how (do|can|would) (i|you) (open|make|create|start)|open a ticket|ticket panel|tickets channel)/i.test(text);
  if (panelQuestion) {
    const built = await ensurePanelForGuild(message.guild).catch(() => null);
    const link = built ? `https://discord.com/channels/${message.guild.id}/${built.channel.id}/${built.message.id}` : null;

    const answer = built
      ? `Tickets open from the panel in <#${built.channel.id}> — [jump straight to it](${link}). Click the dropdown on that message and pick the lane that fits: ${panelCategories.map((c) => `**${c.label}**`).join(', ')}.`
      : "There is no panel in this server yet — a staff member needs to run `/panel` once and it will appear.";

    ticket.autoAnswered = true;
    await save();
    pushHistory(message.channelId, 'assistant', answer);
    autoReplyAt.set(message.channelId, Date.now());
    console.log(`[auto-answer] #${ticket.number} panel question answered directly`);
    await safeReply(message, answer);
    return;
  }

  // Hard triggers and an explicit request for a person never reach the model.
  const trigger = shouldEscalate(pack, text);
  // "can I report a staff member" is a report, not a hand-off request.
  const wantsHuman = /\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone|staff|mod|admin|agent)\b|\bget\s+me\s+a\s+(?:human|person|staff)\b|\breal\s+person\b|\bhuman\s+(?:please|pls|now)\b/i.test(text);
  if (!pack.about || pack.about.trim().length < 25) {
    ticket.autoAnswered = true;
    await save();
    console.log(`[auto-answer] #${ticket.number} blocked: server not described`);
    const note = 'I have not been told what this server is yet, so I am not going to guess at your answer. An admin needs to run `/describe` once — after that I can help properly.';
    pushHistory(message.channelId, 'assistant', note);
    await safeReply(message, note);
    return;
  }

  const provider = await ai.describeProvider();
  let result = null;

  if (trigger || wantsHuman) {
    result = {
      mode: 'escalate',
      text: trigger
        ? `**That one goes straight to a human.** Anything about ${trigger} is above a bot's pay grade. Staff are being pinged now and the whole thread comes with it.`
        : "Understood — pinging a human now. I've kept everything you told me in the thread so you only have to say it once.",
      escalateReason: trigger || 'member asked for a human',
    };
  } else if (provider) {
    message.channel.sendTyping().catch(() => {});
    const serverMap = await serverInfo.snapshot(message.guild);

    const panelChannel = settings.panelChannelId
      ? message.guild.channels.cache.get(settings.panelChannelId)
      : null;
    const panelLink = panelChannel && settings.panelMessageId
      ? `https://discord.com/channels/${message.guild.id}/${panelChannel.id}/${settings.panelMessageId}`
      : null;
    const ticketCategory = settings.categoryId
      ? message.guild.channels.cache.get(settings.categoryId)
      : null;
    const logChannel = settings.logChannelId
      ? message.guild.channels.cache.get(settings.logChannelId)
      : null;

    const ticketInfo = [
      panelChannel
        ? `The ticket panel — the message where members pick a lane — is posted in #${panelChannel.name} and has NOTHING to do with slash commands. The panel channel name is exactly "${panelChannel.name}" — if you mention it, use that name and that link, not any other channel.`
        : 'No ticket panel has been posted yet; staff need to run /panel in the support channel.',
      panelLink ? `Direct link to the panel: ${panelLink}` : '',
      `Members open a ticket by clicking the dropdown on that panel and picking a lane. The lanes are: ${panelCategories.map((c) => c.label).join(', ')}. Members never run slash commands; only staff do.`,
      'If someone asks how to open a ticket, do not tell them to ask staff — tell them the panel channel and give them the link, or say the panel is being set up if it truly does not exist.',
      ticketCategory ? `New tickets are created under the "${ticketCategory.name}" category.` : '',
      `This conversation is happening in #${message.channel.name}.`,
      logChannel ? `Transcripts are archived in #${logChannel.name}.` : '',
    ].filter(Boolean).join(' ');

    let answer = await ai.complete({
      system: systemPrompt(pack, ticket, settings, serverMap, ticketInfo),
      messages: getHistory(message.channelId),
      maxTokens: 180,
    });

    // A model handing off to a question it can actually answer is worse than a
    // second attempt. Ask again, explicitly without the escape hatch.
    if (answer && /^\s*ESCALATE\b/i.test(answer.trim())) {
      const retry = await ai.complete({
        system: `${systemPrompt(pack, ticket, settings, serverMap, ticketInfo)}

Do not escalate. The member's question is answerable from the server map and ticket context above. Answer it directly in two sentences, naming the exact channel. If it genuinely is not answerable, ask one clarifying question instead.`,
        messages: getHistory(message.channelId),
        maxTokens: 180,
      });
      if (retry && !/^\s*ESCALATE\b/i.test(retry.trim())) answer = retry;
    }

    if (answer && /^ESCALATE\b/i.test(answer.trim())) {
      result = {
        mode: 'escalate',
        text: "I'm going to hand this to a human — they can do things I can't. Pinging staff now, and the whole thread comes with it.",
        escalateReason: 'model decided to hand off',
      };
    } else if (answer) {
      result = { mode: 'answer', text: answer };
    } else {
      console.log(`[auto-answer] #${ticket.number} model unavailable, using built-in engine`);
    }
  }

  if (!result) {
    result = nextReply({ pack, ticket, text, memberName: message.author.username });
  }

  console.log(`[auto-answer] #${ticket.number} mode=${result.mode} engine=${provider ? 'model' : 'builtin'} asked=${(ticket.convo?.asked || []).join(',')}`);

  if (result.mode === 'clarify') {
    ticket.autoAttempts = (ticket.autoAttempts || 0) + 1;
    await save();
    pushHistory(message.channelId, 'assistant', result.text);
    await safeReply(message, result.text);
    return;
  }

  if (result.mode === 'answer') {
    ticket.autoAttempts = 0;
    ticket.autoAnswered = true;
    await save();
    pushHistory(message.channelId, 'assistant', result.text);
    await safeReply(message, result.text);
    return;
  }

  // mode === 'escalate': only now does a human get pulled in.
  ticket.escalated = true;
  ticket.autoAttempts = 0;
  await save();
  pushHistory(message.channelId, 'assistant', result.text);

  const mention = (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ');
  await safeReply(message, result.text);

  await message.channel.send({
    content: mention || undefined,
    embeds: [
      baseEmbed()
        .setColor(color.warn)
        .setTitle(`Ticket #${ticket.number} needs a human`)
        .setDescription(result.escalateReason
          ? `Reason: ${result.escalateReason}`
          : 'The bot ran out of answers.')
        .addFields(
          { name: 'Opener', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Lane', value: String(ticket.category), inline: true },
        ),
    ],
    allowedMentions: { parse: mention ? ['roles'] : [] },
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */

async function route(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'setup': return await handleSetup(interaction);
        case 'edit': return await handleEdit(interaction);
        case 'describe': return await handleDescribe(interaction);
        case 'join': return await handleJoinCommand(interaction);
        case 'update': return await handleUpdate(interaction);
        case 'notify': return await handleNotify(interaction);
        case 'panel': return await handlePanel(interaction);
        case 'welcome': return await handleWelcome(interaction);
        case 'stats': return await handleStats(interaction);
        default: return await reply(interaction, 'Unknown command — the bot may be running an older command set. Re-run `/setup` after the commands refresh.');
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:open') {
      return await handlePanelSelect(interaction);
    }

    if (interaction.isButton() && interaction.customId === 'describe:form') {
      return await describeModal(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketButton(interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleModal(interaction);
    }
  } catch (err) {
    console.error('[interaction]', err);

    // Tell the owner privately — never in the transcript channel, that is for tickets.
    try {
      if (interaction.guild?.ownerId) {
        const owner = await interaction.client.users.fetch(interaction.guild.ownerId).catch(() => null);
        if (owner) {
          const stack = String(err.stack || err).split('\n').slice(0, 5).join('\n').slice(0, 900);
          await owner.send({
            embeds: [
              baseEmbed()
                .setColor(color.danger)
                .setTitle('CenterSide error')
                .setDescription(`\`${interaction.commandName || interaction.customId}\` failed in **${interaction.guild.name}**`)
                .addFields({ name: err.message || 'unknown', value: `\`\`\`${stack}\`\`\`` }),
            ],
          }).catch(() => {});
        }
      }
    } catch { /* reporting must never throw */ }
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const detail = isAdmin ? `\n\n\`${err.message || err}\`` : '';
    const message = `Something broke on the bench. The error is in the console — try again, or close and reopen the ticket.${detail}`;
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ...EPHEMERAL });
      else await interaction.reply({ content: message, ...EPHEMERAL });
    } catch { /* interaction already gone */ }
  }
}

module.exports = { route, handleTicketMessage, handleMemberJoin, ensurePanelForGuild, openerWantsClose };
