import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadTagVocabulary,
  readVocabulary,
  tagProblems,
  TAG_VOCABULARY_FILE,
  type TagVocabulary,
} from '../lib/vocabulary.ts';
import { makeVault } from './helpers.ts';

const load = (source: string): TagVocabulary => loadTagVocabulary(makeVault({}, { vocabulary: source }));

describe('loadTagVocabulary', () => {
  it('loads explicit domains and permits an empty shape vocabulary', () => {
    assert.deepEqual(load('{"domainTags":["computing","house-elm"],"shapeTags":[]}'), {
      domainTags: ['computing', 'house-elm'],
      shapeTags: [],
    });
  });

  it('throws on an absent vocabulary, naming the file', () => {
    const dir = makeVault({}, { vocabulary: null });
    assert.throws(() => loadTagVocabulary(dir), (err: Error) => {
      assert.ok(err.message.startsWith(`${dir}/${TAG_VOCABULARY_FILE}: missing`));
      return true;
    });
  });

  const malformed: [string, string][] = [
    ['', 'invalid JSON'],
    ['{', 'invalid JSON'],
    ['[]', 'expected an object'],
    ['{"domainTags":["work"]}', 'expected only domainTags and shapeTags'],
    ['{"domainTags":["work"],"shapeTags":[],"extra":true}', 'expected only domainTags and shapeTags'],
    ['{"domainTags":"work","shapeTags":[]}', 'domainTags must be an array of strings'],
    ['{"domainTags":["work",1],"shapeTags":[]}', 'domainTags must be an array of strings'],
    ['{"domainTags":["work","work"],"shapeTags":[]}', 'domainTags contains a duplicate'],
    ['{"domainTags":["work"],"shapeTags":["work"]}', 'tags cannot appear in both lists'],
    ['{"domainTags":[" work"],"shapeTags":[]}', 'domainTags contains a tag that is not lowercase kebab-case'],
    ['{"domainTags":["Work"],"shapeTags":[]}', 'domainTags contains a tag that is not lowercase kebab-case'],
  ];
  for (const [source, detail] of malformed) {
    it(`rejects malformed vocabulary ${JSON.stringify(source)}`, () => {
      assert.throws(() => load(source), (err: Error) => {
        assert.match(err.message, /malformed tag vocabulary/);
        assert.ok(err.message.includes(detail), err.message);
        return true;
      });
    });
  }

  it('refuses an empty domain vocabulary as uninitialized and repairable', () => {
    assert.throws(() => load('{"domainTags":[],"shapeTags":["measurement"]}'), /domainTags is empty; run kg tag add <tag>/);
  });
});

describe('readVocabulary', () => {
  it('returns null for an absent file — registration starts from nothing', () => {
    assert.equal(readVocabulary(makeVault({}, { vocabulary: null })), null);
  });

  it('accepts an empty domain list that the strict loader refuses', () => {
    const dir = makeVault({}, { vocabulary: '{"domainTags":[],"shapeTags":[]}' });
    assert.deepEqual(readVocabulary(dir), { domainTags: [], shapeTags: [] });
  });

  // Malformed has to be corrected deliberately, never read as absent and overwritten.
  it('still throws on malformed JSON', () => {
    assert.throws(() => readVocabulary(makeVault({}, { vocabulary: '{' })), /invalid JSON/);
  });
});

describe('tagProblems', () => {
  const vocabulary: TagVocabulary = { domainTags: ['work', 'pottery'], shapeTags: ['measurement'] };
  const REQUIRED = 'at least one registered domain tag is required';

  it('passes a registered domain, alone or with a shape', () => {
    assert.deepEqual(tagProblems(vocabulary, ['work'], false), []);
    assert.deepEqual(tagProblems(vocabulary, ['measurement', 'pottery'], false), []);
  });

  it('permits empty tags only where asked', () => {
    assert.deepEqual(tagProblems(vocabulary, [], true), []);
    assert.deepEqual(tagProblems(vocabulary, [], false), [REQUIRED]);
  });

  it('requires a domain even where empty is permitted, once there are tags', () => {
    assert.deepEqual(tagProblems(vocabulary, ['measurement'], true), [REQUIRED]);
  });

  it('names each unknown tag, and still wants a domain beside them', () => {
    assert.deepEqual(tagProblems(vocabulary, ['astrology', 'tarot'], false), [
      'unknown tag "astrology"; reuse a registered tag, or kg tag add <tag> for a new domain',
      'unknown tag "tarot"; reuse a registered tag, or kg tag add <tag> for a new domain',
      REQUIRED,
    ]);
  });
});
