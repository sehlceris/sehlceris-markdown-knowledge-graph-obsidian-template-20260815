// Archiving is a move plus two frontmatter bumps, so it inherits every guarantee the move
// suite asserts. What is tested here is the bump: exactly which bytes change, and never a
// key that was not already there.

import assert from 'node:assert/strict';
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { archiveAll, type ArchiveOptions, planArchive, planUnarchive } from '../lib/archive.ts';
import { buildLinkGraph } from '../lib/graph.ts';
import { type AppliedMove, applyMove } from '../lib/move.ts';
import { loadVault } from '../lib/vault.ts';
import { makeVault, read, snapshot } from './helpers.ts';

const TODAY = new Date(2026, 7, 15);

function archive(dir: string, path: string, opts: ArchiveOptions = {}) {
  const vault = loadVault(dir);
  const plan = planArchive(vault, path, { today: TODAY, ...opts });
  return { plan, applied: applyMove(vault, plan) };
}

function unarchive(dir: string, path: string, opts: ArchiveOptions = {}) {
  const vault = loadVault(dir);
  const plan = planUnarchive(vault, path, { today: TODAY, ...opts });
  return { plan, applied: applyMove(vault, plan) };
}

const initiative = (status: string): string =>
  `---\ncreated: 2026-05-03\nupdated: 2026-06-01\ntags:\n  - house-elm\nstatus: ${status}\n---\n\n# Deck\n\nSee [[cone-6-firing-schedule]].\n`;

const knowledge = '---\ncreated: 2026-01-01\nupdated: 2026-02-02\ntags:\n  - pottery\n---\n\n# Cone 6\n';

