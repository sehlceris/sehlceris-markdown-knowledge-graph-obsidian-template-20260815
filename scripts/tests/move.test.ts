// A rename that is wrong destroys links silently — nothing throws, nothing is red, the
// graph is just quietly poorer. So this suite is adversarial: it asserts the bytes that
// must not change as hard as it asserts the ones that must.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildLinkGraph } from '../lib/graph.ts';
import { type AppliedMove, applyMove, planMove, resolveVaultPathInput } from '../lib/move.ts';
import { loadVault } from '../lib/vault.ts';
import { makeVault, read, snapshot } from './helpers.ts';

function move(dir: string, from: string, to: string) {
  const vault = loadVault(dir);
  const plan = planMove(vault, from, to);
  return { plan, applied: applyMove(vault, plan) };
}

/** Every resolved link in the vault as [from, to]. */
function resolvedRefs(dir: string): [string, string][] {
  const vault = loadVault(dir);
  const graph = buildLinkGraph(vault);
  return vault.notes.flatMap((n) => graph.outgoing(n.path).map((r): [string, string] => [r.from, r.to]));
}

describe('planMove — the no-op case', () => {
  it('rewrites nothing when a move changes no basename and creates no ambiguity', () => {
    const dir = makeVault({
      '06-knowledge/note.md': '---\ncreated: 2026-01-01\n---\n\nbody\n',
      '05-entities/who.md': 'Points at [[note]] and [[note|the note]] and ![[note]].\n',
    });
    const before = read(dir, '05-entities/who.md');

    const { plan, applied } = move(dir, '06-knowledge/note.md', '07-references/note.md');

    assert.deepEqual(plan.edits, []);
    assert.deepEqual(plan.files, [{ from: '06-knowledge/note.md', to: '07-references/note.md' }]);
    assert.equal(applied.ok, true);
    assert.deepEqual(applied.edited, []);
    // Byte-identical, not merely equivalent.
    assert.equal(read(dir, '05-entities/who.md'), before);
    assert.equal(existsSync(join(dir, '07-references/note.md')), true);
    assert.equal(existsSync(join(dir, '06-knowledge/note.md')), false);
  });
});

describe('planMove — renames', () => {
  it('updates inbound links and keeps the display text', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'body\n',
      '05-entities/who.md': 'See [[old]] and [[old|Some Display Text]].\n',
    });

    const { plan, applied } = move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    assert.equal(plan.edits.length, 2);
    assert.deepEqual(applied.edited, ['05-entities/who.md']);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[new]] and [[new|Some Display Text]].\n');
  });

  it('keeps the table-escaped pipe of [[old\\|label]] intact', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'body\n',
      '05-entities/who.md': '| who |\n| --- |\n| [[old\\|Old]] and [[old#Top\\|top]] |\n',
    });

    const { plan } = move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    assert.equal(plan.edits.length, 2);
    assert.equal(read(dir, '05-entities/who.md'), '| who |\n| --- |\n| [[new\\|Old]] and [[new#Top\\|top]] |\n');
  });

  it('keeps a #heading and a #^block-id anchor', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'body\n',
      '05-entities/who.md': '[[old#Heading]] [[old#^block-id]] [[old#Heading|Shown]]\n',
    });

    move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    assert.equal(read(dir, '05-entities/who.md'), '[[new#Heading]] [[new#^block-id]] [[new#Heading|Shown]]\n');
  });

  it('updates an embed when an attachment is renamed', () => {
    const dir = makeVault({
      '03-initiatives/deck-plan.png': 'not really a png',
      '03-initiatives/deck-rebuild.md': 'The plan: ![[deck-plan.png]]\n',
    });

    const { plan } = move(dir, '03-initiatives/deck-plan.png', '03-initiatives/deck-photo.png');

    assert.equal(plan.edits.length, 1);
    assert.equal(read(dir, '03-initiatives/deck-rebuild.md'), 'The plan: ![[deck-photo.png]]\n');
  });
});

