'use strict';

/*
 * Auto-answer gating test. No Discord, no token, no disk writes: the state module
 * is stubbed in the require cache, so this proves the exact conditions under which
 * a ticket opener's message gets a reply.
 * Run with: npm run autotest
 */

process.env.AI_ENABLED = 'false';
process.env.AUTO_REPLY_COOLDOWN_MS = '0';

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
    'chan-8': makeTicket('chan-8', 8),
    'chan-9': makeTicket('chan-9', 9),
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
    channel: { id: channel, sendTyping: async () => {}, send: async (payload) => { sent.push(payload); } },
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

  await check('unknown question asks for detail instead of pinging staff', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'what is the airspeed velocity of a swallow', channel: 'chan-3' });
    await handleTicketMessage(message, pack);
    const said = message.sent.map((m) => m.content || '').join(' ');
    assert(message.sent.length >= 1, 'bot said nothing');
    assert(/\?/.test(said), 'bot did not ask a question');
    assert(!/<@&/.test(said), 'bot pinged staff over an unknown question');
    assert.strictEqual(message.sent.length, 1, 'bot posted more than one message');
  });

  await check('keeps asking, one question at a time, until it runs out', async () => {
    const inputs = [
      'my thing is broken and weird',
      'no idea honestly',
      'it just does not work at all',
      'i already told you it is broken',
      'still broken, nothing helps',
    ];
    let escalated = false;
    let questions = 0;
    for (const input of inputs) {
      const message = fakeMessage({ authorId: 'opener-id', content: input, channel: 'chan-8' });
      await handleTicketMessage(message, pack);
      const said = message.sent.map((m) => m.content || '').join(' ');
      if (/\?/.test(said)) questions += 1;
      if (/human|pulling staff/i.test(said)) escalated = true;
    }
    assert(questions >= 2, `only ${questions} questions asked`);
    assert(escalated, 'never escalated after exhausting the questions');
  });

  await check('chargeback escalates immediately', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'i am calling my bank for a chargeback', channel: 'chan-6' });
    await handleTicketMessage(message, pack);
    const said = message.sent.map((m) => m.content || '').join(' ');
    assert(/human|staff/i.test(said), 'chargeback did not escalate');
  });

  await check('claimed ticket stays silent', async () => {
    record.tickets['chan-4'].claimedBy = 'staff-id';
    const message = fakeMessage({ authorId: 'opener-id', content: 'how do i get my purchase role', channel: 'chan-4' });
    await handleTicketMessage(message, pack);
    assert.strictEqual(message.sent.length, 0, 'bot spoke on a claimed ticket');
    record.tickets['chan-4'].claimedBy = null;
  });

  await check('non-opener staff message stays silent', async () => {
    const message = fakeMessage({ authorId: 'staff-id', content: 'on it', staff: true, channel: 'chan-5' });
    await handleTicketMessage(message, pack);
    assert.strictEqual(message.sent.length, 0, 'bot spoke over staff');
  });

  await check('a bare "Hi" gets a spoken reply', async () => {
    const message = fakeMessage({ authorId: 'opener-id', content: 'Hi', channel: 'chan-9' });
    await handleTicketMessage(message, pack);
    assert(message.sent.length >= 1, 'bot ignored a greeting');
  });

  await check('it remembers what the member already said', async () => {
    const first = fakeMessage({ authorId: 'opener-id', content: 'bought the asset pack, order NOVA12345', channel: 'chan-7' });
    await handleTicketMessage(first, pack);
    const facts = record.tickets['chan-7'].convo.facts;
    assert.strictEqual(facts.order, 'NOVA12345', 'order id not captured');
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
