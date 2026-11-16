'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const config = require('./config');
const { guildRecord, save } = require('./state');
const { loadPack, updatePack } = require('./knowledge');
const discordConfig = require('./config');

/*
 * A local setup page the bot serves itself. /describe hands the owner a private
 * link; the page writes straight into data/pack.json, so the next reply uses it.
 * Bound to loopback — nothing is exposed to the internet.
 */

// PaaS hosts inject PORT and expect the process to bind on all interfaces.
const PORT = Number(process.env.PORT || process.env.WEB_PORT || 8788);
// Loopback locally; a PaaS sets PORT and needs 0.0.0.0 to route to us.
const HOST = process.env.WEB_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const DISABLED = String(process.env.WEB_DISABLED || '').toLowerCase() === 'true';

function tokenFor(settings) {
  if (!settings.dashToken) settings.dashToken = crypto.randomBytes(16).toString('hex');
  return settings.dashToken;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function page({ guildName, token, pack, saved }) {
  const answers = (pack.answers || []).map((a) => `
      <div class="qa" data-id="${escapeHtml(a.id)}">
        <input class="q" value="${escapeHtml(a.question)}" />
        <textarea class="a" rows="2">${escapeHtml(a.answer)}</textarea>
        <button type="button" class="del" title="Delete">×</button>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(guildName)} — CenterSide setup</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#070d1c;color:#e9f2ff;font:15px/1.6 "Segoe UI",system-ui,sans-serif}
  main{max-width:820px;margin:0 auto;padding:40px 20px 80px}
  h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}
  p.lede{color:#8ea4c6;margin:0 0 28px}
  label{display:block;font-size:12.5px;letter-spacing:.04em;color:#8ea4c6;margin:18px 0 6px}
  input,textarea,select{width:100%;padding:11px 13px;border-radius:10px;background:rgba(0,0,0,.35);
    border:1px solid rgba(120,180,255,.25);color:#e9f2ff;font:inherit;outline:none}
  input:focus,textarea:focus,select:focus{border-color:#25d9ff;box-shadow:0 0 0 3px rgba(37,217,255,.14)}
  textarea{resize:vertical}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .qa{display:grid;grid-template-columns:1fr 1fr 32px;gap:8px;margin-bottom:8px;align-items:start}
  .qa .del{background:rgba(255,95,87,.15);border:1px solid rgba(255,95,87,.4);color:#ff8b85;
    border-radius:8px;height:40px;font-size:18px;cursor:pointer}
  button.add{margin-top:6px;padding:9px 14px;border-radius:9px;border:1px solid rgba(37,217,255,.4);
    background:rgba(37,217,255,.12);color:#d9f4ff;font-weight:600;cursor:pointer}
  .save{margin-top:30px;width:100%;padding:14px;border:0;border-radius:12px;cursor:pointer;
    background:linear-gradient(135deg,#25d9ff,#0b9bff);color:#04121f;font-weight:700;font-size:15px;
    display:flex;align-items:center;justify-content:center;gap:10px;
    transition:transform .12s ease,box-shadow .25s ease,background .3s ease,color .3s ease;
    box-shadow:0 12px 30px -14px rgba(37,217,255,.8)}
  .save:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 18px 38px -16px rgba(37,217,255,.95)}
  .save:active:not(:disabled){transform:translateY(0) scale(.995)}
  .save:disabled{cursor:progress;opacity:.9}
  .save.saving{background:linear-gradient(135deg,#1b3a5c,#123049);color:#bfe9ff}
  .save.saved{background:linear-gradient(135deg,#5fffe0,#25d9ff);color:#04121f;
    animation:pop .45s cubic-bezier(.2,1.4,.4,1)}
  .save.failed{background:linear-gradient(135deg,#ff5f57,#ff2ee6);color:#1a0004;animation:shake .4s}
  .spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(191,233,255,.35);
    border-top-color:#bfe9ff;animation:spin .7s linear infinite}
  .tick{font-size:17px;line-height:1}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pop{0%{transform:scale(1)}45%{transform:scale(1.03)}100%{transform:scale(1)}}
  @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
  .banner{animation:slideIn .4s ease both}
  @keyframes slideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
  .banner{padding:12px 14px;border-radius:10px;margin-bottom:22px;font-size:14px}
  .ok{background:rgba(95,255,224,.12);border:1px solid rgba(95,255,224,.35);color:#9ef7e6}
  .note{color:#6d82a6;font-size:12.5px;margin-top:16px}
  h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6d82a6;margin:34px 0 4px}
</style></head>
<body><main>
  <h1>${escapeHtml(guildName)} — tell CenterSide about your server</h1>
  <p class="lede">Saved straight into the bot's knowledge pack. The next ticket reply uses it.</p>
  ${saved ? '<div class="banner ok">Saved. You can close this tab — the bot already knows.</div>' : ''}

  <form method="POST" action="/g/${token}">
    <label>Server name</label>
    <input name="server" value="${escapeHtml(guildName)}" maxlength="80" />

    <label>What is this server about?</label>
    <textarea name="about" rows="4" maxlength="1200">${escapeHtml(pack.about)}</textarea>

    <div class="row">
      <div><label>Tone</label>
        <select name="tone">
          ${['Friendly & casual', 'Professional', 'Short & blunt', 'Playful'].map((t) => `<option ${pack.tone === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div><label>Support hours</label>
        <input name="hours" value="${escapeHtml(pack.hours)}" /></div>
    </div>

    <label>Hard facts it must never get wrong</label>
    <textarea name="hardFacts" rows="3" maxlength="800">${escapeHtml(pack.hardFacts)}</textarea>

    <label>Hand to a human when someone mentions</label>
    <input name="escalateWhen" value="${escapeHtml(pack.escalateWhen)}" />

    <h2>Saved answers</h2>
    <div id="qa-list">${answers}</div>
    <button class="add" type="button" onclick="addRow()">+ Add answer</button>

    <button class="save" id="saveBtn" type="submit"><span id="saveIcon"></span><span id="saveLabel">Save and teach the bot</span></button>
    <p class="note">This page is served by your bot on 127.0.0.1 only. The link contains a private token — do not share it.</p>
  </form>
</main>
<script>
  function addRow() {
    const list = document.getElementById('qa-list');
    const div = document.createElement('div');
    div.className = 'qa';
    div.innerHTML = '<input class="q" />' +
      '<textarea class="a" rows="2"></textarea>' +
      '<button type="button" class="del" title="Delete" onclick="this.parentElement.remove()">×</button>';
    list.appendChild(div);
    div.querySelector('.q').focus();
  }
  document.getElementById('qa-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('del')) e.target.parentElement.remove();
  });
  document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new URLSearchParams(new FormData(e.target));
    body.set('answers', JSON.stringify([...document.querySelectorAll('.qa')].map((row) => ({
      question: row.querySelector('.q').value.trim(),
      answer: row.querySelector('.a').value.trim(),
    })).filter((a) => a.question && a.answer)));
    const res = await fetch(location.pathname, { method: 'POST', body });
    if (res.ok) location.reload(); else alert('Save failed — check the bot console.');
  });
</script>
</body></html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 200_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function resolveGuild(token) {
  // Tokens are unique per guild; scan the small in-memory state.
  const { stateStore } = require('./state');
  const state = await stateStore.load();
  for (const [guildId, guild] of Object.entries(state.guilds || {})) {
    if (guild.settings && guild.settings.dashToken === token) return guildId;
  }
  return null;
}

const SCOPES = 'identify guilds.join';

function redirectUri() {
  const base = (process.env.WEB_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
  return `${base}/auth/callback`;
}

function authorizeUrl() {
  const params = new URLSearchParams({
    client_id: discordConfig.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function pageShell(title, message, tone = '#25d9ff') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070d1c;color:#e9f2ff;
       font:16px/1.6 "Segoe UI",system-ui,sans-serif;padding:24px;text-align:center}
  .card{max-width:520px;padding:44px 36px;border-radius:24px;border:1px solid rgba(120,180,255,.18);
        background:linear-gradient(165deg,rgba(16,33,65,.85),rgba(8,16,32,.92))}
  h1{font-size:26px;margin:0 0 10px;letter-spacing:-.02em;color:${tone}}
  p{color:#8ea4c6;margin:0}
  a{display:inline-block;margin-top:22px;color:#04121f;background:linear-gradient(135deg,#25d9ff,#0b9bff);
    padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p>
<a href="https://proxitym.github.io/CenterSide/">CenterSide</a></div></body></html>`;
}

async function addMember(accessToken, userId) {
  const guildId = discordConfig.autoJoinGuildId;
  if (!guildId) return { skipped: true };

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${discordConfig.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, body: text.slice(0, 300) };
  }
  return { ok: true };
}

async function handleJoin(req, res) {
  if (!discordConfig.clientId) {
    return send(res, 500, pageShell('Not configured', 'CLIENT_ID is missing on the bot.', '#ff5f57'));
  }
  res.writeHead(302, { Location: authorizeUrl() });
  res.end();
}

async function handleCallback(req, res, url) {
  const code = url.searchParams.get('code');
  if (!code) return send(res, 400, pageShell('Cancelled', 'No authorisation code came back.'));

  if (!discordConfig.clientSecret) {
    return send(res, 500, pageShell('Not configured',
      'DISCORD_CLIENT_SECRET is missing, so the app cannot finish authorising.', '#ff5f57'));
  }

  const body = new URLSearchParams({
    client_id: discordConfig.clientId,
    client_secret: discordConfig.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });

  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error('[oauth] token exchange failed', tokenRes.status, JSON.stringify(tokenJson).slice(0, 200));
    return send(res, 400, pageShell('Authorisation failed',
      'Discord rejected the request. Try again from the invite link.', '#ff5f57'));
  }

  const meRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const me = await meRes.json().catch(() => ({}));

  const added = await addMember(tokenJson.access_token, me.id).catch((err) => ({ ok: false, body: err.message }));

  if (added.skipped) {
    return send(res, 200, pageShell('Authorised',
      'Thanks — the app is authorised. Auto-join is not configured yet.'));
  }

  if (!added.ok) {
    console.error('[oauth] add member failed', added.status, added.body);
    return send(res, 200, pageShell('Almost there',
      'You authorised the app but Discord would not add you to the server automatically. Use the invite link instead.',
      '#febc2e'));
  }

  console.log(`[oauth] added ${me.username || me.id} to ${discordConfig.autoJoinGuildId}`);
  return send(res, 200, pageShell('You are in', `Welcome, ${me.username || 'friend'} — you have been added to the server.`));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/join') return handleJoin(req, res);
  if (url.pathname === '/auth/callback') return handleCallback(req, res, url);

  const match = url.pathname.match(/^\/g\/([a-f0-9]{32})\/?$/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const token = match[1];
  const guildId = await resolveGuild(token);
  if (!guildId) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Invalid or expired link');
    return;
  }

  const record = await guildRecord(guildId);
  const settings = record.settings;

  if (req.method === 'POST') {
    const body = await readBody(req);
    const form = new URLSearchParams(body);

    let answers = [];
    try {
      answers = JSON.parse(form.get('answers') || '[]');
    } catch { answers = []; }

    await updatePack((pack) => {
      pack.server = String(form.get('server') || record.settings.guildName || pack.server || '').slice(0, 80);
      pack.about = String(form.get('about') || '').slice(0, 1200);
      pack.tone = String(form.get('tone') || '').slice(0, 40);
      pack.hours = String(form.get('hours') || '').slice(0, 120);
      pack.hardFacts = String(form.get('hardFacts') || '').slice(0, 800);
      pack.escalateWhen = String(form.get('escalateWhen') || '').slice(0, 400);
      pack.answers = answers.slice(0, 100).map((a, i) => ({
        id: `w${i + 1}`,
        question: String(a.question || '').slice(0, 200),
        answer: String(a.answer || '').slice(0, 900),
        keywords: String(`${a.question || ''}`).toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 12),
      }));
    });

    // Old assistant turns mention the previous server description; drop them.
    require('./converse').clearAllHistory();

    settings.describedAt = Date.now();
    await save();

    res.writeHead(303, { Location: `/g/${token}?saved=1` });
    res.end();
    return;
  }

  const pack = await loadPack();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page({
    guildName: settings.guildName || 'this server',
    token,
    pack,
    saved: url.searchParams.get('saved') === '1',
  }));
}

let server = null;

function start() {
  if (DISABLED) return null;
  if (server) return server;
  server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[web]', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    });
  });
  // A web server that cannot bind must never take a slash command down with it.
  server.on('error', (err) => {
    console.warn(`[web] disabled: ${err.code || err.message} on ${HOST}:${PORT}`);
    server = null;
  });
  try {
    server.listen(PORT, HOST, () => {
      console.log(`[centerside] setup editor listening on ${HOST}:${PORT}`);
    });
  } catch (err) {
    console.warn(`[web] disabled: ${err.message}`);
    server = null;
  }
  return server;
}

function urlFor(token) {
  const base = process.env.WEB_BASE || `http://127.0.0.1:${PORT}`;
  return `${base.replace(/\/$/, '')}/g/${token}`;
}

module.exports = { start, tokenFor, urlFor, authorizeUrl, redirectUri, PORT };
