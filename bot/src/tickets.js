'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');

const { color } = require('./config');
const { guildRecord, save } = require('./state');
const { createTranscript } = require('./transcript');
const { baseEmbed, ticketIntro, ticketButtons, ticketEmbed } = require('./ui');

function isStaff(member, settings) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return (settings.staffRoleIds || []).some((roleId) => member.roles.cache.has(roleId));
}

/** Creates the private channel and records the ticket. */
async function openTicket({ guild, member, category, pack, laneLabel = '' }) {
  const record = await guildRecord(guild.id);
  const settings = record.settings;

  if (!settings.categoryId) {
    return { error: 'No ticket category is configured. An admin needs to run `/config category`.' };
  }

  const categoryChannel = guild.channels.cache.get(settings.categoryId)
    || await guild.channels.fetch(settings.categoryId).catch(() => null);
  if (!categoryChannel) {
    return { error: 'The configured ticket category no longer exists. Run `/config category` again.' };
  }

  record.counter += 1;
  const number = record.counter;
  const safeCategory = String(category).slice(0, 24).replace(/[^a-z0-9-]/gi, '');

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    ...(settings.staffRoleIds || []).map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    })),
  ];

  const channel = await guild.channels.create({
    name: `${safeCategory || 'ticket'}-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: categoryChannel.id,
    topic: `Ticket #${number} · ${category} · opener ${member.user.tag} (${member.id})`,
    permissionOverwrites: overwrites,
    reason: `CenterSide ticket #${number} opened by ${member.user.tag}`,
  });

  const ticket = {
    id: channel.id,
    number,
    userId: member.id,
    category,
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    escalated: false,
    notes: [],
  };
  record.tickets[channel.id] = ticket;
  await save();

  const intro = await channel.send({
    content: `<@${member.id}>`,
    embeds: [ticketIntro(ticket, pack, member.id, laneLabel)],
    components: ticketButtons(),
  });
  await intro.pin().catch(() => {});

  return { ticket, channel };
}

async function touchTicket(channelId, patch = {}) {
  const channel = await globalClientChannel(channelId);
  if (!channel) return null;
  const record = await guildRecord(channel.guild.id);
  const ticket = record.tickets[channelId];
  if (!ticket) return null;
  Object.assign(ticket, patch, { lastActivity: Date.now() });
  await save();
  return ticket;
}

/* Resolved lazily so tickets.js does not need the client at import time. */
let clientRef = null;
function setClient(client) {
  clientRef = client;
}
async function globalClientChannel(channelId) {
  if (!clientRef) return null;
  return clientRef.channels.cache.get(channelId)
    || clientRef.channels.fetch(channelId).catch(() => null);
}

async function claimTicket(channel, member) {
  const record = await guildRecord(channel.guild.id);
  const ticket = record.tickets[channel.id];
  if (!ticket) return { error: 'This channel is not a tracked ticket.' };
  if (ticket.status === 'closed') return { error: 'This ticket is already closed.' };
  if (ticket.claimedBy === member.id) return { error: 'You already claimed this ticket.' };
  if (ticket.claimedBy) return { error: `Already claimed by <@${ticket.claimedBy}>.` };

  ticket.claimedBy = member.id;
  ticket.status = 'claimed';
  await save();
  return { ticket };
}

