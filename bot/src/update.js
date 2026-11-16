'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/*
 * Pulls the current source from GitHub and writes it over the running copy.
 * Data is never touched: data/state.json, data/pack.json and transcripts stay
 * exactly where they are, which is the whole point — update without setup.
 */

const REPO = process.env.UPDATE_REPO || 'ProxItYm/CenterSide';
const BRANCH = process.env.UPDATE_BRANCH || 'main';
const KEEP = new Set(['data', 'node_modules', '.env', 'env', 'env.txt']);

async function listSources() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/bot/src?ref=${BRANCH}`, {
    headers: { 'User-Agent': 'CenterSide', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const items = await res.json();
  return items.filter((i) => i.type === 'file' && i.name.endsWith('.js')).map((i) => i.name);
}

async function runUpdate() {
  const root = path.join(__dirname, '..');
  const names = await listSources();
  const written = [];

  for (const name of names) {
    if (KEEP.has(name)) continue;
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/bot/src/${name}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CenterSide' } });
    if (!res.ok) continue;
    const text = await res.text();
    if (!text.includes('use strict') && !text.includes('module.exports')) continue;
    await fs.writeFile(path.join(root, 'src', name), text, 'utf8');
    written.push(name);
  }

  if (!written.length) throw new Error('nothing downloaded');
  return written;
}

module.exports = { runUpdate };
