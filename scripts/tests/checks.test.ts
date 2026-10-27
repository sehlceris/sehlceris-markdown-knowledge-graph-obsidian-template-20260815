import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkFrontmatter, checkLinks, type FrontmatterReport } from '../lib/checks.ts';
import { loadVault } from '../lib/vault-fs.ts';
import { TAG_VOCABULARY_FILE } from '../lib/vocabulary.ts';
import { makeVault, note } from './helpers.ts';

const links = (files: Record<string, string>) => checkLinks(loadVault(makeVault(files)));
const frontmatter = (files: Record<string, string>, opts?: Parameters<typeof makeVault>[1]) =>
  checkFrontmatter(loadVault(makeVault(files, opts)));

describe('checkLinks', () => {
  it('passes a vault whose links all resolve', () => {
    const report = links({
      '06-knowledge/a.md': note('Points at [[b]].'),
      '06-knowledge/b.md': note('Points back at [[a]].'),
    });
    assert.deepEqual(report, { ok: true, notes: 2, broken: [], ambiguous: [], orphans: [] });
  });

  it('fails on a link pointing at nothing', () => {
    const report = links({
      '06-knowledge/a.md': note('Points at [[gone]].'),
      '06-knowledge/b.md': note('Points at [[a]].'),
    });
    assert.equal(report.ok, false);
    assert.deepEqual(report.broken, [{ from: '06-knowledge/a.md', target: 'gone', raw: '[[gone]]' }]);
  });

  it('fails on a bare link that matches two notes', () => {
    const report = links({
      '06-knowledge/note.md': note('x'),
      '07-references/note.md': note('x'),
      '06-knowledge/a.md': note('Bare [[note]].'),
    });
    assert.equal(report.ok, false);
    assert.equal(report.ambiguous.length, 1);
    assert.deepEqual(report.ambiguous[0]?.matches.sort(), ['06-knowledge/note.md', '07-references/note.md']);
  });

  it('lists an orphan without failing — it may be waiting for the note that cites it', () => {
    const report = links({
      '06-knowledge/lonely.md': note('x'),
      '06-knowledge/a.md': note('x'),
      '06-knowledge/b.md': note('Points at [[a]].'),
    });
    assert.equal(report.ok, true);
    assert.deepEqual(report.orphans.sort(), ['06-knowledge/b.md', '06-knowledge/lonely.md']);
  });

  it('does not count a link quoted in a code fence', () => {
    const report = links({
      '06-knowledge/a.md': note('A link looks like:\n\n```\n[[imaginary]]\n```\n\nand `[[also]]`.'),
    });
    assert.equal(report.ok, true);
    assert.deepEqual(report.broken, []);
  });

  it('resolves an embedded attachment rather than calling it broken', () => {
    const report = links({
      '03-initiatives/deck.md': note('![[deck-plan.png]]'),
      '03-initiatives/deck-plan.png': 'not really a png',
    });
    assert.equal(report.ok, true);
    assert.deepEqual(report.broken, []);
  });

  it('reports the same dead target once per note however often it is written', () => {
    assert.equal(links({ '06-knowledge/a.md': note('[[gone]] and [[gone]] again.') }).broken.length, 1);
  });
});

const clean = note('Body.', ['work']);
const emptyTags = '---\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags:\n---\n';

/** The messages for `path`, so a test names the defect it is about. */
const problemsFor = (report: FrontmatterReport, path: string): string[] =>
  report.problems.filter((p) => p.path === path).map((p) => p.message);

