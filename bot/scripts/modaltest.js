'use strict';

/*
 * Builds every modal the bot can show and validates it with discord.js's own
 * builders. Catches the boring stuff that only fails at runtime (labels over 45
 * characters, too many rows, empty required values) without a Discord connection.
 * Run with: npm run modaltest
 */

const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

let failures = 0;

function check(name, build) {
  try {
    const modal = build();
    const json = modal.toJSON();
    const inputs = json.components.flatMap((row) => row.components);
    if (!json.title || json.title.length > 45) throw new Error(`title length ${json.title.length}`);
    if (json.components.length > 5) throw new Error(`${json.components.length} rows`);
    for (const input of inputs) {
      if (input.label.length > 45) throw new Error(`label too long: ${input.label}`);
      if (input.placeholder && input.placeholder.length > 100) throw new Error(`placeholder too long: ${input.placeholder}`);
    }
    console.log(`  ok   ${name} (${inputs.length} inputs)`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

check('setup:brief', () => {
  const modal = new ModalBuilder().setCustomId('setup:brief').setTitle('Tell the bot about your server');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('about').setLabel('What is this server about?')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(700).setRequired(true)
      .setValue('A Roblox development community that sells asset packs.')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('tone').setLabel('Tone of voice')
      .setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(false)
      .setPlaceholder('Friendly & casual / Professional / Short & blunt / Playful')
      .setValue('Friendly & casual')),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('hours').setLabel('Support hours')
      .setStyle(TextInputStyle.Short).setMaxLength(70).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('escalate').setLabel('Hand it to a human when someone mentions…')
      .setStyle(TextInputStyle.Short).setMaxLength(300).setRequired(false)
      .setPlaceholder('chargeback, legal threat, hacked account')),
  );
  return modal;
});

check('knowledge:add', () => {
  const modal = new ModalBuilder().setCustomId('knowledge:add').setTitle('New saved answer');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('question').setLabel('Question members ask')
      .setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('answer').setLabel('Answer the bot is allowed to give')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(900).setRequired(true)),
  );
  return modal;
});

check('panel:intake:billing', () => {
  const modal = new ModalBuilder().setCustomId('panel:intake:billing').setTitle('Billing');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('reason').setLabel('What is the reason for opening this ticket?')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('urgency').setLabel('Is it urgent or can it wait?')
      .setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('userid').setLabel('Please provide your USER ID')
      .setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(true)),
  );
  return modal;
});

check('ticket:addmember', () => {
  const modal = new ModalBuilder().setCustomId('ticket:addmember').setTitle('Add someone to this ticket');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
    .setCustomId('member').setLabel('Member id or @mention')
    .setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
  return modal;
});

if (failures) {
  console.error(`\n${failures} modal(s) invalid`);
  process.exit(1);
}
console.log('\nall modals valid');