describe('planArchive', () => {
  it('round-trips a daily note and keeps every inbound link resolving', () => {
    const dailyPath = '01-daily/2026-08-16.md';
    const archivePath = `08-archive/${dailyPath}`;
    const dir = makeVault({
      [archivePath]: knowledge,
      '06-knowledge/meal-ratings.md': `See [[${archivePath}]].\n`,
      '07-references/meal-source.md': `See [[${archivePath}|day]].\n`,
    });

    assert.equal(unarchive(dir, archivePath, { frontmatter: false }).applied.ok, true);
    assert.equal(read(dir, dailyPath), knowledge);
    const restoredGraph = buildLinkGraph(loadVault(dir));
    assert.deepEqual(restoredGraph.broken, []);
    assert.deepEqual(
      restoredGraph
        .backlinks(dailyPath)
        .map((ref) => ref.from)
        .sort(),
      ['06-knowledge/meal-ratings.md', '07-references/meal-source.md']
    );
    assert.match(read(dir, '07-references/meal-source.md'), /\|day\]\]/);

    assert.equal(archive(dir, dailyPath, { frontmatter: false }).applied.ok, true);
    assert.equal(read(dir, archivePath), knowledge);
    assert.deepEqual(buildLinkGraph(loadVault(dir)).broken, []);
  });

  it('moves into the archive mirror and bumps updated and status', () => {
    const dir = makeVault({
      '03-initiatives/deck-rebuild.md': initiative('active'),
      '06-knowledge/cone-6-firing-schedule.md': knowledge,
    });

    const { plan, applied } = archive(dir, '03-initiatives/deck-rebuild.md');

    assert.equal(plan.to, '08-archive/03-initiatives/deck-rebuild.md');
    assert.deepEqual(plan.edits, []);
    assert.equal(applied.ok, true);
    // Every other byte is where it was.
    assert.equal(
      read(dir, '08-archive/03-initiatives/deck-rebuild.md'),
      initiative('active').replace('updated: 2026-06-01', 'updated: 2026-08-15').replace('status: active', 'status: done')
    );
  });

  it('never invents a status on a note that has none', () => {
    const dir = makeVault({ '06-knowledge/cone-6-firing-schedule.md': knowledge });

    const { plan } = archive(dir, '06-knowledge/cone-6-firing-schedule.md');

    assert.deepEqual(plan.frontmatter, [
      { path: '08-archive/06-knowledge/cone-6-firing-schedule.md', key: 'updated', value: '2026-08-15' },
    ]);
    const archived = read(dir, '08-archive/06-knowledge/cone-6-firing-schedule.md');
    assert.doesNotMatch(archived, /status/);
    assert.equal(archived, knowledge.replace('updated: 2026-02-02', 'updated: 2026-08-15'));
  });

  it('never invents an updated: on a note that has none', () => {
    const bare = '---\ncreated: 2026-01-01\n---\n\nx\n';
    const dir = makeVault({ '06-knowledge/bare.md': bare });

    const { plan } = archive(dir, '06-knowledge/bare.md');

    assert.deepEqual(plan.frontmatter, []);
    assert.equal(read(dir, '08-archive/06-knowledge/bare.md'), bare);
  });

  it('leaves frontmatter alone under --no-frontmatter', () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative('active') });

    const { plan } = archive(dir, '03-initiatives/deck-rebuild.md', { frontmatter: false });

    assert.deepEqual(plan.frontmatter, []);
    assert.equal(read(dir, '08-archive/03-initiatives/deck-rebuild.md'), initiative('active'));
  });

  it("takes today as an option — the library does not read the clock behind a test's back", () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative('active') });

    const plan = planArchive(loadVault(dir), '03-initiatives/deck-rebuild.md', { today: new Date(2030, 0, 2) });

    assert.equal(plan.frontmatter[0]?.value, '2030-01-02');
  });

  it('archives a whole directory', () => {
    const dir = makeVault({
      '03-initiatives/house-elm/deck-rebuild.md': initiative('active'),
      '03-initiatives/house-elm/drip.md': initiative('blocked'),
      '03-initiatives/house-elm/deck-plan.png': 'png',
    });

    const { plan, applied } = archive(dir, '03-initiatives/house-elm');

    assert.equal(plan.files.length, 3);
    // The attachment moves with the folder but carries no frontmatter to bump.
    assert.equal(plan.frontmatter.length, 4);
    assert.equal(applied.ok, true);
    assert.equal(existsSync(join(dir, '03-initiatives/house-elm')), false);
    assert.match(read(dir, '08-archive/03-initiatives/house-elm/drip.md'), /status: done/);
  });

  it('reports the move it completed when the frontmatter bump cannot be written', () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative('active') });
    // Read-only file, writable directory: the rename succeeds, the bump that follows it
    // does not. A throw there would lose the report of what had already happened.
    chmodSync(join(dir, '03-initiatives/deck-rebuild.md'), 0o444);

    let applied: AppliedMove | undefined;
    assert.doesNotThrow(() => {
      applied = archive(dir, '03-initiatives/deck-rebuild.md').applied;
    });
    chmodSync(join(dir, '08-archive/03-initiatives/deck-rebuild.md'), 0o644);

    assert.equal(applied?.ok, false);
    assert.match(applied!.errors[0]!, /could not set frontmatter in/);
    assert.ok(
      applied!.errors.includes(
        'files were already moved: 03-initiatives/deck-rebuild.md -> 08-archive/03-initiatives/deck-rebuild.md'
      )
    );
    // The file really is where the report says it is, unbumped.
    assert.equal(read(dir, '08-archive/03-initiatives/deck-rebuild.md'), initiative('active'));
    assert.equal(existsSync(join(dir, '03-initiatives/deck-rebuild.md')), false);
  });

  it('refuses to archive what is already archived, and touches nothing', () => {
    const dir = makeVault({ '08-archive/03-initiatives/old.md': initiative('done') });
    const before = snapshot(dir);

    const { plan, applied } = archive(dir, '08-archive/03-initiatives/old.md');

    assert.deepEqual(plan.conflicts, ['already archived: 08-archive/03-initiatives/old.md']);
    assert.equal(applied.ok, false);
    assert.deepEqual(snapshot(dir), before);
  });

  it('refuses when the archive already holds that path, and touches nothing', () => {
    const dir = makeVault({
      '03-initiatives/deck.md': initiative('active'),
      '08-archive/03-initiatives/deck.md': initiative('done'),
    });
    const before = snapshot(dir);

    const { plan, applied } = archive(dir, '03-initiatives/deck.md');

    assert.deepEqual(plan.conflicts, ['destination already exists: 08-archive/03-initiatives/deck.md']);
    assert.deepEqual(plan.frontmatter, []);
    assert.equal(applied.ok, false);
    assert.deepEqual(snapshot(dir), before);
  });
});

