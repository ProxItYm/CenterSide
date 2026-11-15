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
 * Builds the first reply from the pack only. No model call, no invented policy:
 * if nothing scores high enough it says so and escalates.
 */
function buildAnswer(pack, question, memberName = 'there') {
  const opener = (OPENERS[pack.tone] || OPENERS['Friendly & casual']).replace('{name}', memberName);
  const hours = String(pack.hours || '').trim() || 'normal support hours';
  const hit = findAnswer(pack, question);
  const escalateTrigger = shouldEscalate(pack, question);

  let body;
  if (hit) {
    body = hit.answer.answer;
  } else {
    const about = firstSentence(pack.about);
    body = [
      about ? `Quick context so you know who you are talking to: ${about}` : '',
      'I do not have an approved answer for that exact question, so rather than guess I am pulling a human in.',
    ].filter(Boolean).join(' ');
  }

  const closing = hit && !escalateTrigger
    ? `If that does not match what you are seeing, reply here and I will pull a human in. First reply target is ${pack.__sla || '15 minutes'} during ${hours}.`
    : `A human takes over from here — target ${pack.__sla || '15 minutes'} during ${hours}.`;

  const text = `**${opener}** ${body} ${closing}`;
  const flagged = Boolean(escalateTrigger) || !hit;

  return {
    text,
    matched: hit ? hit.answer : null,
    confidence: hit ? hit.score : 0,
    escalate: flagged,
    escalateReason: escalateTrigger,
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
