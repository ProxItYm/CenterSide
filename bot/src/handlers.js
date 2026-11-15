'use strict';

const {
  MessageFlags,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { panelCategories, color } = require('./config');
const { panelMessage, baseEmbed, ticketEmbed } = require('./ui');
const {
  openTicket,
  claimTicket,
  closeTicket,
  touchTicket,
  isStaff,
  slaLabel,
} = require('./tickets');
const {
  loadPack,
  updatePack,
  buildAnswer,
  addAnswer,
  removeAnswer,
} = require('./knowledge');
const { guildRecord, settingsFor, save } = require('./state');

const autoReplyAt = new Map();
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function staffOnly(member, settings) {
  if (isStaff(member, settings)) return null;
  return 'Staff only — you need the configured staff role or Manage Server.';
}

async function reply(interaction, content, extra = {}) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ...EPHEMERAL, ...extra });
  }
  return interaction.reply({ content, ...EPHEMERAL, ...extra });
}

/* ------------------------------------------------------------------ */
/* slash commands                                                      */
/* ------------------------------------------------------------------ */

async function handlePanel(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  await channel.send(panelMessage());
  await reply(interaction, `Panel posted in <#${channel.id}>. Members can open tickets from there.`);
}

async function handleTicket(interaction) {
  const sub = interaction.options.getSubcommand();
  const settings = await settingsFor(interaction.guildId);
  const record = await guildRecord(interaction.guildId);
  const ticket = record.tickets[interaction.channelId];

  if (!ticket) {
    return reply(interaction, 'This channel is not an open CenterSide ticket.');
  }

  if (sub === 'close') {
    const isOpener = interaction.user.id === ticket.userId;
    if (!isOpener && !isStaff(interaction.member, settings)) {
      return reply(interaction, 'Only the opener or staff can close this ticket.');
    }
    const reason = interaction.options.getString('reason');
    await reply(interaction, 'Closing and archiving this ticket…');
    return closeTicket(interaction.channel, interaction.user, reason);
  }

  const denied = staffOnly(interaction.member, settings);
  if (denied) return reply(interaction, denied);

  if (sub === 'claim') {
    const result = await claimTicket(interaction.channel, interaction.user);
    if (result.error) return reply(interaction, result.error);
    return reply(interaction, `You claimed ticket #${ticket.number}. The SLA clock is stopped.`);
  }

  if (sub === 'add') {
    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    return reply(interaction, `Added <@${user.id}> to the ticket.`);
  }

  if (sub === 'remove') {
    const user = interaction.options.getUser('user', true);
    if (user.id === ticket.userId) return reply(interaction, 'The opener cannot be removed from their own ticket.');
    await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
    return reply(interaction, `Removed <@${user.id}> from the ticket.`);
  }

  if (sub === 'note') {
    const text = interaction.options.getString('text', true);
    ticket.notes = ticket.notes || [];
    ticket.notes.push({ author: interaction.user.id, text, at: Date.now() });
    await save();

    const logChannelId = settings.logChannelId;
    if (logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId)
        || await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      if (logChannel) {
        await logChannel.send({
          embeds: [
            baseEmbed()
              .setColor(color.quiet)
              .setTitle(`Internal note · ticket #${ticket.number}`)
              .setDescription(text)
              .addFields({ name: 'Author', value: `<@${interaction.user.id}>`, inline: true }),
          ],
        }).catch(() => {});
      }
    }
    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(color.quiet)
          .setDescription(`📝 Internal note from <@${interaction.user.id}> recorded in the log.`),
      ],
    }).catch(() => {});
    return reply(interaction, 'Note saved. It is in the log and the transcript, not visible as text here.');
  }

  if (sub === 'escalate') {
    const reason = interaction.options.getString('reason') || 'No reason given';
    ticket.escalated = true;
    await save();
    const mention = (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ');
    await interaction.channel.send({
      content: mention || undefined,
      embeds: [
        baseEmbed()
          .setColor(color.danger)
          .setTitle(`Ticket #${ticket.number} escalated`)
          .setDescription(`${reason}\n\nEscalated by <@${interaction.user.id}>.`)
          .addFields({ name: 'Opener', value: `<@${ticket.userId}>`, inline: true }),
      ],
    });
    return reply(interaction, 'Escalated.');
  }

  if (sub === 'rename') {
    const name = interaction.options.getString('name', true);
    await interaction.channel.setName(name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90));
    return reply(interaction, 'Renamed.');
  }

  return reply(interaction, 'Unknown subcommand.');
}

