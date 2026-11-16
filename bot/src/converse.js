'use strict';

const { findAnswer, shouldEscalate } = require('./knowledge');

/*
 * The built-in support agent.
 *
 * Not a single-shot responder: it keeps a per-ticket conversation, pulls facts out
 * of what the member writes (order id, email, platform, error text), asks one
 * question at a time, never repeats a question it already asked, and only hands
 * off once the slots are full. This is the fallback when no language model is
 * configured, and it still reads like a person working a queue.
 */

const MAX_HISTORY = 10;
const history = new Map();

function getHistory(channelId) {
  return history.get(channelId) || [];
}

function pushHistory(channelId, role, content) {
  const list = history.get(channelId) || [];
  list.push({ role, content: String(content).slice(0, 1200) });
  while (list.length > MAX_HISTORY) list.shift();
  history.set(channelId, list);
}

function clearHistory(channelId) {
  history.delete(channelId);
}

/** After the pack changes, old replies must not be fed back to the model. */
function clearAllHistory() {
  history.clear();
}

const SLOT_ORDER = {
  billing: ['product', 'order', 'tried'],
  scripts: ['error', 'platform', 'tried'],
  report: ['who', 'evidence', 'when'],
  other: ['what', 'error', 'tried'],
};

const SLOT_QUESTIONS = {
  product: 'Which product or purchase is it — the name as it appears on the store page?',
  order: 'Do you have the order id, or the email you bought with? Either one is enough for me to trace it.',
  tried: 'Have you tried logging out and back in, or refreshing the store page? I want to rule that out before this goes anywhere.',
  error: "What's the exact error? Paste the message or drop a screenshot — the wording usually tells me which module is unhappy.",
  platform: 'Where are you seeing this — PC, mobile, or a browser?',
  who: 'Who is involved, and in which channel did it happen?',
  evidence: 'Do you have a screenshot or a message link? That is what a moderator will need.',
  what: 'What happened, in your own words?',
  when: 'When did it start, and does it happen every time?',
};

function convoOf(ticket) {
  if (!ticket.convo) ticket.convo = { asked: [], facts: {} };
  if (!Array.isArray(ticket.convo.asked)) ticket.convo.asked = [];
  if (!ticket.convo.facts) ticket.convo.facts = {};
  return ticket.convo;
}

function extractFacts(text, convo) {
  const facts = convo.facts;

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) facts.email = email[0];

  const order = text.match(/(?:order|receipt|invoice)(?:\s*(?:id|number|no\.)\b)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i)
    || text.match(/\b([A-Z0-9]{6,})\b/);
  if (order && !facts.order) facts.order = order[1];

  if (/\b(pc|windows|mac|linux|desktop)\b/i.test(text)) facts.platform = 'PC';
  else if (/\b(mobile|phone|ios|android|ipad)\b/i.test(text)) facts.platform = 'mobile';
  else if (/\b(browser|chrome|firefox|safari|edge)\b/i.test(text)) facts.platform = 'browser';

  if (/\b(error|exception|traceback|nil|attempt to index|stack trace)\b/i.test(text) && !facts.error) {
    facts.error = text.slice(0, 180);
  }

  if (/\b(yes|yeah|yep|already|i did|tried that|reinstalled|logged out)\b/i.test(text)) {
    if (convo.asked.includes('tried')) facts.tried = true;
  }
  if (/\b(no|nope|not yet|haven'?t)\b/i.test(text) && convo.asked.includes('tried')) {
    facts.tried = false;
  }

  return facts;
}

function summarizeFacts(facts) {
  const bits = [];
  if (facts.product) bits.push(facts.product);
  if (facts.order) bits.push(`order ${facts.order}`);
  if (facts.email) bits.push(facts.email);
  if (facts.platform) bits.push(facts.platform);
  if (facts.error) bits.push(`error: "${facts.error.slice(0, 90)}"`);
  return bits.join(' · ');
}

function nextSlot(ticket, convo) {
  const lane = SLOT_ORDER[ticket.category] || SLOT_ORDER.other;
  for (const slot of lane) {
    if (!convo.asked.includes(slot) && !(slot in convo.facts)) return slot;
  }
  return null;
}

/**
 * Deterministic conversational reply for one member message.
 * Returns { mode: 'answer'|'clarify'|'escalate', text, escalateReason }.
 */
