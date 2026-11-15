'use strict';

/*
 * Offline self-test. No token, no network — it exercises the parts that break
 * silently: pack matching, escalation triggers, store round-trips, transcripts.
 * Run with: npm run selftest
 */

const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const { loadPack, buildAnswer, composeReply, findAnswer, keywordsFor, updatePack, addAnswer, removeAnswer } = require('../src/knowledge');
const { JsonStore, EMPTY_STATE, guildState } = require('../src/store');

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

async function main() {
  const pack = await loadPack();
  console.log(`pack: ${pack.server || '(unnamed)'} · ${pack.answers.length} answers`);

  check('purchase role question matches a1', () => {
    const hit = findAnswer(pack, 'hey i bought the asset pack yesterday but the role never showed up');
    assert(hit, 'expected a match');
    assert.strictEqual(hit.answer.id, 'a1');
  });

  check('refund question matches a3', () => {
    const hit = findAnswer(pack, 'can i get a refund on a duplicate order');
    assert(hit);
    assert.strictEqual(hit.answer.id, 'a3');
  });

  check('unrelated question does not match', () => {
    const hit = findAnswer(pack, 'does this server support linux ARM servers');
    assert.strictEqual(hit, null);
  });

  check('unmatched question escalates', () => {
    const result = buildAnswer(pack, 'what is the airspeed velocity of an unladen swallow');
    assert.strictEqual(result.matched, null);
    assert.strictEqual(result.escalate, true);
  });

  check('chargeback keyword escalates', () => {
    const result = buildAnswer(pack, 'i will do a chargeback if this is not fixed');
    assert.strictEqual(result.escalate, true);
    assert.match(String(result.escalateReason), /chargeback/);
  });

  check('tone changes the clarifying opener', () => {
    const formal = composeReply({ ...pack, tone: 'Professional' }, 'something about quantum fog', 'there', 0);
    assert.strictEqual(formal.mode, 'clarify');
    assert.match(formal.text, /^Hello /);
  });

  check('clarify asks a question instead of escalating', () => {
    const reply = composeReply(pack, 'my thing is weird', 'there', 0);
    assert.strictEqual(reply.mode, 'clarify');
    assert.match(reply.text, /\?/);
  });

  check('escalates only after the bot runs out of questions', () => {
    const first = composeReply(pack, 'my thing is weird', 'there', 0);
    const third = composeReply(pack, 'my thing is weird', 'there', 3);
    assert.strictEqual(first.mode, 'clarify');
    assert.strictEqual(third.mode, 'escalate');
  });

  check('keywordsFor drops stopwords', () => {
    const words = keywordsFor('How do I get my purchased role');
    assert(words.includes('purchased'));
    assert(!words.includes('how'));
  });

  check('store round-trips and creates guild defaults', async () => {
    const file = path.join(os.tmpdir(), `centerside-test-${Date.now()}.json`);
    const store = new JsonStore(file, EMPTY_STATE);
    const state = await store.load();
    const guild = guildState(state, 'g1');
    assert.deepStrictEqual(guild.tickets, {});
    assert.strictEqual(guild.settings.slaMinutes, 15);
    guild.counter = 7;
    await store.save();
    const again = new JsonStore(file, EMPTY_STATE);
    const reloaded = await again.load();
    assert.strictEqual(reloaded.guilds.g1.counter, 7);
  });

  // add / remove round trip against the real pack, then restore it
  const before = JSON.parse(JSON.stringify(pack.answers));
  await updatePack((p) => addAnswer(p, 'Do you have a test lane?', 'Yes, this entry exists only during the self-test.'));
  await updatePack(async (p) => {
    const added = p.answers.find((a) => a.question === 'Do you have a test lane?');
    assert(added, 'answer was not added');
    await removeAnswer(p, added.id);
  });
  await updatePack((p) => {
    p.answers = before;
  });
  console.log('  ok   add/remove answer round trip');

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