describe('planMove — ambiguity', () => {
  it("lengthens a third note's bare link when the move creates a basename collision", () => {
    const dir = makeVault({
      '06-knowledge/note.md': 'a\n',
      '03-initiatives/thing.md': 'b\n',
      '05-entities/who.md': 'Both [[note]] and [[thing]] matter.\n',
    });

    // "thing" arrives as a second "note" — the link to the note that did NOT move is the
    // one that breaks, and it is only found by scanning every note.
    const { plan } = move(dir, '03-initiatives/thing.md', '07-references/note.md');

    assert.deepEqual(
      plan.edits.map((e) => [e.was, e.replacement]),
      [
        ['note', '06-knowledge/note'],
        ['thing', '07-references/note'],
      ]
    );
    // Two edits in one file: applied ascending, the second would land at a stale offset.
    assert.equal(read(dir, '05-entities/who.md'), 'Both [[06-knowledge/note]] and [[07-references/note]] matter.\n');
  });

  it('leaves a qualified link alone when a move resolves the collision it disambiguated', () => {
    const dir = makeVault({
      '03-initiatives/a/note.md': 'a\n',
      '03-initiatives/b/note.md': 'b\n',
      '05-entities/who.md': 'See [[a/note]] and [[b/note]].\n',
    });

    const { plan } = move(dir, '03-initiatives/b/note.md', '03-initiatives/b/renamed.md');

    // [[a/note]] could now be shortened to [[note]]; shortening it is not our business.
    assert.deepEqual(plan.edits.map((e) => [e.was, e.replacement]), [['b/note', 'renamed']]);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[a/note]] and [[renamed]].\n');
  });

  it('shortens an embed only as far as the notes-first resolution allows', () => {
    const dir = makeVault({
      '07-references/LICENSE': 'MIT text',
      '06-knowledge/LICENSE.md': 'What the licence actually permits.\n',
      '05-entities/who.md': 'Shipped with ![[07-references/LICENSE]].\n',
    });

    const { plan } = move(dir, '07-references/LICENSE', '07-references/docs/LICENSE');

    // "LICENSE" is unique among the assets and would look safe if only the assets were
    // consulted — but resolution tries the notes first, so it would land on
    // 06-knowledge/LICENSE.md and orphan the attachment.
    assert.deepEqual(plan.edits.map((e) => [e.was, e.replacement]), [['07-references/LICENSE', 'docs/LICENSE']]);

    // The proof is in the re-resolution, not in the string.
    assert.deepEqual(buildLinkGraph(loadVault(dir)).broken, []);
    assert.deepEqual(resolvedRefs(dir), [['05-entities/who.md', '07-references/docs/LICENSE']]);
  });

  it('still rewrites nothing when an asset move creates no ambiguity at all', () => {
    const dir = makeVault({
      '07-references/manual.pdf': 'pdf',
      '06-knowledge/reading.md': 'See ![[manual.pdf]].\n',
    });
    const before = read(dir, '06-knowledge/reading.md');

    const { plan } = move(dir, '07-references/manual.pdf', '07-references/docs/manual.pdf');

    assert.deepEqual(plan.edits, []);
    assert.equal(read(dir, '06-knowledge/reading.md'), before);
  });

  it('disambiguates two same-basename files moved together against each other', () => {
    const dir = makeVault({
      '03-initiatives/alpha/note.md': 'a\n',
      '03-initiatives/alpha/other.md': 'b\n',
      '06-knowledge/beta/note.md': 'c\n',
      '06-knowledge/beta/other.md': 'd\n',
      '05-entities/who.md': '[[alpha/note]] [[alpha/other]] [[beta/note]] [[beta/other]]\n',
    });

    // The directory rename makes every one of the four ambiguous at the "beta/x" length,
    // including between the two files that moved together.
    const { plan } = move(dir, '03-initiatives/alpha', '03-initiatives/beta');

    assert.equal(plan.files.length, 2);
    assert.equal(
      read(dir, '05-entities/who.md'),
      '[[03-initiatives/beta/note]] [[03-initiatives/beta/other]] [[06-knowledge/beta/note]] [[06-knowledge/beta/other]]\n'
    );
  });
});

describe('planMove — directories', () => {
  it('moves every file underneath and leaves links between them alone', () => {
    const dir = makeVault({
      '03-initiatives/house-elm/deck-rebuild.md': 'Also [[drip-irrigation-install]].\n',
      '03-initiatives/house-elm/drip-irrigation-install.md': 'Back to [[deck-rebuild]].\n',
      '03-initiatives/house-elm/deck-plan.png': 'png',
      '05-entities/marco.md': 'Building [[deck-rebuild]].\n',
    });

    const { plan, applied } = move(dir, '03-initiatives/house-elm', '08-archive/03-initiatives/house-elm');

    assert.equal(plan.files.length, 3);
    assert.deepEqual(plan.edits, []);
    assert.equal(applied.ok, true);
    assert.equal(read(dir, '08-archive/03-initiatives/house-elm/deck-rebuild.md'), 'Also [[drip-irrigation-install]].\n');
    assert.equal(read(dir, '05-entities/marco.md'), 'Building [[deck-rebuild]].\n');
    // The emptied directory goes with it; the bucket root stays.
    assert.deepEqual(applied.removedDirs, ['03-initiatives/house-elm']);
    assert.equal(existsSync(join(dir, '03-initiatives')), true);
  });

  it('accepts a directory with a trailing slash, the way a shell completes it', () => {
    const dir = makeVault({ '03-initiatives/house-elm/deck.md': 'x\n' });

    const { plan, applied } = move(dir, '03-initiatives/house-elm/', '04-areas/house-elm/');

    assert.deepEqual(plan.conflicts, []);
    assert.equal(applied.ok, true);
    assert.equal(existsSync(join(dir, '04-areas/house-elm/deck.md')), true);
  });
});

