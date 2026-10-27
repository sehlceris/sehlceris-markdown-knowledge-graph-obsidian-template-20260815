import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLinkGraph, resolveLink, resolveTarget, shortestTarget } from '../lib/graph.ts';
import { entryOf, loadVault, type VaultEntry } from '../lib/vault.ts';
import { makeVault, note } from './helpers.ts';

const notes = (...paths: string[]): VaultEntry[] => paths.map((p) => entryOf(p, true));
const assets = (...paths: string[]): VaultEntry[] => paths.map((p) => entryOf(p, false));
const paths = (entries: VaultEntry[]): string[] => entries.map((e) => e.path);

const CORPUS = notes(
  '06-knowledge/note.md',
  '03-initiatives/folder/note.md',
  '03-initiatives/house-elm/deck-rebuild.md',
  '04-areas/house-elm/house-elm.md',
  '05-entities/marco-delacroix.md'
);

describe('resolveTarget', () => {
  it('matches a unique basename', () => {
    assert.deepEqual(paths(resolveTarget('deck-rebuild', CORPUS)), ['03-initiatives/house-elm/deck-rebuild.md']);
  });

  it('returns both notes for a duplicate basename — duplicates are legal', () => {
    assert.deepEqual(paths(resolveTarget('note', CORPUS)), ['06-knowledge/note.md', '03-initiatives/folder/note.md']);
  });

  it('disambiguates by path suffix', () => {
    assert.deepEqual(paths(resolveTarget('folder/note', CORPUS)), ['03-initiatives/folder/note.md']);
  });

  it('matches from any depth of suffix', () => {
    assert.deepEqual(paths(resolveTarget('03-initiatives/folder/note', CORPUS)), ['03-initiatives/folder/note.md']);
  });

  it('matches on segment boundaries — a partial segment is not a match', () => {
    // "e" is a partial segment of "house-elm", not a segment.
    assert.deepEqual(resolveTarget('e/deck-rebuild', CORPUS), []);
    assert.deepEqual(resolveTarget('elm/deck-rebuild', CORPUS), []);
    assert.deepEqual(resolveTarget('lder/note', CORPUS), []);
  });

  it('does not match a suffix of the basename either', () => {
    assert.deepEqual(resolveTarget('rebuild', CORPUS), []);
    assert.deepEqual(resolveTarget('ote', CORPUS), []);
  });

  it('strips a leading slash — it means from the vault root', () => {
    assert.deepEqual(paths(resolveTarget('/03-initiatives/folder/note', CORPUS)), ['03-initiatives/folder/note.md']);
    assert.equal(resolveTarget('/note', CORPUS).length, 2);
  });

  it('strips a .md suffix', () => {
    assert.deepEqual(paths(resolveTarget('deck-rebuild.md', CORPUS)), ['03-initiatives/house-elm/deck-rebuild.md']);
    assert.deepEqual(paths(resolveTarget('/03-initiatives/folder/note.md', CORPUS)), [
      '03-initiatives/folder/note.md',
    ]);
  });

  it('does not resolve a target longer than the path', () => {
    assert.deepEqual(resolveTarget('vault/06-knowledge/note', CORPUS), []);
  });

  it('is case sensitive — folding case is a known deferred gap', () => {
    assert.deepEqual(resolveTarget('Deck-Rebuild', CORPUS), []);
  });

  it('resolves assets by their full filename, extension included', () => {
    const among = assets('03-initiatives/house-elm/deck-plan.png');
    assert.deepEqual(paths(resolveTarget('deck-plan.png', among)), ['03-initiatives/house-elm/deck-plan.png']);
    assert.deepEqual(resolveTarget('deck-plan', among), []);
  });

  it('resolves a note whose folder repeats its name', () => {
    assert.deepEqual(paths(resolveTarget('house-elm', CORPUS)), ['04-areas/house-elm/house-elm.md']);
  });
});

