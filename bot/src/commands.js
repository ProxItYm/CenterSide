'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const manage = PermissionFlagsBits.ManageGuild;

/*
 * Five commands, that is the whole surface.
 * /setup does everything /config used to do, and creates the channels itself.
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
    .setName('ticket')
    .setDescription('Manage the ticket in this channel')
    .addSubcommand((sub) => sub
      .setName('close')
      .setDescription('Close, save the transcript and delete this channel')
      .addStringOption((option) => option
        .setName('reason')
        .setDescription('Reason (goes in the log and the transcript)')))
    .addSubcommand((sub) => sub
      .setName('claim')
      .setDescription('Take this ticket and stop the reply timer'))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Give another member access to this ticket')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Who to add')
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('note')
      .setDescription('Private staff note — log and transcript only')
      .addStringOption((option) => option
        .setName('text')
        .setDescription('The note')
        .setRequired(true)
        .setMaxLength(500))),

  new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('The answers the bot is allowed to give')
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Teach it one question and one approved answer'))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('Show every saved answer with its id'))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Delete a saved answer')
      .addStringOption((option) => option
        .setName('id')
        .setDescription('Id from /knowledge list')
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('test')
      .setDescription('See the exact reply it would give')
      .addStringOption((option) => option
        .setName('question')
        .setDescription('Question to test')
        .setRequired(true)
        .setMaxLength(300))),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Open tickets, closed tickets and who is carrying the desk')
    .setDefaultMemberPermissions(manage),
].map((command) => command.toJSON());

module.exports = { commands };