describe('planMove — what is not a link', () => {
  it('skips code fences and inline code, and still lands the real link', () => {
    const body = ['Before [[old]] here.', '', '```md', '[[old]] fenced', '```', '', 'And `[[old]]` inline, then [[old]] again.', ''].join(
      '\n'
    );
    const dir = makeVault({ '06-knowledge/old.md': 'x\n', '05-entities/who.md': body });

    const { plan } = move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    assert.equal(plan.edits.length, 2);
    assert.equal(
      read(dir, '05-entities/who.md'),
      body.replace('Before [[old]]', 'Before [[new]]').replace('then [[old]]', 'then [[new]]')
    );
  });

  it('never touches a [[#Section]] self-link — an empty target means this file', () => {
    const self = 'See [[#Section]] and [[other]].\n\n## Section\n';
    const dir = makeVault({ '06-knowledge/old.md': self, '06-knowledge/other.md': 'x\n' });

    move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    assert.equal(read(dir, '06-knowledge/new.md'), self);
  });

  it('leaves an already-broken or already-ambiguous link alone rather than "healing" it', () => {
    const text = 'See [[gone]] and [[dup]] and [[old]].\n';
    const dir = makeVault({
      '06-knowledge/old.md': 'x\n',
      '06-knowledge/x/dup.md': 'x\n',
      '06-knowledge/y/dup.md': 'y\n',
      '05-entities/who.md': text,
    });

    const { plan } = move(dir, '06-knowledge/old.md', '06-knowledge/gone.md');

    // [[gone]] would now resolve to the moved note — but it never pointed at it, so a
    // rewrite would quietly change what the author meant. Only [[old]] moves.
    assert.deepEqual(plan.edits.map((e) => [e.was, e.replacement]), [['old', 'gone']]);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[gone]] and [[dup]] and [[gone]].\n');
  });
});

describe('applyMove — byte preservation', () => {
  it('keeps CRLF line endings and a missing trailing newline', () => {
    const crlf = '---\r\nupdated: 2026-01-01\r\n---\r\n\r\nSee [[old]] once.';
    const dir = makeVault({ '06-knowledge/old.md': 'x\n', '05-entities/who.md': crlf });

    move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    const after = read(dir, '05-entities/who.md');
    assert.equal(after, crlf.replace('[[old]]', '[[new]]'));
    assert.equal(after.includes('\r\n'), true);
    assert.equal(after.endsWith('\n'), false);
  });

  it('rewrites a link inside the moving file itself', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'Self: [[old#Top]], other: [[other]].\n',
      '06-knowledge/other.md': 'x\n',
    });

    move(dir, '06-knowledge/old.md', '06-knowledge/new.md');

    // Edits land before the rename, at the offsets the plan read at the old path.
    assert.equal(read(dir, '06-knowledge/new.md'), 'Self: [[new#Top]], other: [[other]].\n');
  });
});