describe('resolveLink', () => {
  // [[diagram.png]] names both a note "diagram.png.md" and an asset "diagram.png"; Obsidian
  // answers with the note and never calls it ambiguous.
  it('asks the notes first and the assets only when no note answers', () => {
    const n = notes('06-knowledge/diagram.png.md');
    const a = assets('06-knowledge/diagram.png', '06-knowledge/sketch.png');
    assert.deepEqual(paths(resolveLink('diagram.png', n, a)), ['06-knowledge/diagram.png.md']);
    assert.deepEqual(paths(resolveLink('sketch.png', n, a)), ['06-knowledge/sketch.png']);
    assert.deepEqual(resolveLink('absent', n, a), []);
  });
});

describe('shortestTarget', () => {
  it('uses the bare basename when it is unique', () => {
    const entry = CORPUS.find((e) => e.basename === 'deck-rebuild')!;
    assert.equal(shortestTarget(entry, CORPUS, []), 'deck-rebuild');
  });

  it('lengthens to the shortest disambiguating suffix', () => {
    const a = CORPUS.find((e) => e.path === '06-knowledge/note.md')!;
    const b = CORPUS.find((e) => e.path === '03-initiatives/folder/note.md')!;
    assert.equal(shortestTarget(a, CORPUS, []), '06-knowledge/note');
    assert.equal(shortestTarget(b, CORPUS, []), 'folder/note');
  });

  it('stops at the first suffix that identifies one note', () => {
    const among = notes('a/x/deep/note.md', 'b/y/deep/note.md', 'a/z/other.md');
    assert.equal(shortestTarget(among[0]!, among, []), 'x/deep/note');
    assert.equal(shortestTarget(among[1]!, among, []), 'y/deep/note');
  });

  it('falls back to the full path when even that is ambiguous', () => {
    const dup = entryOf('06-knowledge/note.md', true);
    assert.equal(shortestTarget(dup, [dup, entryOf('06-knowledge/note.md', true)], []), '06-knowledge/note');
  });

  it('returns the full path for an entry not present in the index', () => {
    const stranger = entryOf('07-references/absent.md', true);
    assert.equal(shortestTarget(stranger, notes('06-knowledge/note.md'), []), '07-references/absent');
  });

  // A bare asset name loses to a note of the same name, so the asset needs its folder.
  it('lengthens an asset shadowed by a note', () => {
    const asset = entryOf('03-initiatives/deck/plan.png', false);
    const n = notes('06-knowledge/plan.png.md');
    assert.equal(shortestTarget(asset, n, [asset]), 'deck/plan.png');
  });
});