async function handleKnowledge(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    const pack = await loadPack();
    const modal = new ModalBuilder()
      .setCustomId('knowledge:setup')
      .setTitle('Server briefing');

    const about = new TextInputBuilder()
      .setCustomId('about')
      .setLabel('What is this server about?')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(700)
      .setRequired(true)
      .setValue(pack.about || '');

    const tone = new TextInputBuilder()
      .setCustomId('tone')
      .setLabel('Tone (Friendly & casual / Professional / Short & blunt / Playful)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(40)
      .setRequired(true)
      .setValue(pack.tone || 'Friendly & casual');

    const hours = new TextInputBuilder()
      .setCustomId('hours')
      .setLabel('Support hours')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(70)
      .setRequired(false)
      .setValue(pack.hours || '');

    const facts = new TextInputBuilder()
      .setCustomId('facts')
      .setLabel('Hard facts it must never get wrong')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setRequired(false)
      .setValue(pack.hardFacts || '');

    const escalate = new TextInputBuilder()
      .setCustomId('escalate')
      .setLabel('Escalate to a human when…')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setRequired(false)
      .setValue(pack.escalateWhen || '');

    modal.addComponents(
      new ActionRowBuilder().addComponents(about),
      new ActionRowBuilder().addComponents(tone),
      new ActionRowBuilder().addComponents(hours),
      new ActionRowBuilder().addComponents(facts),
      new ActionRowBuilder().addComponents(escalate),
    );
    return interaction.showModal(modal);
  }

  if (sub === 'add') {
    const modal = new ModalBuilder().setCustomId('knowledge:add').setTitle('New saved answer');
    const question = new TextInputBuilder()
      .setCustomId('question')
      .setLabel('Question members ask')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(200)
      .setRequired(true);
    const answer = new TextInputBuilder()
      .setCustomId('answer')
      .setLabel('Answer the bot should give')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(900)
      .setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(question),
      new ActionRowBuilder().addComponents(answer),
    );
    return interaction.showModal(modal);
  }

  const pack = await loadPack();

  if (sub === 'list') {
    if (!pack.answers.length) return reply(interaction, 'No saved answers yet. Add one with `/knowledge add`.');
    const lines = pack.answers.map((a) => `\`${a.id}\` — **${a.question}**\n${a.answer.slice(0, 160)}`);
    const chunks = [];
    let current = '';
    for (const line of lines) {
      if ((current + line).length > 3500) {
        chunks.push(current);
        current = '';
      }
      current += `${line}\n\n`;
    }
    if (current) chunks.push(current);

    await reply(interaction, 'Saved answers:');
    for (const chunk of chunks.slice(0, 4)) {
      await interaction.followUp({ content: chunk.slice(0, 1900), ...EPHEMERAL });
    }
    return;
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).trim();
    const removed = await updatePack((packRef) => removeAnswer(packRef, id));
    return reply(interaction, removed ? `Deleted answer \`${id}\`.` : `No answer with id \`${id}\`. Check \`/knowledge list\`.`);
  }

  if (sub === 'test') {
    const question = interaction.options.getString('question', true);
    const settings = await settingsFor(interaction.guildId);
    pack.__sla = slaLabel(settings.slaMinutes);
    const result = buildAnswer(pack, question, interaction.user.username);
    const embed = baseEmbed()
      .setTitle('Reply preview')
      .setDescription(result.text.slice(0, 4096))
      .addFields(
        { name: 'Matched', value: result.matched ? `${result.matched.id} · score ${result.confidence}` : 'none', inline: true },
        { name: 'Escalates', value: result.escalate ? `yes${result.escalateReason ? ` (${result.escalateReason})` : ''}` : 'no', inline: true },
      );
    return reply(interaction, '', { embeds: [embed] });
  }

  if (sub === 'export') {
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(pack, null, 2), 'utf8'), { name: 'centerside-pack.json' });
    return reply(interaction, `Pack: ${pack.answers.length} answers.`, { files: [file] });
  }
}

