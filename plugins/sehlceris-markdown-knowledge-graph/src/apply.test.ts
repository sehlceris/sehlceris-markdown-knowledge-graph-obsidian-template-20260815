// The plugin's apply against an in-memory app. The strongest assertion is parity: the same
// archive run by the CLI on disk and by the plugin in memory must leave identical bytes.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planArchive, planUnarchive } from '../../../scripts/lib/archive.ts';
import { archiveAll } from '../../../scripts/lib/archive-fs.ts';
import { isScanned } from '../../../scripts/lib/vault.ts';
import { loadVault as loadDiskVault } from '../../../scripts/lib/vault-fs.ts';
import { makeVault, snapshot } from '../../../scripts/tests/helpers.ts';
import { applyPlan, archivePaths, preview, verbFor, type VaultIO } from './apply.ts';
import { indexedVault } from './indexed-vault.ts';

const TODAY = new Date(2026, 7, 15);

/** Obsidian, reduced to a map of files. Folders exist where files imply them or where
 *  createFolder made one; `hidden` exists on disk but never in the index. */
class MemoryIO implements VaultIO {
  readonly files: Map<string, string>;
  readonly folders = new Set<string>();
  readonly hidden = new Set<string>();
  failRename: string | null = null;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
    for (const path of this.files.keys()) {
      for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) this.folders.add(path.slice(0, i));
    }
  }

  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  }

  async process(path: string, fn: (text: string) => string): Promise<void> {
    this.files.set(path, fn(await this.read(path)));
  }

  async exists(path: string): Promise<boolean> {
    const lower = path.toLowerCase();
    return [...this.files.keys(), ...this.folders, ...this.hidden].some((p) => p.toLowerCase() === lower);
  }

  async rename(from: string, to: string): Promise<void> {
    if (from === this.failRename) throw new Error(`EACCES: ${from}`);
    const parent = to.slice(0, to.lastIndexOf('/'));
    if (!this.folders.has(parent)) throw new Error(`no parent folder for ${to}`);
    this.files.set(to, await this.read(from));
    this.files.delete(from);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async removeEmptyFolder(path: string): Promise<boolean> {
    const inside = (p: string): boolean => p.startsWith(`${path}/`);
    if ([...this.files.keys(), ...this.folders, ...this.hidden].some(inside)) return false;
    return this.folders.delete(path);
  }

  /** What loadVault in obsidian-vault.ts builds from the app's index. */
  async load() {
    const notes = [...this.files].filter(([p]) => p.endsWith('.md') && isScanned(p));
    return indexedVault({ files: this.files.keys(), contents: new Map(notes), taken: [...this.files.keys(), ...this.folders] });
  }
}

const initiative = (status: string): string =>
  `---\ncreated: 2026-05-03\nupdated: 2026-06-01\ntags:\n  - house-elm\nstatus: ${status}\n---\n\n# Deck\n\nSee [[cone-6]].\n`;
const knowledge = '---\ncreated: 2026-01-01\nupdated: 2026-02-02\ntags:\n  - pottery\n---\n\n# Cone 6\n\nFor [[deck]].\n';

const FIXTURE = {
  '03-initiatives/deck.md': initiative('active'),
  '03-initiatives/house-elm/drip.md': initiative('blocked'),
  '03-initiatives/house-elm/plan.png': 'png',
  '06-knowledge/cone-6.md': knowledge,
  '08-archive/04-areas/garden.md': initiative('done'),
  '02-inbox/secrets/creds.md': 'hunter2',
};

/** Everything but the tag vocabulary, which only the disk fixture carries. */
const notes = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).filter(([p]) => p !== 'tag-vocabulary.json'));

describe('parity with the CLI', () => {
  for (const [verb, path] of [
    ['archive', '03-initiatives/deck.md'],
    ['archive', '03-initiatives/house-elm'],
    ['unarchive', '08-archive/04-areas/garden.md'],
  ] as const) {
    it(`${verb} ${path}: the same plan from the app's index as from disk`, async () => {
      const dir = makeVault(FIXTURE);
      const plan = verb === 'archive' ? planArchive : planUnarchive;
      const io = new MemoryIO(FIXTURE);

      assert.deepEqual(plan(await io.load(), path, { today: TODAY }), plan(loadDiskVault(dir), path, { today: TODAY }));
    });

    it(`${verb} ${path}: the same bytes written as the CLI writes`, async () => {
      const dir = makeVault(FIXTURE);
      assert.equal(archiveAll(dir, [path], { unarchive: verb === 'unarchive', today: TODAY }).ok, true);
      const io = new MemoryIO(FIXTURE);

      const result = await archivePaths(verb, [path], () => io.load(), io, { today: TODAY });

      assert.equal(result.ok, true, result.lines.join('\n'));
      assert.deepEqual(Object.fromEntries([...io.files].sort()), notes(snapshot(dir)));
    });
  }
});