describe('checkFrontmatter', () => {
  it('passes a note carrying the convention', () => {
    assert.deepEqual(frontmatter({ '06-knowledge/a.md': clean }), { ok: true, checked: 1, problems: [] });
  });

  it('fails a note with no frontmatter block', () => {
    const report = frontmatter({ '06-knowledge/a.md': '# Just a heading\n' });
    assert.equal(report.ok, false);
    assert.deepEqual(problemsFor(report, '06-knowledge/a.md'), ['no frontmatter']);
  });

  it('fails a note missing a required key', () => {
    const report = frontmatter({
      '06-knowledge/a.md': '---\ncreated: 2026-01-01\ntags:\n  - work\n---\n\nBody.\n',
    });
    assert.equal(report.ok, false);
    assert.deepEqual(problemsFor(report, '06-knowledge/a.md'), ['missing updated:']);
  });

  it('fails tags written as an inline array', () => {
    const report = frontmatter({
      '06-knowledge/a.md': '---\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags: [work, people]\n---\n\nBody.\n',
    });
    assert.equal(report.ok, false);
    assert.deepEqual(problemsFor(report, '06-knowledge/a.md'), [
      'tags is an inline array; Obsidian writes a block sequence',
    ]);
  });

  it('fails a tag outside the closed vocabulary', () => {
    const report = frontmatter({ '06-knowledge/a.md': note('', ['work', 'astrology']) });
    assert.equal(report.ok, false);
    assert.deepEqual(problemsFor(report, '06-knowledge/a.md'), [
      'unknown tag "astrology"; reuse a registered tag, or kg tag add <tag> for a new domain',
    ]);
  });

  for (const path of [
    '01-daily/2026-01-01.md',
    '02-inbox/capture.md',
    'templates/placeholder.md',
    '08-archive/01-daily/2026-01-01.md',
    '08-archive/02-inbox/capture.md',
    '08-archive/templates/placeholder.md',
  ]) {
    it(`accepts empty tags at ${path}`, () => {
      assert.deepEqual(frontmatter({ [path]: emptyTags }).problems, []);
    });
  }

  for (const path of [
    '03-initiatives/a.md',
    '04-areas/a.md',
    '05-entities/a.md',
    '06-knowledge/a.md',
    '07-references/a.md',
    '08-archive/03-initiatives/a.md',
    '08-archive/04-areas/a.md',
    '08-archive/05-entities/a.md',
    '08-archive/06-knowledge/a.md',
    '08-archive/07-references/a.md',
  ]) {
    it(`requires a domain tag at ${path}`, () => {
      assert.ok(
        problemsFor(frontmatter({ [path]: emptyTags }), path).includes('at least one registered domain tag is required')
      );
    });
  }

  for (const path of ['02-inbox/shape.md', '06-knowledge/shape.md']) {
    it(`requires a domain when non-empty tags at ${path} are shape-only`, () => {
      assert.ok(
        problemsFor(frontmatter({ [path]: note('', ['measurement']) }), path).includes(
          'at least one registered domain tag is required'
        )
      );
    });
  }

  it('fails a status on a bucket that does not carry one', () => {
    const report = frontmatter({ '06-knowledge/a.md': note('', ['work'], 'status: active\n') });
    assert.equal(report.ok, false);
    assert.match(problemsFor(report, '06-knowledge/a.md')[0] ?? '', /status "active"/);
  });

  it('accepts a status on an initiative, live or archived', () => {
    const withStatus = note('', ['work'], 'status: active\n');
    const report = frontmatter({
      '03-initiatives/a.md': withStatus,
      '08-archive/03-initiatives/b.md': withStatus,
    });
    assert.deepEqual(report.problems, []);
  });

  it('accepts the empty status: a template ships as a placeholder', () => {
    const report = frontmatter({
      'templates/initiative-note.md': '---\ncreated: YYYY-MM-DD\nupdated: YYYY-MM-DD\ntags:\nstatus:\n---\n\n# Title\n',
    });
    assert.deepEqual(report, { ok: true, checked: 1, problems: [] });
  });

  // The regression the scoped tag-block regex exists for. Obsidian's Properties pane
  // writes `aliases:` as soon as one is added, and a checker that reads every `  - x` in
  // the block calls "Janey" an unknown tag — the note is correct and the checker is wrong.
  it('passes a note with an aliases: block sequence beside tags:', () => {
    const report = frontmatter({
      '05-entities/jane-okafor.md':
        '---\ncreated: 2026-01-01\nupdated: 2026-01-01\naliases:\n  - Janey\n  - J. Okafor\n' +
        'tags:\n  - people\n---\n\nBody.\n',
    });
    assert.deepEqual(report.problems, []);
  });

  it('fails a group entity named by first name when the fuller name is in the vault', () => {
    const report = frontmatter({
      '05-entities/jane-family.md': clean,
      '05-entities/jane-okafor.md': clean,
    });
    assert.equal(report.ok, false);
    assert.deepEqual(problemsFor(report, '05-entities/jane-family.md'), [
      'names a person by first name only — use jane-okafor-family',
    ]);
  });

  it('leaves a group entity alone when no fuller name exists', () => {
    assert.deepEqual(frontmatter({ '05-entities/elm-court-friends.md': clean }).problems, []);
  });

  // An unusable vocabulary is one problem, reported against the file at fault — not one
  // unknown-tag diagnostic per note, and not a crash that hides the structural checks.
  describe('without a usable vocabulary', () => {
    const cases: [string, string | null, RegExp][] = [
      ['absent', null, /missing; run kg tag add <tag>/],
      ['malformed', '{', /malformed tag vocabulary: invalid JSON/],
      ['empty', '{"domainTags":[],"shapeTags":[]}', /domainTags is empty/],
    ];
    for (const [name, vocabulary, message] of cases) {
      it(`reports a vocabulary that is ${name} once, on ${TAG_VOCABULARY_FILE}`, () => {
        const report = frontmatter(
          { '06-knowledge/a.md': clean, '06-knowledge/b.md': clean, '06-knowledge/c.md': '# no frontmatter\n' },
          { vocabulary }
        );
        assert.equal(report.ok, false);
        const own = problemsFor(report, TAG_VOCABULARY_FILE);
        assert.equal(own.length, 1);
        assert.match(own[0]!, message);
        assert.deepEqual(problemsFor(report, '06-knowledge/a.md'), []);
        assert.deepEqual(problemsFor(report, '06-knowledge/c.md'), ['no frontmatter']);
      });
    }
  });
});
