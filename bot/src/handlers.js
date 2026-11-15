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

const { panelCategories, color, autoReplyCooldownMs } = require('./config');
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
const { guildRecord, settingsFor, save } = require('./state');

const autoReplyAt = new Map();
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function staffOnly(member, settings) {
  if (isStaff(member, settings)) return null;
  return 'Staff only — you need the staff role set in `/setup`, or Manage Server.';
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

async function handleSetup(interaction) {
  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  const staffRole = interaction.options.getRole('staff');
  const categoryOption = interaction.options.getChannel('category');
  const logOption = interaction.options.getChannel('log');

  if (staffRole) {
    settings.staffRoleIds = [...new Set([...(settings.staffRoleIds || []), staffRole.id])];
  }
  if (categoryOption) settings.categoryId = categoryOption.id;
  if (logOption) settings.logChannelId = logOption.id;
  await save();

  const pack = await loadPack();
  const modal = new ModalBuilder().setCustomId('setup:brief').setTitle('Tell the bot about your server');

  const about = new TextInputBuilder()
    .setCustomId('about')
    .setLabel('What is this server about?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('A Roblox development community. We sell asset packs and run weekly build jams.')
    .setMaxLength(700)
    .setRequired(true)
    .setValue(pack.about || '');

  const tone = new TextInputBuilder()
    .setCustomId('tone')
    .setLabel('Tone of voice')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Friendly & casual / Professional / Short & blunt / Playful')
    .setMaxLength(40)
    .setRequired(false)
    .setValue(pack.tone || 'Friendly & casual');

  const hours = new TextInputBuilder()
    .setCustomId('hours')
    .setLabel('Support hours')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(70)
    .setRequired(false)
    .setValue(pack.hours || '');

  const escalate = new TextInputBuilder()
    .setCustomId('escalate')
    .setLabel('Hand it to a human when someone mentions…')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('chargeback, legal threat, hacked account')
    .setMaxLength(300)
    .setRequired(false)
    .setValue(pack.escalateWhen || '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(about),
    new ActionRowBuilder().addComponents(tone),
    new ActionRowBuilder().addComponents(hours),
    new ActionRowBuilder().addComponents(escalate),
  );

  await interaction.showModal(modal);
}

async function confirmSetup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const about = interaction.fields.getTextInputValue('about').trim();
  const tone = interaction.fields.getTextInputValue('tone').trim() || 'Friendly & casual';
  const hours = interaction.fields.getTextInputValue('hours').trim();
  const escalate = interaction.fields.getTextInputValue('escalate').trim();

  await updatePack((pack) => {
    pack.server = pack.server || interaction.guild.name;
    pack.about = about;
    pack.tone = tone;
    pack.hours = hours;
    pack.escalateWhen = escalate;
  });

  const record = await guildRecord(interaction.guildId);
  const settings = record.settings;

  const category = await ensureCategory(interaction.guild, settings);
  await ensureLogChannel(interaction.guild, settings, category, settings.staffRoleIds || []);
  await save();

  const pack = await loadPack();

  const embed = baseEmbed()
    .setColor(color.ok)
    .setTitle('CenterSide is set up')
    .setDescription('Everything below was created or saved automatically. Nothing else to configure.')
    .addFields(
      { name: 'Tickets', value: settings.categoryId ? `<#${settings.categoryId}>` : 'not set', inline: true },
      { name: 'Transcripts', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'not set', inline: true },
      { name: 'Staff role', value: (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(', ') || 'everyone with Manage Server', inline: true },
      { name: 'Tone', value: tone, inline: true },
      { name: 'Hours', value: hours || 'not set', inline: true },
      { name: 'Briefing', value: `${pack.about.length} characters saved`, inline: true },
    )
    .setFooter({ text: 'Next: run /panel in your support channel' });

  return interaction.editReply({ embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* /panel                                                              */
/* ------------------------------------------------------------------ */

async function handlePanel(interaction) {
  const settings = await settingsFor(interaction.guildId);
  if (!settings.categoryId) {
    return reply(interaction, 'Run `/setup` first — it creates the ticket category and transcript channel for you.');
  }

  await interaction.channel.send(panelMessage());

  const record = await guildRecord(interaction.guildId);
  record.settings.panelChannelId = interaction.channelId;
  await save();

  return reply(interaction, 'Panel posted. Members pick a lane and get a private channel.');
}

/* ------------------------------------------------------------------ */
/* /answer  /answers                                                   */
/* ------------------------------------------------------------------ */

async function handleAnswer(interaction) {
  const modal = new ModalBuilder().setCustomId('knowledge:add').setTitle('New saved answer');
  const question = new TextInputBuilder()
    .setCustomId('question')
    .setLabel('Question members ask')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('How do I get my purchase role?')
    .setMaxLength(200)
    .setRequired(true);
  const answer = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel('Answer the bot is allowed to give')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(900)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder().addComponents(question),
    new ActionRowBuilder().addComponents(answer),
  );
  return interaction.showModal(modal);
}

async function handleAnswers(interaction) {
  const removeId = interaction.options.getString('remove');

  if (removeId) {
    const removed = await updatePack((pack) => removeAnswer(pack, removeId.trim()));
    return reply(interaction, removed
      ? `Deleted \`${removeId.trim()}\`.`
      : `No answer with id \`${removeId.trim()}\` — run \`/answers\` with no options to see the list.`);
  }

  const pack = await loadPack();
  if (!pack.answers.length) {
    return reply(interaction, 'No saved answers yet. Add one with `/answer`.');
  }

  const lines = pack.answers.map((a) => `\`${a.id}\` — **${a.question}**\n${a.answer.slice(0, 160)}`);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + line).length > 3300) {
      chunks.push(current);
      current = '';
    }
    current += `${line}\n\n`;
  }
  if (current) chunks.push(current);

  await reply(interaction, `Saved answers (${pack.answers.length}):`);
  for (const chunk of chunks.slice(0, 4)) {
    await interaction.followUp({ content: chunk.slice(0, 1900), ...EPHEMERAL });
  }
  return;
}


/* ------------------------------------------------------------------ */
/* /welcome                                                            */
/* ------------------------------------------------------------------ */

async function handleWelcome(interaction) {
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
  const category = interaction.values[0];
  if (!panelCategories.some((c) => c.value === category)) {
    return reply(interaction, 'That lane is no longer available.');
  }

  // Channel creation + intro + pin can exceed Discord's 3s interaction window.
  // Defer first, then answer through editReply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const pack = await loadPack();
  const result = await openTicket({
    guild: interaction.guild,
    member: interaction.member,
    category,
    pack,
  });

  if (result.error) return interaction.editReply({ content: result.error });
  return interaction.editReply({ content: `Ticket opened: <#${result.channel.id}>. Head there and describe the issue.` });
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
  if (interaction.customId === 'setup:brief') return confirmSetup(interaction);

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
  const ticket = record.tickets[message.channelId];
  if (!ticket || ticket.status === 'closed') return;

  const settings = record.settings;
  ticket.lastActivity = Date.now();
  await save();

  const isOpener = message.author.id === ticket.userId;

  // Staff replying means no answer from me. The opener can be staff too (owners
  // test their own desk), so opener messages still get an answer.
  if (isStaff(message.member, settings) && !isOpener) {
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

  const last = autoReplyAt.get(message.channelId) || 0;
  if (Date.now() - last < autoReplyCooldownMs) {
    console.log(`[auto-answer] skipped #${ticket.number}: cooldown`);
    return;
  }

  const text = (message.content || '').trim();
  if (!text) return;

  const thanks = /\b(thanks|thank you|ty|that worked|it worked|fixed|solved|sorted|got it|all good)\b/i.test(text);
  if (thanks && ticket.autoAnswered) {
    autoReplyAt.set(message.channelId, Date.now());
    ticket.autoAttempts = 0;
    await save();
    pushHistory(message.channelId, 'user', text);
    pushHistory(message.channelId, 'assistant', 'acknowledged the resolution');
    console.log(`[auto-answer] #${ticket.number} resolved by member`);
    await message.reply({
      content: "Glad that's sorted. If anything else comes up, just reply here — I'll keep this open until you're done.",
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return;
  }

  pushHistory(message.channelId, 'user', text);
  autoReplyAt.set(message.channelId, Date.now());

  // Hard triggers and an explicit request for a person never reach the model.
  const trigger = shouldEscalate(pack, text);
  // "can I report a staff member" is a report, not a hand-off request.
  const wantsHuman = /\b(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone|staff|mod|admin|agent)\b|\bget\s+me\s+a\s+(?:human|person|staff)\b|\breal\s+person\b|\bhuman\s+(?:please|pls|now)\b/i.test(text);
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
    await message.channel.sendTyping().catch(() => {});
    const serverMap = await serverInfo.snapshot(message.guild);

    const panelChannel = settings.panelChannelId
      ? message.guild.channels.cache.get(settings.panelChannelId)
      : null;
    const ticketCategory = settings.categoryId
      ? message.guild.channels.cache.get(settings.categoryId)
      : null;
    const logChannel = settings.logChannelId
      ? message.guild.channels.cache.get(settings.logChannelId)
      : null;

    const ticketInfo = [
      panelChannel
        ? `The ticket panel — the message where members pick a lane — is posted in #${panelChannel.name}.`
        : 'No ticket panel has been posted yet; staff need to run /panel in the support channel.',
      'Members open a ticket by picking a lane from that panel dropdown. They do not run slash commands; only staff use commands.',
      ticketCategory ? `New tickets are created under the "${ticketCategory.name}" category.` : '',
      `This conversation is happening in #${message.channel.name}.`,
      logChannel ? `Transcripts are archived in #${logChannel.name}.` : '',
    ].filter(Boolean).join(' ');

    let answer = await ai.complete({
      system: systemPrompt(pack, ticket, settings, serverMap, ticketInfo),
      messages: getHistory(message.channelId),
      maxTokens: 240,
    });

    // A model handing off to a question it can actually answer is worse than a
    // second attempt. Ask again, explicitly without the escape hatch.
    if (answer && /^\s*ESCALATE\b/i.test(answer.trim())) {
      const retry = await ai.complete({
        system: `${systemPrompt(pack, ticket, settings, serverMap, ticketInfo)}

Do not escalate. The member's question is answerable from the server map and ticket context above. Answer it directly in two sentences, naming the exact channel. If it genuinely is not answerable, ask one clarifying question instead.`,
        messages: getHistory(message.channelId),
        maxTokens: 240,
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
    await message.reply({ content: result.text, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  if (result.mode === 'answer') {
    ticket.autoAttempts = 0;
    ticket.autoAnswered = true;
    await save();
    pushHistory(message.channelId, 'assistant', result.text);
    await message.reply({ content: result.text, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  // mode === 'escalate': only now does a human get pulled in.
  ticket.escalated = true;
  ticket.autoAttempts = 0;
  await save();
  pushHistory(message.channelId, 'assistant', result.text);

  const mention = (settings.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ');
  await message.reply({ content: result.text, allowedMentions: { parse: [] } }).catch(() => {});

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
        case 'panel': return await handlePanel(interaction);
        case 'answer': return await handleAnswer(interaction);
        case 'answers': return await handleAnswers(interaction);
        case 'welcome': return await handleWelcome(interaction);
        case 'stats': return await handleStats(interaction);
        default: return await reply(interaction, 'Unknown command — the bot may be running an older command set. Re-run `/setup` after the commands refresh.');
      }
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

module.exports = { route, handleTicketMessage, handleMemberJoin };
