'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA,

  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  devGuildId: process.env.GUILD_ID || '',

  stateFile: path.join(DATA, 'state.json'),
  packFile: path.join(DATA, 'pack.json'),
  transcriptDir: path.join(DATA, 'transcripts'),

  // Auto-answer only fires above this keyword score. 3 = one keyword from the answer.
  minConfidence: 3,

  // Reply cap per channel, milliseconds. Stops a bot loop turning into a spam loop.
  // 1.2s only exists to stop a bot-on-bot loop. Anything longer reads as the
  // bot ignoring the member mid-conversation.
  autoReplyCooldownMs: Number(process.env.AUTO_REPLY_COOLDOWN_MS || 1_200),

  defaults: {
    categoryId: null,
    logChannelId: null,
    panelChannelId: null,
    staffRoleIds: [],
    autoAnswer: true,
    slaMinutes: 15,
    autoCloseHours: 24,
    welcomeEnabled: false,
    welcomeChannelId: null,
    welcomeMessage: '',
    welcomeTitle: '',
  },

  panelCategories: [
    { label: 'Billing', value: 'billing', description: 'Purchases, missing roles, refunds' },
    { label: 'Script help', value: 'scripts', description: 'Errors, modules, tooling' },
    { label: 'Report a member', value: 'report', description: 'Private — handled by moderators' },
    { label: 'Something else', value: 'other', description: 'Anything that does not fit' },
  ],

  color: {
    brand: 0x25d9ff,
    ok: 0x5fffe0,
    warn: 0xfebc2e,
    danger: 0xff5f57,
    quiet: 0x0d1a33,
  },

  ai: {
    // Opt-in. A local CPU model can take 100s per reply, so nothing is probed
    // unless it is asked for; the built-in agent answers in milliseconds.
    enabled: String(process.env.AI_ENABLED || 'false').toLowerCase() === 'true',
    baseUrl: process.env.AI_BASE_URL || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
    // Local CPU models can take minutes; past this we use the built-in engine.
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 12_000),
  },
};
