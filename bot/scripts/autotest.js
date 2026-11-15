'use strict';

/*
 * Auto-answer gating test. No Discord, no token, no disk writes: the state module
 * is stubbed in the require cache, so this proves the exact conditions under which
 * a ticket opener's message gets a reply.
 * Run with: npm run autotest
 */

const path = require('node:path');
const assert = require('node:assert');

const statePath = require.resolve('../src/state');

function makeTicket(id, number) {
  return {
    id,
    number,
    userId: 'opener-id',
    category: 'billing',
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    slaDeadline: Date.now() + 900000,
    escalated: false,
    notes: [],
  };
}

const record = {
  counter: 1,
  settings: {
    categoryId: 'c1',
    logChannelId: null,
    panelChannelId: null,
    staffRoleIds: ['staff-role'],
    autoAnswer: true,
    slaMinutes: 15,
    autoCloseHours: 24,
    welcomeEnabled: false,
    welcomeChannelId: null,
    welcomeMessage: '',
    welcomeTitle: '',
  },
  tickets: {
    'chan-1': makeTicket('chan-1', 1),
    'chan-2': makeTicket('chan-2', 2),
    'chan-3': makeTicket('chan-3', 3),
    'chan-4': makeTicket('chan-4', 4),
    'chan-5': makeTicket('chan-5', 5),
    'chan-6': makeTicket('chan-6', 6),
    'chan-7': makeTicket('chan-7', 7),
  },
  history: [],
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

const { handleTicketMessage } = require('../src/handlers');
const { loadPack } = require('../src/knowledge');

function fakeMessage({ authorId, content, staff = false, member = true, channel = 'chan-1' }) {
  const sent = [];
  return {
    sent,
    author: { id: authorId, bot: false, username: 'tester' },
    guildId: 'g1',
    channelId: channel,
    member: member ? { permissions: { has: () => false }, roles: { cache: { has: () => staff } } } : null,
    content,
    reply: async (payload) => { sent.push(payload); },
    channel: { id: channel, send: async (payload) => { sent.push(payload); } },
  };
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

async function main() {
  const pack = await loadPack();
  const { autoReplyAt } = {};
  void autoReplyAt;

  await check('opener message with a matching answer gets a reply', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'how do i get my purchase role' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'no reply was sent');
    assert(/role/i.test(message.sent[0].content), 'reply did not contain the saved answer');
  });

  await check('opener who is also staff still gets a reply', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'can i get a refund on a duplicate', staff: true, channel: 'chan-2' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'staff opener got no reply');
  });

  await check('unmatched question still speaks (escalation reply)', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'what is the airspeed velocity of a swallow', channel: 'chan-3' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'no escalation reply');
    assert(/human|take over|escalat/i.test(message.sent.map((m) => m.content || '').join(' ')), 'reply did not mention a human');
  });

  await check('claimed ticket stays silent', async () => {
    record.tickets['chan-4'].claimedBy = 'staff-id';
    const message = fakeMessage({ authorId: 'opener-id', content: 'how do i get my purchase role', channel: 'chan-4' });
    await handleTicketMessage(message, pack);
    assert.strictEqual(message.sent.length, 0, 'bot spoke on a claimed ticket');
    record.tickets['chan-4'].claimedBy = null;
  });

  await check('non-opener staff message meets SLA and stays silent', async () => {
    const message = fakeMessage({ authorId: 'staff-id', content: 'on it', staff: true, channel: 'chan-5' });
    await handleTicketMessage(message, pack);
    assert.strictEqual(message.sent.length, 0, 'bot spoke over staff');
    assert.strictEqual(record.tickets['chan-5'].slaSatisfied, true, 'SLA not marked satisfied');
  });

  await check('a bare "Hi" still gets a spoken reply', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'Hi', channel: 'chan-6' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'bot ignored a greeting');
    assert(/tell me what you need/i.test(message.sent[0].content), 'greeting reply was not a prompt');
  });

  await check('one-word question gets answered or escalated, never silence', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'refund', channel: 'chan-7' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'bot ignored a short but real question');
  });

  await check('non-ticket channel is ignored', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'hello there friend' });
    message.channelId = 'random';
    await handleTicketMessage(message, pack);
    assert.strictEqual(message.sent.length, 0, 'bot spoke in a non-ticket channel');
  });

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nauto-answer gating verified');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
