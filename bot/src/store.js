'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { defaults } = require('./config');

const EMPTY_STATE = { guilds: {} };
const EMPTY_PACK = {
  server: '',
  about: '',
  tone: 'Friendly & casual',
  hours: '',
  hardFacts: '',
  escalateWhen: '',
  answers: [],
};

/**
 * Tiny JSON store. Reads once, keeps the parsed object in memory, and writes
 * atomically (tmp file + rename) so a crash mid-write never truncates state.
 * Writes are serialised per file through a promise chain.
 */
class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.cache = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.cache = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Corrupt file: keep a copy instead of silently eating the data.
        await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => {});
      }
      this.cache = structuredClone(this.fallback);
    }
    return this.cache;
  }

  save() {
    const snapshot = JSON.stringify(this.cache, null, 2);
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }

  async update(mutator) {
    const data = await this.load();
    const result = await mutator(data);
    await this.save();
    return result;
  }
}

/** Returns the guild slice, creating it with defaults if the guild is new. */
function guildState(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = {
      counter: 0,
      settings: structuredClone(defaults),
      tickets: {},
      history: [],
    };
  }
  const guild = state.guilds[guildId];
  guild.settings = { ...structuredClone(defaults), ...guild.settings };
  return guild;
}

module.exports = { JsonStore, guildState, EMPTY_STATE, EMPTY_PACK };