async function closeTicket(channel, closer, reason) {
  const record = await guildRecord(channel.guild.id);
  const ticket = record.tickets[channel.id];
  if (!ticket) return { error: 'This channel is not a tracked ticket.' };
  if (ticket.status === 'closed') return { error: 'This ticket is already closed.' };

  const transcript = await createTranscript(channel, ticket, channel.guild.name).catch(() => null);
  const file = transcript
    ? new AttachmentBuilder(transcript.text, { name: transcript.textName })
    : null;

  ticket.status = 'closed';
  ticket.closedAt = Date.now();
  ticket.closedBy = closer.id;
  ticket.closeReason = reason || null;

  record.history.push({
    number: ticket.number,
    category: ticket.category,
    userId: ticket.userId,
    claimedBy: ticket.claimedBy,
    openedAt: ticket.createdAt,
    closedAt: ticket.closedAt,
    closedBy: closer.id,
    reason: ticket.closeReason,
    notes: ticket.notes,
  });
  delete record.tickets[channel.id];
  await save();

  const logChannelId = record.settings.logChannelId;
  if (logChannelId) {
    const logChannel = channel.guild.channels.cache.get(logChannelId)
      || await channel.guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel) {
      const mins = Math.max(1, Math.round((Date.now() - ticket.createdAt) / 60000));
      const intake = Array.isArray(ticket.intake)
        ? ticket.intake.map((entry) => `**${entry.question}** ${entry.answer || '—'}`).join('\n').slice(0, 900)
        : ticket.intake
          ? Object.entries(ticket.intake).map(([k, v]) => `**${k}** ${v}`).join('\n')
          : '—';

      const embed = baseEmbed()
        .setColor(color.ok)
        .setTitle(`#${ticket.number} · ${String(ticket.category)} closed`)
        .setDescription([
          `**Opened by** <@${ticket.userId}>`,
          `**Closed by** <@${closer.id}>`,
          ticket.claimedBy ? `**Claimed by** <@${ticket.claimedBy}>` : '',
          `**Time open** ${mins} min`,
          reason ? `**Reason** ${reason}` : '',
          '',
          '**What they asked**',
          intake,
        ].filter(Boolean).join('\n'))
        .setFooter({ text: `${transcript ? transcript.count : 0} messages · transcript attached` });

      if (ticket.notes && ticket.notes.length) {
        embed.addFields({
          name: 'Staff notes',
          value: ticket.notes.map((n) => `• <@${n.author}>: ${n.text}`).join('\n').slice(0, 1024),
        });
      }

      await logChannel.send({ embeds: [embed], files: file ? [file] : [] }).catch(() => {});
    }
  }

  const opener = await channel.guild.members.fetch(ticket.userId).catch(() => null);
  if (opener && transcript) {
    await opener.send({
      embeds: [
        baseEmbed()
          .setColor(color.ok)
          .setTitle(`Ticket #${ticket.number} closed`)
          .setDescription(`Thanks for reaching out. Here is a copy of the conversation.\n${reason ? `Reason: ${reason}` : ''}`),
      ],
      files: [new AttachmentBuilder(transcript.text, { name: transcript.textName })],
    }).catch(() => {});
  }

  await channel.send({
    embeds: [
      ticketEmbed(ticket, {
        description: `Closed by <@${closer.id}>${reason ? ` — ${reason}` : ''}.\nThis channel is removed in 10 seconds.`,
        color: color.danger,
      }),
    ],
    components: [],
  }).catch(() => {});

  setTimeout(() => {
    channel.delete(`Ticket closed by ${closer.tag}`).catch(() => {});
  }, 10_000).unref?.();

  return { ticket, transcript };
}

/** Closes tickets with no activity past the configured window. */
async function autoCloseStale(client) {
  for (const guild of client.guilds.cache.values()) {
    const record = await guildRecord(guild.id);
    const limitHours = record.settings.autoCloseHours;
    if (!limitHours) continue;

    for (const ticket of Object.values(record.tickets)) {
      if (Date.now() - ticket.lastActivity < limitHours * 3_600_000) continue;
      const channel = await globalClientChannel(ticket.id);
      if (!channel) continue;
      const bot = guild.members.me;
      await closeTicket(channel, { id: client.user.id, tag: 'CenterSide (auto-close)' }, `No activity for ${limitHours}h`).catch((err) => {
        if (bot) console.warn(`[tickets] auto-close failed for ${ticket.id}: ${err.message}`);
      });
    }
  }
}

module.exports = {
  openTicket,
  claimTicket,
  closeTicket,
  touchTicket,
  isStaff,
  autoCloseStale,
  setClient,
};
