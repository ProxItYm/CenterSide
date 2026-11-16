'use strict';

/*
 * Some panels refuse to open dotfiles, which makes .env impossible to edit.
 * Load .env when it exists, then fall back to a plain file called `env`.
 * Real environment variables always win over both.
 */

const fs = require('node:fs');
const path = require('node:path');

function parse(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const root = path.join(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(root, '.env') });
} catch { /* dotenv optional */ }

for (const name of ['env', 'env.txt', '.env.txt']) {
  if (process.env.DISCORD_TOKEN) break;
  try {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const [key, value] of Object.entries(parse(text))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch { /* not there */ }
}

module.exports = {};
