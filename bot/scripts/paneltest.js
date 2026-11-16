'use strict';

process.env.AI_ENABLED = 'false';

const path = require('node:path');
const assert = require('node:assert');

const statePath = require.resolve('../src/state');
const record = {
  settings: {
    describedAt: Date.now(),
    categoryId: 'cat',
    logChannelId: null,
    panelChannelId: null,
    panelMessageId: null,
    staffRoleIds: [],
    autoAnswer: true,
    lanes: null,
    guildName: 'Test',
  },
  tickets: {},
  history: [],
  counter: 0,
};

require.cache[statePath] = {
  id: statePath,
  filename: statePath,
  loaded: true,
  exports: {
    guildRecord: async () => record,
    settingsFor: async () => record.settings,
    save: async () => {},
  },
};

const { route } = require('../src/handlers');

function fakeInteraction({ failModal = false } = {}) {
  const sent = [];
  return {
    sent,
    guildId: 'g1',
    channelId: 'c1',
    commandName: 'panel',
    guild: { id: 'g1', name: 'Test', ownerId: null, channels: { cache: new Map() } },
    channel: { id: 'c1', isTextBased: () => true, send: async (p) => { sent.push(p); return { id: 'm1' }; } },
    memberPermissions: { has: () => true },
    user: { id: 'u1', username: 'tester' },
    isChatInputCommand: () => true,
    isStringSelectMenu: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    showModal: async () => {
      if (failModal) throw new Error('modal rejected');
    },
    reply: async (p) => { sent.push(p); },
    editReply: async (p) => { sent.push(p); },
    followUp: async (p) => { sent.push(p); },
    deferReply: async () => {},
  };
}

(async () => {
  let failures = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    }
  };

  await check('panel opens the lane modal', async () => {
    const i = fakeInteraction();
    await route(i, {});
    assert.strictEqual(i.sent.length, 0, 'should not send a message when the modal opened');
  });

  await check('falls back to posting the panel if the modal fails', async () => {
    const i = fakeInteraction({ failModal: true });
    await route(i, {});
    assert(i.sent.length >= 1, 'no fallback message');
    const text = i.sent.map((m) => m.content || '').join(' ');
    assert(/Panel posted|Panel failed/.test(text), `unexpected text: ${text}`);
  });

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\npanel flow verified');
})();