describe('planUnarchive', () => {
  it('bumps updated but does not restore a status', () => {
    const dir = makeVault({ '08-archive/03-initiatives/deck-rebuild.md': initiative('done') });

    const { plan } = unarchive(dir, '08-archive/03-initiatives/deck-rebuild.md');

    assert.equal(plan.to, '03-initiatives/deck-rebuild.md');
    assert.deepEqual(plan.frontmatter.map((f) => f.key), ['updated']);
    assert.match(read(dir, '03-initiatives/deck-rebuild.md'), /status: done/);
  });

  it('refuses to unarchive what is not archived, and touches nothing', () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative('active') });
    const before = snapshot(dir);

    const { plan, applied } = unarchive(dir, '03-initiatives/deck-rebuild.md');

    assert.deepEqual(plan.conflicts, ['not archived: 03-initiatives/deck-rebuild.md']);
    assert.equal(applied.ok, false);
    assert.deepEqual(snapshot(dir), before);
  });

  it('round-trips to a byte-identical vault when the frontmatter bumps are off', () => {
    const dir = makeVault({
      '03-initiatives/house-elm/deck-rebuild.md': initiative('active'),
      '03-initiatives/house-elm/drip.md': initiative('blocked'),
      '06-knowledge/cone-6-firing-schedule.md': knowledge,
      '05-entities/marco.md': 'Hired for [[deck-rebuild]] and [[drip]].\n',
    });
    const before = snapshot(dir);

    archive(dir, '03-initiatives/house-elm', { frontmatter: false });
    unarchive(dir, '08-archive/03-initiatives/house-elm', { frontmatter: false });

    assert.deepEqual(snapshot(dir), before);
  });

  it('round-trips content when the bumps are on, changing only updated and status', () => {
    const dir = makeVault({
      '03-initiatives/deck-rebuild.md': initiative('active'),
      '06-knowledge/cone-6-firing-schedule.md': knowledge,
    });

    archive(dir, '03-initiatives/deck-rebuild.md');
    unarchive(dir, '08-archive/03-initiatives/deck-rebuild.md');

    assert.equal(
      read(dir, '03-initiatives/deck-rebuild.md'),
      initiative('active').replace('updated: 2026-06-01', 'updated: 2026-08-15').replace('status: active', 'status: done')
    );
    assert.equal(read(dir, '06-knowledge/cone-6-firing-schedule.md'), knowledge);
  });
});

describe('archiveAll', () => {
  it('archives several paths, each planned against the vault the previous one left', () => {
    const dir = makeVault({
      '03-initiatives/a.md': initiative('active'),
      '03-initiatives/b.md': initiative('active'),
      '05-entities/who.md': 'See [[a]] and [[b]].\n',
    });

    const result = archiveAll(dir, ['03-initiatives/a.md', '03-initiatives/b.md'], { today: TODAY });

    assert.equal(result.ok, true);
    assert.equal(result.plans.length, 2);
    assert.equal(existsSync(join(dir, '08-archive/03-initiatives/a.md')), true);
    assert.equal(existsSync(join(dir, '08-archive/03-initiatives/b.md')), true);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[a]] and [[b]].\n');
  });

  it('stops at the first refusal and reports what already moved', () => {
    const dir = makeVault({
      '03-initiatives/a.md': initiative('active'),
      '08-archive/03-initiatives/old.md': initiative('done'),
      '03-initiatives/c.md': initiative('active'),
    });

    const result = archiveAll(dir, ['03-initiatives/a.md', '08-archive/03-initiatives/old.md', '03-initiatives/c.md'], {
      today: TODAY,
    });

    assert.equal(result.ok, false);
    assert.equal(result.plans.length, 2);
    assert.match(result.human[0]!, /^archived 03-initiatives\/a\.md -> /);
    assert.equal(result.human.at(-1), 'refused: already archived: 08-archive/03-initiatives/old.md');
    // a went; c was never attempted.
    assert.equal(existsSync(join(dir, '08-archive/03-initiatives/a.md')), true);
    assert.equal(existsSync(join(dir, '03-initiatives/c.md')), true);
  });

  it('writes nothing under dryRun', () => {
    const dir = makeVault({ '03-initiatives/a.md': initiative('active'), '03-initiatives/b.md': initiative('active') });
    const before = snapshot(dir);

    const result = archiveAll(dir, ['03-initiatives/a.md', '03-initiatives/b.md'], { today: TODAY, dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.human[0], 'dry run — nothing written');
    assert.ok(result.human.some((l) => l.startsWith('would archive 03-initiatives/b.md')));
    assert.deepEqual(snapshot(dir), before);
  });

  it('unarchives with unarchive: true', () => {
    const dir = makeVault({ '08-archive/03-initiatives/a.md': initiative('done') });

    const result = archiveAll(dir, ['08-archive/03-initiatives/a.md'], { unarchive: true, today: TODAY });

    assert.equal(result.ok, true);
    assert.match(read(dir, '03-initiatives/a.md'), /updated: 2026-08-15/);
  });
});