function nextReply({ pack, ticket, text, memberName }) {
  const convo = convoOf(ticket);
  extractFacts(text, convo);

  const trigger = shouldEscalate(pack, text);
  if (trigger) {
    return {
      mode: 'escalate',
      text: `**That one goes straight to a human.** Anything about ${trigger} is above a bot's pay grade. Someone from staff is being pinged now, and this whole conversation is attached — no need to repeat yourself.`,
      escalateReason: trigger,
    };
  }

  if (/\b(human|real person|staff|moderator|mod|admin|someone real|agent)\b/i.test(text) && !/\b(human error)\b/i.test(text)) {
    return {
      mode: 'escalate',
      text: "Understood — pinging a human now. I've kept everything you told me in the transcript so you only have to say it once.",
      escalateReason: 'member asked for a human',
    };
  }

  const hit = findAnswer(pack, text);
  if (hit) {
    const factsLine = summarizeFacts(convo.facts);
    return {
      mode: 'answer',
      text: [
        hit.answer.answer,
        '',
        'Did that sort it? If not, tell me what happened when you tried — I will keep going.',
        factsLine ? `_(What I have so far: ${factsLine})_` : '',
      ].filter(Boolean).join('\n'),
      matched: hit.answer,
    };
  }

  const slot = nextSlot(ticket, convo);
  if (!slot) {
    const factsLine = summarizeFacts(convo.facts);
    return {
      mode: 'escalate',
      text: [
        "Right, I've got what I can and it needs a person now — pulling staff in.",
        factsLine ? `\n**What I've collected:** ${factsLine}` : '',
        '\nThey can read the whole thread, so you do not need to repeat yourself.',
      ].filter(Boolean).join(''),
      escalateReason: 'asked everything, still unresolved',
    };
  }

  convo.asked.push(slot);
  const factsLine = summarizeFacts(convo.facts);

  return {
    mode: 'clarify',
    text: [
      `Thanks ${memberName} — noted.`,
      factsLine ? `So far I have: ${factsLine}.` : '',
      SLOT_QUESTIONS[slot],
    ].filter(Boolean).join(' '),
  };
}

/** System prompt for the language-model path. */
function systemPrompt(pack, ticket, settings, serverMap = '', ticketInfo = '') {
  const answers = (pack.answers || [])
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join('\n\n');

  return [
    `You are CenterSide, the support agent for the Discord server "${pack.server || 'this server'}".`,
    pack.about ? `What the server is: ${pack.about}` : '',
    pack.hours ? `Support hours: ${pack.hours}` : '',
    pack.tone ? `Tone: ${pack.tone}.` : '',
    pack.hardFacts ? `Facts you must not contradict: ${pack.hardFacts}` : '',
    answers ? `Approved answers (use these when they fit):\n${answers}` : '',
    '',
    'How to talk:',
    '- Sound like a competent person working a support queue, not a form letter.',
    '- Reply in 2-4 short sentences. One question at a time.',
    '- Use what the member already told you. Never ask for the same detail twice.',
    '- If you do not know, say so plainly and ask the single most useful question.',
    '- Never invent prices, links, policies or timelines.',
    '- No markdown headings, no bullet lists unless listing steps.',
    '- Do not escalate because a message is rude, confusing or short. Answer it anyway.',
    '- You cannot close tickets, delete channels, issue refunds or change roles. Never claim you did — the bot acts on its own for those, and false promises make it look broken.',
    '- ESCALATE is only for: a chargeback or legal threat, a hacked/compromised account, or an explicit request to speak to a human. It is never for a question about where something is in this server.',
    '- If you cannot answer, ask one clarifying question first. Escalating is the last resort, not the second.',
    `- The ticket lane is "${ticket.category}".`,
    ticketInfo ? `Ticket context: ${ticketInfo}` : '',
    serverMap ? `\n${serverMap}` : '',
    serverMap ? '\nThe server map above is live and authoritative. If someone asks where a channel or role is, answer from it and use the exact names. If something they mention is not in it, say plainly that it does not exist and offer to have staff create it — never invent channel names, categories, commands or roles.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  nextReply,
  systemPrompt,
  extractFacts,
  convoOf,
  getHistory,
  pushHistory,
  clearHistory,
  clearAllHistory,
  summarizeFacts,
};
