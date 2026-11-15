'use strict';

const { JsonStore, EMPTY_PACK } = require('./store');
const { packFile, minConfidence } = require('./config');

const packStore = new JsonStore(packFile, EMPTY_PACK);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'yours', 'are', 'was', 'were', 'have', 'has',
  'had', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'this', 'that', 'these', 'those', 'there', 'here', 'with', 'without', 'from', 'into',
  'about', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how', 'does',
  'did', 'doing', 'done', 'get', 'got', 'gets', 'please', 'thanks', 'thank', 'hello',
  'hey', 'hi', 'just', 'any', 'some', 'all', 'not', 'but', 'now', 'then', 'them',
  'they', 'their', 'its', 'it', 'is', 'be', 'been', 'being', 'am', 'do', 'my', 'me',
  'we', 'our', 'us', 'on', 'in', 'at', 'to', 'of', 'or', 'as', 'by', 'if', 'so',
]);

const OPENERS = {
  'Friendly & casual': 'Hey {name} — good timing, I can sort this out.',
  Professional: 'Hello {name}, thank you for reaching out.',
  'Short & blunt': '{name} — got it. Here is the situation.',
  Playful: 'Ooh, {name}, you caught us mid-coffee. Let us fix it.',
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function keywordsFor(question) {
  const words = tokenize(question);
  const unique = [...new Set(words)];
  return unique.length ? unique : [String(question || '').toLowerCase().trim()].filter(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function firstSentence(text, limit = 200) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const match = clean.match(/^.*?[.!?](\s|$)/);
  let out = match ? match[0].trim() : clean;
  if (out.length > limit) out = `${out.slice(0, limit - 3).trim()}…`;
  return out;
}

function normalize(pack) {
  const safe = { ...EMPTY_PACK, ...(pack || {}) };
  safe.answers = Array.isArray(safe.answers) ? safe.answers : [];
  safe.answers.forEach((answer, index) => {
    if (!answer.id) answer.id = `a${index + 1}`;
    if (!Array.isArray(answer.keywords) || !answer.keywords.length) {
      answer.keywords = keywordsFor(answer.question);
    }
  });
  return safe;
}

async function loadPack() {
  return normalize(await packStore.load());
}

async function savePack() {
  await packStore.save();
}

async function updatePack(mutator) {
  const pack = await loadPack();
  const result = await mutator(pack);
  await packStore.save();
  return result;
}

function scoreAnswer(tokens, answer) {
  let score = 0;
  const keywordSet = new Set((answer.keywords || []).map((k) => String(k).toLowerCase()));
  for (const token of tokens) if (keywordSet.has(token)) score += 3;

  const questionTokens = new Set(tokenize(answer.question));
  for (const token of tokens) if (questionTokens.has(token)) score += 1;
  return score;
}

function findAnswer(pack, question) {
  const tokens = tokenize(question);
  if (!tokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const answer of pack.answers) {
    const score = scoreAnswer(tokens, answer);
    if (score > bestScore) {
      bestScore = score;
      best = answer;
    }
  }
  if (!best || bestScore < minConfidence) return null;
  return { answer: best, score: bestScore };
}

/** Hard things the bot must never try to answer itself. */
function shouldEscalate(pack, question) {
  const text = String(question).toLowerCase();
  const triggers = String(pack.escalateWhen || '')
    .split(/[,.;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 3);

  const builtIn = ['chargeback', 'lawyer', 'legal action', 'sue you', 'hacked', 'compromised', 'scammed me'];
  for (const trigger of [...triggers, ...builtIn]) {
    if (trigger && text.includes(trigger)) return trigger;
  }
  return null;
}

/**
 * Conversational first responder.
 *
 * Order of operations: answer if the pack knows it, ask a sharper question if it
 * does not, and only involve a human once the bot has genuinely run out of things
 * to ask — or the member names something that must never be handled by a bot.
 */
function composeReply(pack, question, memberName = 'there', attempt = 0) {
  const hit = findAnswer(pack, question);
  const trigger = shouldEscalate(pack, question);
  const hours = String(pack.hours || '').trim() || 'normal support hours';
  const name = memberName;

  if (trigger) {
    return {
      mode: 'escalate',
      text: `**I'm getting a human on this one.** Anything involving ${trigger} goes to staff directly — that is not something I should handle. Someone is on the way, and the transcript is already saved.`,
      matched: hit ? hit.answer : null,
      escalateReason: trigger,
    };
  }

  if (hit) {
    return {
      mode: 'answer',
      text: `**${hit.answer.answer}**\n\nDid that sort it? If not, tell me what happened when you tried — I'll keep digging. Support hours: ${hours}.`,
      matched: hit.answer,
      confidence: hit.score,
      escalateReason: null,
    };
  }

  // Nothing matched: keep the conversation going instead of pinging staff.
  if (attempt >= 3) {
    return {
      mode: 'escalate',
      text: `I've asked everything the handbook can answer and we're still not there — **pulling a human in now.** They can see the whole conversation, so no need to repeat yourself. Support hours: ${hours}.`,
      matched: null,
      escalateReason: 'no answer after several attempts',
    };
  }

  const text = String(question).toLowerCase();
  let questionBack;

  if (/refund|money|pay|bought|purchase|order|card|charge|subscri|role/.test(text)) {
    questionBack = 'Which product or order is it, and what did you pay with? A receipt or order id is perfect — I can check the role sync and the exact status from that.';
  } else if (/error|broken|bug|crash|not work|doesn.t work|failed|issue|problem|stuck|lag/.test(text)) {
    questionBack = 'What exactly happens, and where — which command, channel or screen? The exact error text or a screenshot is the fastest way to the answer.';
  } else if (/how|where|when|can i|do i/.test(text)) {
    questionBack = 'Can you tell me a bit more — what are you trying to do, and what are you seeing right now? One or two sentences is enough.';
  } else {
    questionBack = 'What happened, and what did you expect instead? One or two sentences is plenty.';
  }

  const leads = {
    'Friendly & casual': `Hi ${name} — I want to get this right before I hand you off.`,
    Professional: `Hello ${name}. So I can answer accurately rather than guess:`,
    'Short & blunt': `${name} — need a bit more before I can answer.`,
    Playful: `Hey ${name} — help me help you.`,
  };
  const lead = leads[pack.tone] || leads['Friendly & casual'];

  return {
    mode: 'clarify',
    text: `${lead} ${questionBack}`,
    matched: null,
    escalateReason: null,
  };
}

/**
 * Builds the first reply from the pack only. No model call, no invented policy.
 * Kept for callers that want a one-shot answer (tests, previews).
 */
function buildAnswer(pack, question, memberName = 'there') {
  const reply = composeReply(pack, question, memberName, 9);
  return {
    text: reply.text,
    matched: reply.matched,
    confidence: reply.confidence || 0,
    escalate: reply.mode === 'escalate',
    escalateReason: reply.escalateReason,
  };
}

async function addAnswer(pack, question, answer) {
  const id = `a${Date.now().toString(36)}`;
  pack.answers.push({
    id,
    question: String(question).trim(),
    answer: String(answer).trim(),
    keywords: keywordsFor(question),
  });
  return id;
}

async function removeAnswer(pack, id) {
  const index = pack.answers.findIndex((a) => a.id === id);
  if (index === -1) return false;
  pack.answers.splice(index, 1);
  return true;
}

module.exports = {
  loadPack,
  savePack,
  updatePack,
  buildAnswer,
  composeReply,
  findAnswer,
  shouldEscalate,
  keywordsFor,
  addAnswer,
  removeAnswer,
  escapeHtml,
  firstSentence,
  packStore,
  OPENERS,
};
