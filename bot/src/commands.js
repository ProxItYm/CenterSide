'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const manage = PermissionFlagsBits.ManageGuild;

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the CenterSide ticket panel')
    .setDefaultMemberPermissions(manage)
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Where to post it (defaults to the current channel)')
      .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the ticket in this channel')
    .addSubcommand((sub) => sub.setName('close').setDescription('Close and archive this ticket')
      .addStringOption((option) => option.setName('reason').setDescription('Reason (shown in the log and the transcript)')))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Take ownership of this ticket'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Give a member access to this ticket')
      .addUserOption((option) => option.setName('user').setDescription('Member to add').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a member from this ticket')
      .addUserOption((option) => option.setName('user').setDescription('Member to remove').setRequired(true)))
    .addSubcommand((sub) => sub.setName('note').setDescription('Add an internal note (staff only, never shown to the opener)')
      .addStringOption((option) => option.setName('text').setDescription('The note').setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('escalate').setDescription('Ping the staff roles and flag this ticket')
      .addStringOption((option) => option.setName('reason').setDescription('Why it is escalating')))
    .addSubcommand((sub) => sub.setName('rename').setDescription('Rename this ticket channel')
      .addStringOption((option) => option.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90))),

  new SlashCommandBuilder()
    .setName('knowledge')
    .setDescription('Teach CenterSide about this server')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Open the guided briefing wizard'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a saved answer'))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Delete a saved answer')
      .addStringOption((option) => option.setName('id').setDescription('Answer id from /knowledge list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List every saved answer'))
    .addSubcommand((sub) => sub.setName('test').setDescription('Preview the reply the bot would give')
      .addStringOption((option) => option.setName('question').setDescription('Question to test').setRequired(true).setMaxLength(300)))
    .addSubcommand((sub) => sub.setName('export').setDescription('Download the pack as JSON')),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('CenterSide settings')
    .setDefaultMemberPermissions(manage)
    .addSubcommand((sub) => sub.setName('view').setDescription('Show the current settings'))
    .addSubcommand((sub) => sub.setName('category').setDescription('Category where ticket channels are created')
      .addChannelOption((option) => option.setName('category').setDescription('Ticket category').setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((sub) => sub.setName('log').setDescription('Channel that receives transcripts and notes')
      .addChannelOption((option) => option.setName('channel').setDescription('Log channel').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName('staff').setDescription('Add or remove a staff role')
      .addStringOption((option) => option.setName('action').setDescription('add or remove').setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .addRoleOption((option) => option.setName('role').setDescription('Role that can see and claim tickets').setRequired(true)))
    .addSubcommand((sub) => sub.setName('autoanswer').setDescription('Turn automatic first replies on or off')
      .addBooleanOption((option) => option.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((sub) => sub.setName('sla').setDescription('First-reply target in minutes (0 disables the timer)')
      .addIntegerOption((option) => option.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(0).setMaxValue(1440)))
    .addSubcommand((sub) => sub.setName('autoclose').setDescription('Close tickets after this many hours of silence (0 disables)')
      .addIntegerOption((option) => option.setName('hours').setDescription('Hours').setRequired(true).setMinValue(0).setMaxValue(720))),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Ticket volume, response time and staff leaderboard')
    .setDefaultMemberPermissions(manage),
].map((command) => command.toJSON());

module.exports = { commands };
