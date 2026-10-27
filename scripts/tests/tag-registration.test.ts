// Registering a domain tag rewrites the vocabulary every frontmatter check reads, so the
// suite asserts what is written as hard as what is refused: a plan never writes, a refusal
// leaves the bytes alone, and malformed JSON is never repaired over.

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  applyTagRegistration,
  isOneEditApart,
  loadTagVocabulary,
  planTagRegistration,
  TAG_VOCABULARY_FILE,
  type TagVocabulary,
} from '../lib/vocabulary.ts';
import { makeVault, read, TEST_TAG_VOCABULARY } from './helpers.ts';

const json = (v: TagVocabulary): string => `${JSON.stringify(v, null, 2)}\n`;
const bytes = (dir: string): string => read(dir, TAG_VOCABULARY_FILE);
/** The vocabulary and anything named after it — a leftover temp file shows up here. */
const operationFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith(TAG_VOCABULARY_FILE));

function register(dir: string, tag: string, opts: { allowNearDuplicate?: boolean } = {}) {
  const plan = planTagRegistration(dir, tag, opts);
  applyTagRegistration(dir, plan);
  return plan;
}

describe('planTagRegistration', () => {
  it('plans without writing and advertises the sorted vocabulary it would write', () => {
    const dir = makeVault({});
    const before = bytes(dir);

    const plan = planTagRegistration(dir, 'gardening');

    assert.equal(bytes(dir), before);
    assert.deepEqual(plan, {
      tag: 'gardening',
      outcome: 'added',
      reason: null,
      nearDuplicates: [],
      vocabulary: {
        domainTags: [...TEST_TAG_VOCABULARY.domainTags, 'gardening'].sort(),
        shapeTags: TEST_TAG_VOCABULARY.shapeTags,
      },
    });
  });

  it('rejects a tag that is not lowercase kebab-case before reading anything', () => {
    const dir = makeVault({});
    for (const bad of ['Not-A-Tag', 'two words', 'trailing-', '-leading', 'double--dash', '']) {
      assert.throws(() => planTagRegistration(dir, bad), /lowercase kebab-case/, bad);
    }
  });

  it('refuses a tag already registered as a shape tag', () => {
    const dir = makeVault({});
    const before = bytes(dir);

    const plan = register(dir, 'measurement');

    assert.equal(plan.outcome, 'refused');
    assert.match(plan.reason!, /already registered as a shape tag/);
    assert.equal(bytes(dir), before);
  });
});

describe('applyTagRegistration', () => {
  it('adds a domain that strict loading sees immediately, and leaves no temp file', () => {
    const dir = makeVault({});

    const plan = register(dir, 'gardening');

    assert.equal(plan.outcome, 'added');
    assert.equal(bytes(dir), json(plan.vocabulary));
    assert.deepEqual(loadTagVocabulary(dir), plan.vocabulary);
    assert.deepEqual(operationFiles(dir), [TAG_VOCABULARY_FILE]);
  });

  it('creates an absent vocabulary', () => {
    const dir = makeVault({}, { vocabulary: null });
    assert.equal(existsSync(join(dir, TAG_VOCABULARY_FILE)), false);

    const plan = register(dir, 'first-domain');

    assert.deepEqual(plan.vocabulary, { domainTags: ['first-domain'], shapeTags: [] });
    assert.deepEqual(loadTagVocabulary(dir), plan.vocabulary);
  });

  it('initializes a domain-empty vocabulary, keeping its shape tags', () => {
    const dir = makeVault({}, { vocabulary: { domainTags: [], shapeTags: ['measurement'] } });
    // Strict loading refuses an empty domain list; registration is how it gets repaired.
    assert.throws(() => loadTagVocabulary(dir), /domainTags is empty/);

    const plan = register(dir, 'first-domain');

    assert.deepEqual(loadTagVocabulary(dir), { domainTags: ['first-domain'], shapeTags: ['measurement'] });
    assert.equal(plan.outcome, 'added');
  });

  it('keeps an exact existing registration byte-identical', () => {
    // Compact, not the pretty form we would write: proof that nothing was rewritten.
    const custom = '{"domainTags":["work"],"shapeTags":[]}\n';
    const dir = makeVault({}, { vocabulary: custom });

    const plan = register(dir, 'work');

    assert.equal(plan.outcome, 'existing');
    assert.equal(bytes(dir), custom);
  });

  it('preserves malformed vocabulary rather than repairing over it', () => {
    const malformed = '{"domainTags":["work"],"shapeTags":[';
    const dir = makeVault({}, { vocabulary: malformed });

    assert.throws(() => planTagRegistration(dir, 'gardening'), /malformed tag vocabulary: invalid JSON/);
    assert.equal(bytes(dir), malformed);
    assert.deepEqual(operationFiles(dir), [TAG_VOCABULARY_FILE]);
  });

  it('writes nothing for a plan that did not add', () => {
    const dir = makeVault({}, { vocabulary: { domainTags: ['cycling'], shapeTags: [] } });
    const before = bytes(dir);

    applyTagRegistration(dir, planTagRegistration(dir, 'cycling'));
    applyTagRegistration(dir, planTagRegistration(dir, 'cyclng'));

    assert.equal(bytes(dir), before);
  });
});

describe('near duplicates', () => {
  for (const [left, right] of [
    ['cyclng', 'cycling'],
    ['cyclings', 'cycling'],
    ['cyxling', 'cycling'],
    ['cycilng', 'cycling'],
  ] as const) {
    it(`recognizes ${left} / ${right} as one edit apart (insert, delete, substitute, transpose)`, () => {
      assert.equal(isOneEditApart(left, right), true);
      assert.equal(isOneEditApart(right, left), true);
    });
  }

  for (const [left, right] of [
    ['cycling', 'cycling'],
    ['cycling', 'cyclingxx'],
    ['cycling', 'cyxlinx'],
    ['cycling', 'ycclign'],
    ['work', 'pottery'],
  ] as const) {
    it(`does not call ${left} / ${right} one edit apart`, () => {
      assert.equal(isOneEditApart(left, right), false);
    });
  }

  it('refuses a near duplicate by default and accepts it only with the explicit override', () => {
    const vocabulary = { domainTags: ['cycling'], shapeTags: [] };
    const dir = makeVault({}, { vocabulary });

    const refused = register(dir, 'cyclng');
    assert.equal(refused.outcome, 'refused');
    assert.deepEqual(refused.nearDuplicates, ['cycling']);
    assert.match(refused.reason!, /--allow-near-duplicate/);
    assert.equal(bytes(dir), json(vocabulary));

    const accepted = register(dir, 'cyclng', { allowNearDuplicate: true });
    assert.equal(accepted.outcome, 'added');
    assert.deepEqual(accepted.nearDuplicates, ['cycling']);
    assert.deepEqual(loadTagVocabulary(dir).domainTags, ['cycling', 'cyclng']);
  });

  it('counts a shape tag as a near duplicate too', () => {
    const dir = makeVault({});
    assert.deepEqual(planTagRegistration(dir, 'measurements').nearDuplicates, ['measurement']);
  });
});
