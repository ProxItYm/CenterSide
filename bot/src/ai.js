'use strict';

const config = require('./config');

/*
 * Optional language model, used only when one is actually reachable and fast.
 *
 * Order: an OpenAI-compatible endpoint (AI_BASE_URL + AI_API_KEY) if configured,
 * then a local Ollama instance. A local 24B model answers in ~100s on CPU, which
 * is worse than the deterministic engine, so anything that misses AI_TIMEOUT_MS
 * falls back automatically. Silence beats a two-minute pause in a live ticket.
 */

let cached = null;

async function probeOllama() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    if (!models.length) return null;
    const preferred = config.ai.model && models.includes(config.ai.model)
      ? config.ai.model
      : models[0];
    return { kind: 'ollama', model: preferred, baseUrl: 'http://127.0.0.1:11434' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once per process: { kind, model, baseUrl } or null. */
async function resolveProvider() {
  if (cached !== null) return cached || null;

  if (config.ai.baseUrl && config.ai.apiKey) {
    cached = { kind: 'openai', baseUrl: config.ai.baseUrl.replace(/\/$/, ''), model: config.ai.model || 'gpt-4o-mini' };
    return cached;
  }

  if (config.ai.enabled) {
    const ollama = await probeOllama();
    if (ollama) {
      cached = ollama;
      return cached;
    }
  }

  cached = false;
  return null;
}

function sanitize(text) {
  return String(text || '')
    .replace(/@everyone|@here/gi, 'everyone')
    .replace(/<@&\d+>|<@!?\d+>|<#\d+>/g, '')
    .trim();
}

async function complete({ system, messages, maxTokens = 220 }) {
  const provider = await resolveProvider();
  if (!provider) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);

  try {
    if (provider.kind === 'ollama') {
      const res = await fetch(`${provider.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: provider.model,
          stream: false,
          options: { temperature: 0.5, num_predict: maxTokens },
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const out = sanitize(data?.message?.content || '');
      return out || null;
    }

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.5,
        // gpt-oss models spend the whole budget on hidden reasoning without this.
        ...(provider.model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
        max_tokens: Math.max(maxTokens, 400),
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = sanitize(data?.choices?.[0]?.message?.content || '');
    return out || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function describeProvider() {
  const provider = await resolveProvider();
  if (!provider) return null;
  return `${provider.kind}:${provider.model}`;
}

module.exports = { complete, describeProvider, resolveProvider };