describe('applyPlan', () => {
  it('creates the archive mirror folders and removes the folder the move emptied', async () => {
    const io = new MemoryIO({ '03-initiatives/house-elm/drip.md': initiative('active') });
    const vault = await io.load();

    const applied = await applyPlan(vault, planArchive(vault, '03-initiatives/house-elm/drip.md', { today: TODAY }), io);

    assert.equal(applied.ok, true);
    assert.equal(io.folders.has('08-archive/03-initiatives/house-elm'), true);
    assert.deepEqual(applied.removedDirs, ['03-initiatives/house-elm']);
    // A bucket root survives even when emptied.
    assert.equal(io.folders.has('03-initiatives'), true);
  });

  it('keeps a folder that still holds a file the index never saw', async () => {
    const io = new MemoryIO({ '03-initiatives/house-elm/drip.md': initiative('active') });
    io.hidden.add('03-initiatives/house-elm/.DS_Store');
    const vault = await io.load();

    const applied = await applyPlan(vault, planArchive(vault, '03-initiatives/house-elm/drip.md'), io);

    assert.equal(applied.ok, true);
    assert.deepEqual(applied.removedDirs, []);
  });

  it('refuses, writing nothing, when a note changed after it was read', async () => {
    const io = new MemoryIO({ '03-initiatives/deck.md': initiative('active') });
    const vault = await io.load();
    const plan = planArchive(vault, '03-initiatives/deck.md', { today: TODAY });
    io.files.set('03-initiatives/deck.md', `${initiative('active')}typed meanwhile\n`);
    const before = new Map(io.files);

    const applied = await applyPlan(vault, plan, io);

    assert.equal(applied.ok, false);
    assert.match(applied.errors.join(), /changed while the archive was planned; nothing was written/);
    assert.deepEqual(io.files, before);
  });

  it('refuses, writing nothing, when the destination exists outside the index', async () => {
    const io = new MemoryIO({ '06-knowledge/cone-6.md': knowledge });
    io.hidden.add('08-archive/06-knowledge/Cone-6.md');
    const vault = await io.load();
    const before = new Map(io.files);

    const applied = await applyPlan(vault, planArchive(vault, '06-knowledge/cone-6.md'), io);

    assert.deepEqual(applied.errors, ['destination already exists: 08-archive/06-knowledge/cone-6.md']);
    assert.deepEqual(io.files, before);
  });

  it('refuses a destination the index holds in another case', async () => {
    const io = new MemoryIO({ '06-knowledge/cone-6.md': knowledge, '08-archive/06-knowledge/Cone-6.md': knowledge });
    const vault = await io.load();

    const plan = planArchive(vault, '06-knowledge/cone-6.md');

    assert.deepEqual(plan.conflicts, ['destination already exists: 08-archive/06-knowledge/cone-6.md']);
  });

  it('says what already moved when a move fails halfway', async () => {
    const io = new MemoryIO({
      '03-initiatives/house-elm/a.md': initiative('active'),
      '03-initiatives/house-elm/b.md': initiative('active'),
    });
    io.failRename = '03-initiatives/house-elm/b.md';
    const vault = await io.load();

    const applied = await applyPlan(vault, planArchive(vault, '03-initiatives/house-elm'), io);

    assert.equal(applied.ok, false);
    assert.deepEqual(applied.errors, [
      'EACCES: 03-initiatives/house-elm/b.md',
      'files were already moved: 03-initiatives/house-elm/a.md -> 08-archive/03-initiatives/house-elm/a.md',
      '1 of 2 files are already at the destination; finish the rest by hand',
    ]);
  });
});

describe('archivePaths', () => {
  it('stops at the first refusal, keeping what already moved', async () => {
    const io = new MemoryIO({ '06-knowledge/cone-6.md': knowledge, '08-archive/06-knowledge/old.md': knowledge });

    const result = await archivePaths('archive', ['06-knowledge/cone-6.md', '08-archive/06-knowledge/old.md'], () => io.load(), io);

    assert.equal(result.ok, false);
    assert.equal(io.files.has('08-archive/06-knowledge/cone-6.md'), true);
    assert.equal(result.lines.at(-1), 'refused: already archived: 08-archive/06-knowledge/old.md');
  });
});

describe('preview', () => {
  it('describes the run without writing', async () => {
    const io = new MemoryIO(FIXTURE);
    const before = new Map(io.files);

    const result = preview('archive', await io.load(), ['03-initiatives/house-elm'], { today: TODAY });

    assert.equal(result.ok, true);
    assert.match(result.lines[0]!, /^would archive 03-initiatives\/house-elm -> 08-archive\/03-initiatives\/house-elm/);
    assert.deepEqual(io.files, before);
  });
});

describe('verbFor', () => {
  const cases: [string[], string | null][] = [
    [['03-initiatives/deck.md'], 'archive'],
    [['03-initiatives/house-elm', '06-knowledge/cone-6.md'], 'archive'],
    [['templates/daily-note.md'], 'archive'],
    [['08-archive/03-initiatives/deck.md'], 'unarchive'],
    [['03-initiatives/deck.md', '08-archive/03-initiatives/old.md'], null],
    [['03-initiatives'], null],
    [['08-archive'], null],
    [['README.md'], null],
    [['plugins/sehlceris-markdown-knowledge-graph/src/main.ts'], null],
    [['06-knowledge/cone-6.md', 'README.md'], null],
    [[], null],
  ];
  for (const [paths, verb] of cases) {
    it(`${JSON.stringify(paths)} -> ${verb}`, () => assert.equal(verbFor(paths), verb));
  }
});