describe('buildLinkGraph', () => {
  const graphOf = (files: Record<string, string>) => buildLinkGraph(loadVault(makeVault(files)));

  it('records outgoing and inbound refs by resolved path', () => {
    const graph = graphOf({
      '06-knowledge/a.md': note('Points at [[b]] and [[c|see c]].'),
      '06-knowledge/b.md': note('Points back at [[a]].'),
      '06-knowledge/c.md': note('Nothing outgoing.'),
    });
    assert.deepEqual(
      graph.outgoing('06-knowledge/a.md').map((r) => r.to),
      ['06-knowledge/b.md', '06-knowledge/c.md']
    );
    assert.deepEqual(
      graph.backlinks('06-knowledge/c.md').map((r) => r.from),
      ['06-knowledge/a.md']
    );
    assert.deepEqual(graph.broken, []);
    assert.deepEqual(graph.ambiguous, []);
  });

  it('reports a link pointing at nothing', () => {
    const graph = graphOf({ '06-knowledge/a.md': note('Points at [[gone]].') });
    assert.equal(graph.broken.length, 1);
    assert.equal(graph.broken[0]?.from, '06-knowledge/a.md');
    assert.equal(graph.broken[0]?.link.target, 'gone');
  });

  it('reports a bare link that matches two notes, and accepts the lengthened one', () => {
    const graph = graphOf({
      '06-knowledge/note.md': note('x'),
      '07-references/note.md': note('x'),
      '06-knowledge/a.md': note('Bare [[note]] and specific [[07-references/note]].'),
    });
    assert.equal(graph.ambiguous.length, 1);
    assert.deepEqual(graph.ambiguous[0]?.matches.sort(), ['06-knowledge/note.md', '07-references/note.md']);
    assert.deepEqual(
      graph.outgoing('06-knowledge/a.md').map((r) => r.to),
      ['07-references/note.md']
    );
  });

  it('resolves an embedded asset and never calls it an orphan', () => {
    const graph = graphOf({
      '06-knowledge/a.md': note('![[deck-plan.png]]'),
      '06-knowledge/deck-plan.png': 'not really a png',
    });
    assert.deepEqual(graph.broken, []);
    assert.deepEqual(
      graph.outgoing('06-knowledge/a.md').map((r) => r.to),
      ['06-knowledge/deck-plan.png']
    );
    assert.ok(!graph.orphans.includes('06-knowledge/deck-plan.png'));
  });

  it('does not scan an asset for outgoing links', () => {
    const graph = graphOf({
      '06-knowledge/a.md': note('![[notes.txt]]'),
      '06-knowledge/notes.txt': '[[a-target-that-does-not-exist]]',
    });
    assert.deepEqual(graph.broken, []);
    assert.deepEqual(graph.outgoing('06-knowledge/notes.txt'), []);
  });

  it('lists notes nothing points at, exempting the capture buckets', () => {
    const graph = graphOf({
      '06-knowledge/lonely.md': note('x'),
      '01-daily/2026-01-01.md': note('x'),
      '02-inbox/scratch.md': note('x'),
      'templates/daily-note.md': note('x'),
      '08-archive/01-daily/2025-01-01.md': note('x'),
      '08-archive/02-inbox/old-scratch.md': note('x'),
      '08-archive/06-knowledge/old.md': note('x'),
    });
    assert.deepEqual(graph.orphans.sort(), ['06-knowledge/lonely.md', '08-archive/06-knowledge/old.md']);
  });

  it('counts every occurrence of a repeated link', () => {
    const graph = graphOf({
      '06-knowledge/a.md': note('[[b]] and [[b]] again.'),
      '06-knowledge/b.md': note('x'),
    });
    assert.equal(graph.backlinks('06-knowledge/b.md').length, 2);
    assert.equal(graph.outgoing('06-knowledge/a.md').length, 2);
  });

  // Keyed by resolved path: a link lengthened to one of two same-named notes credits only
  // that one, so the other is still an orphan.
  it('does not credit a duplicate basename with its twin’s backlink', () => {
    const graph = graphOf({
      '06-knowledge/note.md': note('x'),
      '07-references/note.md': note('x'),
      '06-knowledge/a.md': note('[[07-references/note]]'),
    });
    assert.ok(graph.orphans.includes('06-knowledge/note.md'));
    assert.ok(!graph.orphans.includes('07-references/note.md'));
  });

  it('ignores links quoted in code so a note about wikilinks stays writable', () => {
    const graph = graphOf({
      '06-knowledge/a.md': note('A link looks like `[[imaginary]]`.\n\n```\n[[also-imaginary]]\n```'),
    });
    assert.deepEqual(graph.broken, []);
  });

  it('never reads a skipped prefix', () => {
    const vault = loadVault(
      makeVault({
        '02-inbox/secrets/door-code.md': '[[nothing-resolves-here]]',
        '06-knowledge/a.md': note('x'),
      })
    );
    assert.ok(!vault.notes.some((n) => n.path === '02-inbox/secrets/door-code.md'));
    assert.deepEqual(buildLinkGraph(vault).broken, []);
  });

  it('builds without a vocabulary — only the frontmatter check needs one', () => {
    const vault = loadVault(makeVault({ '06-knowledge/a.md': note('[[gone]]') }, { vocabulary: null }));
    assert.equal(buildLinkGraph(vault).broken.length, 1);
  });
});