describe('applyMove — a move that fails halfway', () => {
  it('names the files it had already rewritten', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'x\n',
      '05-entities/who.md': 'See [[old]].\n',
      '07-references/.gitkeep': '',
    });
    // Foam writes N files, then moves, and says nothing when the move fails. A read-only
    // destination is the cheapest way to get there.
    chmodSync(join(dir, '07-references'), 0o555);

    const { applied } = move(dir, '06-knowledge/old.md', '07-references/new.md');
    chmodSync(join(dir, '07-references'), 0o755);

    assert.equal(applied.ok, false);
    assert.match(applied.errors[0]!, /could not move 06-knowledge\/old\.md -> 07-references\/new\.md/);
    assert.equal(applied.errors[1], 'links were already rewritten in: 05-entities/who.md');
    // And the report is true: the edit really is on disk.
    assert.equal(read(dir, '05-entities/who.md'), 'See [[new]].\n');
  });

  it('says the halfway state is repaired by re-running, and it is', () => {
    const dir = makeVault({
      '06-knowledge/old.md': 'x\n',
      '05-entities/who.md': 'See [[old]].\n',
      '07-references/.gitkeep': '',
    });
    chmodSync(join(dir, '07-references'), 0o555);
    const first = move(dir, '06-knowledge/old.md', '07-references/new.md');
    chmodSync(join(dir, '07-references'), 0o755);

    assert.equal(first.applied.ok, false);
    assert.deepEqual(first.applied.moved, []);
    assert.match(first.applied.errors.at(-1)!, /run the identical command again/);

    // The advice has to be true, so run it. The rewritten [[new]] now resolves to nothing,
    // and the planner declines to heal a broken link — so the second plan rewrites nothing.
    const second = move(dir, '06-knowledge/old.md', '07-references/new.md');

    assert.deepEqual(second.plan.conflicts, []);
    assert.deepEqual(second.plan.edits, []);
    assert.equal(second.applied.ok, true);
    assert.deepEqual(second.applied.moved, [{ from: '06-knowledge/old.md', to: '07-references/new.md' }]);
    assert.deepEqual(buildLinkGraph(loadVault(dir)).broken, []);
    assert.deepEqual(resolvedRefs(dir), [['05-entities/who.md', '07-references/new.md']]);
  });

  it('returns rather than throws when a write after the move fails', () => {
    const dir = makeVault({ '03-initiatives/deck.md': '---\nupdated: 2026-01-01\n---\n\nx\n' });
    // Only the file is read-only: the rename needs the directory, and succeeds. The
    // frontmatter write that follows it is what fails.
    chmodSync(join(dir, '03-initiatives/deck.md'), 0o444);
    const vault = loadVault(dir);
    const plan = planMove(vault, '03-initiatives/deck.md', '08-archive/03-initiatives/deck.md', [
      { path: '08-archive/03-initiatives/deck.md', key: 'updated', value: '2026-08-15' },
    ]);

    let applied: AppliedMove | undefined;
    assert.doesNotThrow(() => {
      applied = applyMove(vault, plan);
    });
    chmodSync(join(dir, '08-archive/03-initiatives/deck.md'), 0o644);

    assert.equal(applied?.ok, false);
    assert.match(applied!.errors[0]!, /could not set frontmatter in 08-archive\/03-initiatives\/deck\.md/);
    // The move happened and the report says so, rather than being discarded with the throw.
    assert.deepEqual(applied!.moved, [{ from: '03-initiatives/deck.md', to: '08-archive/03-initiatives/deck.md' }]);
    assert.ok(applied!.errors.includes('files were already moved: 03-initiatives/deck.md -> 08-archive/03-initiatives/deck.md'));
    assert.match(applied!.errors.at(-1)!, /by hand/);
    assert.equal(existsSync(join(dir, '08-archive/03-initiatives/deck.md')), true);
    assert.equal(existsSync(join(dir, '03-initiatives/deck.md')), false);
  });
});

describe('applyMove — a case-only rename', () => {
  it('does not mistake the source for its own destination, and lands the new case', () => {
    const dir = makeVault({
      '06-knowledge/Note.md': 'body\n',
      '05-entities/who.md': 'See [[Note]].\n',
    });

    const { plan, applied } = move(dir, '06-knowledge/Note.md', '06-knowledge/note.md');

    assert.deepEqual(plan.conflicts, []);
    assert.equal(applied.ok, true);
    // readdir, not existsSync: on a case-insensitive filesystem existsSync answers true
    // either way and would pass against a rename that never happened.
    assert.deepEqual(readdirSync(join(dir, '06-knowledge')), ['note.md']);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[note]].\n');
  });

  it('renames a directory that differs only in case', () => {
    const dir = makeVault({
      '03-initiatives/House-Elm/deck.md': 'x\n',
      '03-initiatives/House-Elm/plan.png': 'png',
    });

    const { plan, applied } = move(dir, '03-initiatives/House-Elm', '03-initiatives/house-elm');

    assert.deepEqual(plan.conflicts, []);
    assert.equal(applied.ok, true);
    assert.equal(applied.moved.length, 2);
    assert.deepEqual(readdirSync(join(dir, '03-initiatives')), ['house-elm']);
    assert.deepEqual(readdirSync(join(dir, '03-initiatives/house-elm')).sort(), ['deck.md', 'plan.png']);
  });
});

