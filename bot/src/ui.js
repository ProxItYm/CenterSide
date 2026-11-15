'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { color, panelCategories } = require('./config');

function baseEmbed() {
  return new EmbedBuilder().setColor(color.brand).setFooter({ text: 'CenterSide' });
}

/** The persistent panel: a select menu plus a rules line. No state needed. */
function panelMessage() {
  const embed = baseEmbed()
    .setTitle('CenterSide support')
    .setDescription(
      [
        'Open a private ticket and a member of staff will be with you.',
        '',
        '**Before you open one**',
        '• Check #rules and the pinned messages — the answer may already be there.',
        '• One issue per ticket. Reply in the ticket instead of opening a second one.',
        '• Never post passwords, tokens or payment details.',
        '',
        'Pick a lane below and the desk does the rest.',
      ].join('\n'),
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('panel:open')
    .setPlaceholder('Choose a ticket category…')
    .addOptions(panelCategories.map((category) => ({
      label: category.label,
      value: category.value,
      description: category.description,
    })));

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

/** Intro embed posted inside a freshly opened ticket. */
function ticketIntro(ticket, pack, openerId) {
  const lane = panelCategories.find((c) => c.value === ticket.category);
  const embed = baseEmbed()
    .setTitle(`${lane ? lane.label : 'Ticket'} · #${ticket.number}`)
    .setDescription(
      [
        `Hi <@${openerId}> — this is your private ticket. Only you, the staff and I can see it.`,
        '',
        'Your answers from the ticket form are below. Add anything else you want in this channel — I answer what I can and pull a human in for the rest.',
        '',
        pack.about ? `**About this server:** ${pack.about}` : '',
        pack.hours ? `**Support hours:** ${pack.hours}` : '',
      ].filter(Boolean).join('\n'),
    )
    .addFields({ name: 'Status', value: 'Open', inline: true });

  return embed;
}

/** Buttons that ride on the intro message. */
function ticketButtons() {
  const claim = new ButtonBuilder()
    .setCustomId('ticket:claim')
    .setLabel('Claim')
    .setEmoji('🙋')
    .setStyle(ButtonStyle.Primary);

  const add = new ButtonBuilder()
    .setCustomId('ticket:add')
    .setLabel('Add user')
    .setEmoji('➕')
    .setStyle(ButtonStyle.Secondary);

  const escalate = new ButtonBuilder()
    .setCustomId('ticket:escalate')
    .setLabel('Escalate')
    .setEmoji('🚨')
    .setStyle(ButtonStyle.Secondary);

  const close = new ButtonBuilder()
    .setCustomId('ticket:close')
    .setLabel('Close')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(claim, add, escalate, close)];
}

function ticketEmbed(ticket, extra = {}) {
  const embed = baseEmbed()
    .setTitle(`Ticket #${ticket.number} · ${ticket.category}`)
    .addFields(
      { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Status', value: ticket.status === 'closed' ? 'Closed' : ticket.claimedBy ? 'Claimed' : 'Open', inline: true },
      { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
    );
  if (extra.description) embed.setDescription(extra.description);
  if (extra.color) embed.setColor(extra.color);
  return embed;
}

/**
 * The welcome embed is built here, not by the user — they only supply a line of
 * text. Everything visual stays consistent across servers.
 */
function welcomeEmbed(member, settings, guild) {
  const fallback = 'Take a look at the rules, grab your roles, and say hi. If you need help, open a ticket.';
  const raw = String(settings.welcomeMessage || fallback).trim();
  const text = raw
    .replaceAll('{server}', guild.name)
    .replaceAll('{count}', String(guild.memberCount))
    .replaceAll('{user}', `<@${member.id}>`);

  return baseEmbed()
    .setColor(color.brand)
    .setTitle(String(settings.welcomeTitle || `Welcome to ${guild.name}`).slice(0, 256))
    .setDescription(`<@${member.id}> — ${text}`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Member', value: `#${guild.memberCount}`, inline: true },
      { name: 'Joined', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();
}

module.exports = {
  baseEmbed,
  panelMessage,
  ticketIntro,
  ticketButtons,
  ticketEmbed,
  welcomeEmbed,
};