async function handleConfig(interaction) {
  const sub = interaction.options.getSubcommand();
  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  if (sub === 'view') {
    const embed = baseEmbed()
      .setTitle('CenterSide settings')
      .addFields(
        { name: 'Ticket category', value: settings.categoryId ? `<#${settings.categoryId}>` : 'not set', inline: true },
        { name: 'Log channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set', inline: true },
        { name: 'Auto-answer', value: settings.autoAnswer ? 'on' : 'off', inline: true },
        { name: 'Staff roles', value: (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'none', inline: true },
        { name: 'First-reply SLA', value: settings.slaMinutes ? slaLabel(settings.slaMinutes) : 'off', inline: true },
        { name: 'Auto-close', value: settings.autoCloseHours ? `${settings.autoCloseHours}h` : 'off', inline: true },
      );
    return reply(interaction, '', { embeds: [embed] });
  }

  if (sub === 'category') {
    settings.categoryId = interaction.options.getChannel('category', true).id;
  } else if (sub === 'log') {
    settings.logChannelId = interaction.options.getChannel('channel', true).id;
  } else if (sub === 'staff') {
    const action = interaction.options.getString('action', true);
    const role = interaction.options.getRole('role', true);
    const set = new Set(settings.staffRoleIds || []);
    if (action === 'add') set.add(role.id);
    else set.delete(role.id);
    settings.staffRoleIds = [...set];
  } else if (sub === 'autoanswer') {
    settings.autoAnswer = interaction.options.getBoolean('enabled', true);
  } else if (sub === 'sla') {
    settings.slaMinutes = interaction.options.getInteger('minutes', true);
  } else if (sub === 'autoclose') {
    settings.autoCloseHours = interaction.options.getInteger('hours', true);
  }

  await save();
  return reply(interaction, 'Saved.');
}

async function handleStats(interaction) {
  const record = await guildRecord(interaction.guildId);
  const history = record.history || [];
  const open = Object.values(record.tickets || {});
  const closed = history.length;

  const closeTimes = history
    .filter((t) => t.closedAt && t.openedAt)
    .map((t) => t.closedAt - t.openedAt);
  const avgMs = closeTimes.length ? closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length : 0;

  const byCategory = new Map();
  for (const ticket of history) {
    byCategory.set(ticket.category, (byCategory.get(ticket.category) || 0) + 1);
  }

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

  const avgLabel = avgMs
    ? `${(avgMs / 3_600_000).toFixed(1)}h`
    : '—';

  const embed = baseEmbed()
    .setTitle('CenterSide stats')
    .addFields(
      { name: 'Open now', value: String(open.length), inline: true },
      { name: 'Closed all time', value: String(closed), inline: true },
      { name: 'Avg. resolution', value: avgLabel, inline: true },
      { name: 'By lane', value: [...byCategory.entries()].map(([k, v]) => `${k}: ${v}`).join('\n') || '—' },
      { name: 'Staff leaderboard', value: leaderboard },
    );

  return reply(interaction, '', { embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* components + modals                                                 */
/* ------------------------------------------------------------------ */

async function handlePanelSelect(interaction) {
  const category = interaction.values[0];
  if (!panelCategories.some((c) => c.value === category)) {
    return reply(interaction, 'That category is no longer available.');
  }

  const pack = await loadPack();
  const result = await openTicket({
    guild: interaction.guild,
    member: interaction.member,
    category,
    pack,
  });

  if (result.error) return reply(interaction, result.error);
  return reply(interaction, `Ticket opened: <#${result.channel.id}>. Head there and describe the issue.`);
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
  if (interaction.customId === 'knowledge:setup') {
    const about = interaction.fields.getTextInputValue('about').trim();
    const tone = interaction.fields.getTextInputValue('tone').trim() || 'Friendly & casual';
    const hours = interaction.fields.getTextInputValue('hours').trim();
    const facts = interaction.fields.getTextInputValue('facts').trim();
    const escalate = interaction.fields.getTextInputValue('escalate').trim();

    await updatePack((pack) => {
      pack.server = pack.server || interaction.guild.name;
      pack.about = about;
      pack.tone = tone;
      pack.hours = hours;
      pack.hardFacts = facts;
      pack.escalateWhen = escalate;
    });

    await reply(
      interaction,
      `Briefing saved for **${interaction.guild.name}**. Tone: ${tone}. ` +
      `${hours ? `Hours: ${hours}. ` : ''}Add the questions members ask with \`/knowledge add\`, then test with \`/knowledge test\`.`,
    );
    return;
  }

  if (interaction.customId === 'knowledge:add') {
    const question = interaction.fields.getTextInputValue('question').trim();
    const answer = interaction.fields.getTextInputValue('answer').trim();
    const id = await updatePack((pack) => addAnswer(pack, question, answer));
    await reply(interaction, `Saved as \`${id}\`. Test it with \`/knowledge test question:${question}\`.`);
    return;
  }

  return reply(interaction, 'Unknown form.');
}

/* ------------------------------------------------------------------ */
/* auto-answer                                                         */
/* ------------------------------------------------------------------ */

async function handleTicketMessage(message, pack) {
  if (message.author.bot || !message.guildId) return;

  const record = await guildRecord(message.guildId);
  const ticket = record.tickets[message.channelId];

  // Only touch channels that are actual tickets.
  if (!ticket || ticket.status === 'closed') return;

  const settings = record.settings;
  ticket.lastActivity = Date.now();
  await save();

  const authorIsStaff = isStaff(message.member, settings);
  if (authorIsStaff) {
    // A human replying satisfies the SLA for good.
    ticket.slaSatisfied = true;
    await save();
    return;
  }

  if (!settings.autoAnswer) return;
  if (ticket.userId !== message.author.id) return;
  if (ticket.claimedBy) return;

  const last = autoReplyAt.get(message.channelId) || 0;
  if (Date.now() - last < 20_000) return;

  const text = message.content || '';
  if (text.trim().length < 8) return;

  pack.__sla = slaLabel(settings.slaMinutes);
  const result = buildAnswer(pack, text, message.author.username);
  if (!result.matched && !result.escalate) return;

  autoReplyAt.set(message.channelId, Date.now());
  const mention = result.escalate
    ? (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ')
    : '';

  await message.reply({
    content: result.text.slice(0, 1900),
    allowedMentions: { parse: mention ? ['roles'] : [] },
  }).catch(() => {});

  if (result.escalate) {
    ticket.escalated = true;
    await save();
    await message.channel.send({
      content: mention || undefined,
      embeds: [
        baseEmbed()
          .setColor(color.warn)
          .setTitle('Escalated by the desk')
          .setDescription(result.escalateReason
            ? `Reason: ${result.escalateReason}`
            : 'No approved answer matched — a human should take this one.'),
      ],
      allowedMentions: { parse: mention ? ['roles'] : [] },
    }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */

async function route(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      if (commandName === 'panel') return await handlePanel(interaction);
      if (commandName === 'ticket') return await handleTicket(interaction);
      if (commandName === 'knowledge') return await handleKnowledge(interaction);
      if (commandName === 'config') return await handleConfig(interaction);
      if (commandName === 'stats') return await handleStats(interaction);
      return await reply(interaction, 'Unknown command.');
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:open') {
      return await handlePanelSelect(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
      return await handleTicketButton(interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleModal(interaction);
    }
  } catch (err) {
    console.error('[interaction]', err);
    const message = 'Something broke on the bench. The error is in the console — try again, or close and reopen the ticket.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ...EPHEMERAL });
      else await interaction.reply({ content: message, ...EPHEMERAL });
    } catch { /* interaction already gone */ }
  }
}

module.exports = { route, handleTicketMessage };