describe('planMove — what a refused plan promises', () => {
  it('advertises no frontmatter writes it will never make', () => {
    const dir = makeVault({
      '03-initiatives/deck.md': '---\nupdated: 2026-01-01\n---\n\nx\n',
      '08-archive/03-initiatives/deck.md': '---\nupdated: 2026-01-01\n---\n\ny\n',
    });
    const vault = loadVault(dir);

    const plan = planMove(vault, '03-initiatives/deck.md', '08-archive/03-initiatives/deck.md', [
      { path: '08-archive/03-initiatives/deck.md', key: 'status', value: 'done' },
    ]);

    assert.deepEqual(plan.conflicts, ['destination already exists: 08-archive/03-initiatives/deck.md']);
    // `edits` is already emptied on a conflict; `frontmatter` has to be, for the same reason.
    assert.deepEqual(plan.edits, []);
    assert.deepEqual(plan.frontmatter, []);
  });
});

describe('planMove — refusals', () => {
  const cases: [string, Record<string, string>, string, string][] = [
    ['the source does not exist', { '06-knowledge/note.md': 'x\n' }, '06-knowledge/nope.md', '07-references/nope.md'],
    [
      'the destination already exists',
      { '06-knowledge/note.md': 'x\n', '07-references/note.md': 'y\n' },
      '06-knowledge/note.md',
      '07-references/note.md',
    ],
    [
      // existsSync, not the index: a skipped path is invisible to the walk but still a file.
      'the destination exists but is skipped by the walk',
      { '02-inbox/note.md': 'x\n', '02-inbox/secrets/note.md': 'y\n' },
      '02-inbox/note.md',
      '02-inbox/secrets/note.md',
    ],
    [
      'the source is outside the buckets',
      { '06-knowledge/note.md': 'x\n', 'spec/decisions.md': 'y\n' },
      'spec/decisions.md',
      '06-knowledge/decisions.md',
    ],
    ['the destination is outside the buckets', { '06-knowledge/note.md': 'x\n' }, '06-knowledge/note.md', 'spec/note.md'],
    ['the destination escapes the vault', { '06-knowledge/note.md': 'x\n' }, '06-knowledge/note.md', '../note.md'],
    ['from and to are the same', { '06-knowledge/note.md': 'x\n' }, '06-knowledge/note.md', '06-knowledge/note.md'],
    [
      // `mv` errors here; moving a directory into itself is not a thing that can finish.
      'the destination is inside the source',
      { '03-initiatives/a/x.md': 'x\n', '03-initiatives/a/y.md': 'y\n' },
      '03-initiatives/a',
      '03-initiatives/a/b',
    ],
  ];

  for (const [name, files, from, to] of cases) {
    it(`refuses when ${name}, and touches nothing`, () => {
      const dir = makeVault(files);
      const before = snapshot(dir);

      const { plan, applied } = move(dir, from, to);

      assert.ok(plan.conflicts.length > 0);
      assert.deepEqual(plan.edits, []);
      assert.equal(applied.ok, false);
      assert.deepEqual(applied.errors, plan.conflicts);
      assert.deepEqual(applied.moved, []);
      assert.deepEqual(snapshot(dir), before);
    });
  }

  it('refuses rather than throws — a refusal is a result, not an exception', () => {
    const dir = makeVault({ '06-knowledge/note.md': 'x\n' });
    assert.doesNotThrow(() => move(dir, '06-knowledge/gone.md', '07-references/gone.md'));
  });
});

describe('resolveVaultPathInput', () => {
  it('reads a bucket-prefixed path as vault-relative wherever the caller stands', () => {
    const dir = makeVault({ '06-knowledge/note.md': 'x\n' });
    const vault = loadVault(dir);
    assert.equal(resolveVaultPathInput(vault, '06-knowledge/note.md', '/somewhere/else'), '06-knowledge/note.md');
    // A destination that does not exist yet resolves the same way.
    assert.equal(resolveVaultPathInput(vault, '07-references/note.md', '/somewhere/else'), '07-references/note.md');
  });

  it('reads anything else against the cwd, and strips a trailing slash', () => {
    const dir = makeVault({ '06-knowledge/note.md': 'x\n' });
    const vault = loadVault(dir);
    assert.equal(resolveVaultPathInput(vault, 'note.md', join(dir, '06-knowledge')), '06-knowledge/note.md');
    assert.equal(resolveVaultPathInput(vault, '06-knowledge/', dir), '06-knowledge');
    assert.equal(resolveVaultPathInput(vault, join(dir, '06-knowledge/note.md'), '/'), '06-knowledge/note.md');
  });
});
