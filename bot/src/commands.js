'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const manage = PermissionFlagsBits.ManageGuild;

/*
 * Five flat commands, no subcommands. Discord renders each subcommand as its own
 * picker entry, which is what makes a small bot look enormous. Everything a
 * ticket needs lives on its buttons instead.
 */

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Setup: channels, ticket questions and up to 10 support roles')
    .setDefaultMemberPermissions(manage)
    .addRoleOption((option) => option
      .setName('support_role_1')
      .setDescription('Support role pinged when a ticket needs a human (required)')
      .setRequired(true))
    .addRoleOption((option) => option.setName('support_role_2').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_3').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_4').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_5').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_6').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_7').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_8').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_9').setDescription('Additional support role'))
    .addRoleOption((option) => option.setName('support_role_10').setDescription('Additional support role')),

  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Change one part of the setup — log channel, category, staff role, welcome, briefing')
    .setDefaultMemberPermissions(manage)
    .addChannelOption((option) => option
      .setName('log')
      .setDescription('Where transcripts and staff notes go')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option
      .setName('category')
      .setDescription('Where ticket channels are created')
      .addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((option) => option
      .setName('staff')
      .setDescription('Role that can see and answer tickets'))
    .addChannelOption((option) => option
      .setName('welcome')
      .setDescription('Where welcome embeds post')
      .addChannelTypes(ChannelType.GuildText))
    .addBooleanOption((option) => option
      .setName('briefing')
      .setDescription('Reopen the briefing questions')),

  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Pull the latest CenterSide code from GitHub — your settings and tickets are kept')
    .setDefaultMemberPermissions(manage),

  new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Send the update notice to every server owner (bot owner only)'),

  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Get the link that authorises the app and adds you to the server'),

  new SlashCommandBuilder()
    .setName('describe')
    .setDescription('Open the setup page and write a proper description of your server')
    .setDefaultMemberPermissions(manage),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the ticket panel in this channel')
    .setDefaultMemberPermissions(manage),

  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome new members with an embed the bot builds for you')
    .setDefaultMemberPermissions(manage)
    .addStringOption((option) => option
      .setName('message')
      .setDescription('Line under the welcome (supports {server} and {count})'))
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Where it posts (optional — one is created if missing)')
      .addChannelTypes(ChannelType.GuildText))
    .addBooleanOption((option) => option
      .setName('off')
      .setDescription('Turn welcome messages off')),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Open tickets, closed tickets and who is carrying the desk')
    .setDefaultMemberPermissions(manage),
].map((command) => command.toJSON());

module.exports = { commands };
