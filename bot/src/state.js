'use strict';

const { JsonStore, guildState, EMPTY_STATE } = require('./store');
const { stateFile } = require('./config');

const store = new JsonStore(stateFile, EMPTY_STATE);

/** Live guild record. Mutate it, then call save(). */
async function guildRecord(guildId) {
  const state = await store.load();
  return guildState(state, guildId);
}

async function settingsFor(guildId) {
  return (await guildRecord(guildId)).settings;
}

async function save() {
  await store.save();
}

module.exports = { guildRecord, settingsFor, save, stateStore: store };
