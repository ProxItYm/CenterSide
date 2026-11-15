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
    .setDescription('Set CenterSide up — briefing, channels and staff role in one go')
    .setDefaultMemberPermissions(manage)
    .addRoleOption((option) => option
      .setName('staff')
      .setDescription('Role that can see and answer tickets (optional)'))
    .addChannelOption((option) => option
      .setName('category')
      .setDescription('Where ticket channels go (optional — one is created if missing)')
      .addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((option) => option
      .setName('log')
      .setDescription('Where transcripts go (optional — one is created if missing)')
      .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the ticket panel in this channel')
    .setDefaultMemberPermissions(manage),

  new SlashCommandBuilder()
    .setName('answer')
    .setDescription('Teach it one question and one approved answer'),

  new SlashCommandBuilder()
    .setName('answers')
    .setDescription('List the saved answers, or delete one by id')
    .addStringOption((option) => option
      .setName('remove')
      .setDescription('Id of the answer to delete (leave blank to list them)')),

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
