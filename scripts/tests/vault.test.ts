import assert from 'node:assert/strict';
import { chmodSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  archivePathFor,
  bucketOf,
  DEFAULT_CONFIG,
  entryOf,
  isArchived,
  isContained,
  isInBuckets,
  loadVault,
  normalizeVaultPath,
  segmentsOf,
  toVaultPath,
  unarchivePathFor,
  walkVault,
} from '../lib/vault.ts';
import { TAG_VOCABULARY_FILE } from '../lib/vocabulary.ts';
import { makeVault, TEST_TAG_VOCABULARY } from './helpers.ts';

describe('normalizeVaultPath', () => {
  it('turns Windows separators into POSIX ones', () => {
    assert.equal(
      normalizeVaultPath('03-initiatives\\house-elm\\deck-rebuild.md'),
      '03-initiatives/house-elm/deck-rebuild.md'
    );
  });

  it('drops a leading ./', () => {
    assert.equal(normalizeVaultPath('./06-knowledge/x.md'), '06-knowledge/x.md');
  });

  // Shell completion writes a directory as "03-initiatives/house-elm/".
  it('drops trailing slashes', () => {
    assert.equal(normalizeVaultPath('03-initiatives/house-elm/'), '03-initiatives/house-elm');
    assert.equal(normalizeVaultPath('03-initiatives\\house-elm\\\\'), '03-initiatives/house-elm');
  });
});

describe('toVaultPath', () => {
  it('relativizes an absolute path', () => {
    assert.equal(toVaultPath('/vault', '/vault/06-knowledge/x.md'), '06-knowledge/x.md');
  });
});

describe('segmentsOf', () => {
  it('strips .md and splits', () => {
    assert.deepEqual(segmentsOf('03-initiatives/house-elm/deck-rebuild.md'), [
      '03-initiatives',
      'house-elm',
      'deck-rebuild',
    ]);
  });

  it('keeps an asset extension — it is part of the name an embed writes', () => {
    assert.deepEqual(segmentsOf('03-initiatives/deck-plan.png'), ['03-initiatives', 'deck-plan.png']);
  });
});

describe('bucketOf', () => {
  it('reads the first segment', () => {
    assert.equal(bucketOf('06-knowledge/x.md'), '06-knowledge');
  });

  it('reads through the archive mirror', () => {
    assert.equal(bucketOf('08-archive/02-inbox/x.md'), '02-inbox');
    assert.equal(bucketOf('08-archive/03-initiatives/house-elm/deck.md'), '03-initiatives');
  });
});

describe('archivePathFor / unarchivePathFor', () => {
  it('mirrors a note into the archive', () => {
    assert.equal(archivePathFor('01-daily/2026-08-15.md'), '08-archive/01-daily/2026-08-15.md');
    assert.equal(
      archivePathFor('03-initiatives/house-elm/deck-rebuild.md'),
      '08-archive/03-initiatives/house-elm/deck-rebuild.md'
    );
  });

  it('mirrors a directory the same way', () => {
    assert.equal(archivePathFor('03-initiatives/house-elm'), '08-archive/03-initiatives/house-elm');
    assert.equal(archivePathFor('03-initiatives/house-elm/'), '08-archive/03-initiatives/house-elm');
  });

  it('is idempotent', () => {
    const archived = archivePathFor('01-daily/2026-08-15.md');
    assert.equal(archivePathFor(archived), archived);
  });

  it('round-trips', () => {
    const live = '03-initiatives/house-elm/deck-rebuild.md';
    assert.equal(unarchivePathFor(archivePathFor(live)), live);
    assert.equal(unarchivePathFor(live), live);
  });

  it('knows what is archived', () => {
    assert.equal(isArchived('08-archive/01-daily/x.md'), true);
    assert.equal(isArchived('01-daily/x.md'), false);
    // The bucket itself, with nothing under it, holds nothing archived.
    assert.equal(isArchived('08-archive'), false);
  });
});

describe('isInBuckets', () => {
  it('accepts a path under a configured bucket', () => {
    assert.equal(isInBuckets('06-knowledge/x.md'), true);
    assert.equal(isInBuckets('templates/daily-note.md'), true);
  });

  it('rejects everything else — a move out of the vault is refused', () => {
    assert.equal(isInBuckets('spec/decisions.md'), false);
    assert.equal(isInBuckets('../elsewhere/x.md'), false);
    assert.equal(isInBuckets('/etc/passwd'), false);
    // A sibling directory that merely starts with a bucket name is not that bucket.
    assert.equal(isInBuckets('06-knowledge-old/x.md'), false);
  });

  it('knows only the current buckets', () => {
    assert.equal(isInBuckets('99-deleted/x.md'), false);
    assert.equal(isInBuckets('06-misc-knowledge/x.md'), false);
  });
});

describe('isContained', () => {
  for (const path of ['../secret.md', '..', '06-knowledge/../../secret.md', '/etc/passwd', '..\\secret.md']) {
    it(`rejects ${JSON.stringify(path)}`, () => {
      assert.equal(isContained('/vault', path), false);
    });
  }

  for (const path of [
    '06-knowledge/a.md',
    './06-knowledge/a.md',
    '06-knowledge/nested/../a.md',
    '02-inbox/secrets/creds.md',
    'a..b/c.md',
    '06-knowledge/héllo.md',
  ]) {
    it(`accepts ${JSON.stringify(path)}`, () => {
      assert.equal(isContained('/vault', path), true);
    });
  }

  // A sibling whose name extends the vault's is outside it.
  it('does not mistake a prefix-sharing sibling for the vault', () => {
    assert.equal(isContained('/vault', '/vault-old/x.md'), false);
  });
});

describe('walkVault', () => {
  const walk = (dir: string) => walkVault(dir, DEFAULT_CONFIG);

  it('splits notes from assets and returns sorted vault paths', () => {
    const dir = makeVault({
      '06-knowledge/b.md': 'b',
      '06-knowledge/a.md': 'a',
      '03-initiatives/house-elm/deck-plan.png': 'png',
      '03-initiatives/house-elm/deck-rebuild.md': 'deck',
    });
    assert.deepEqual(walk(dir), {
      notes: ['03-initiatives/house-elm/deck-rebuild.md', '06-knowledge/a.md', '06-knowledge/b.md'],
      assets: ['03-initiatives/house-elm/deck-plan.png'],
    });
  });

  it('ignores anything outside the configured buckets', () => {
    const dir = makeVault({
      '06-knowledge/a.md': 'a',
      'spec/decisions.md': 'not vault contents',
      'README.md': 'not vault contents',
      '99-deleted/gone.md': 'not a bucket any more',
    });
    assert.deepEqual(walk(dir), { notes: ['06-knowledge/a.md'], assets: [] });
  });

  it('ignores dotfiles — .DS_Store is not an attachment', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'a', '06-knowledge/.DS_Store': 'junk', '.obsidian/app.json': '{}' });
    assert.deepEqual(walk(dir).assets, []);
  });

  it('skips the configured prefixes', () => {
    const dir = makeVault({ '02-inbox/scratch.md': 'a', '02-inbox/secrets/door-code.md': '1234' });
    assert.deepEqual(walk(dir).notes, ['02-inbox/scratch.md']);
  });

  it('does not expose symlinked files or descend into symlinked directories', () => {
    const dir = makeVault({ '06-knowledge/ordinary.md': 'ordinary' });
    const outside = makeVault({
      'outside-note.md': 'outside note',
      'outside-asset.png': 'outside asset',
      'outside-dir/nested.md': 'outside nested note',
    });
    const bucket = join(dir, '06-knowledge');
    symlinkSync(join(outside, 'outside-note.md'), join(bucket, 'linked-note.md'));
    symlinkSync(join(outside, 'outside-asset.png'), join(bucket, 'linked-asset.png'));
    symlinkSync(join(outside, 'outside-dir'), join(bucket, 'linked-dir'), 'dir');
    assert.deepEqual(walk(dir), { notes: ['06-knowledge/ordinary.md'], assets: [] });
  });

  it('does not descend into a configured bucket that is itself a symlink', () => {
    const dir = makeVault({});
    const outside = makeVault({ 'outside-dir/nested.md': 'outside nested note' });
    symlinkSync(join(outside, 'outside-dir'), join(dir, '06-knowledge'), 'dir');
    assert.deepEqual(walk(dir), { notes: [], assets: [] });
  });

  // An absent BUCKET is an ordinary fresh vault and stays tolerated; a root that is
  // missing, unreadable or not a directory is the vault being gone and must be loud.
  // Collapsing the two answers "the vault is empty" to "the vault is missing".
  describe('an absent bucket is tolerated; an unusable root is not', () => {
    /** Runs `fn` with `dir` unreadable, handing the permission back so cleanup can rm it. */
    const whileUnreadable = (dir: string, fn: () => void): void => {
      chmodSync(dir, 0o000);
      try {
        fn();
      } finally {
        chmodSync(dir, 0o700);
      }
    };

    it('tolerates every bucket being absent', () => {
      assert.deepEqual(walk(makeVault({})), { notes: [], assets: [] });
    });

    it('still reads the buckets that do exist when others are absent', () => {
      assert.deepEqual(walk(makeVault({ '06-knowledge/a.md': 'a' })).notes, ['06-knowledge/a.md']);
    });

    it('throws when the vault root does not exist', () => {
      const dir = makeVault({});
      assert.throws(() => walk(join(dir, 'no-such-vault')), /ENOENT/);
    });

    it('throws when the vault root exists but cannot be read', () => {
      const dir = makeVault({ '06-knowledge/a.md': 'a' });
      whileUnreadable(dir, () => assert.throws(() => walk(dir), /EACCES/));
    });

    it('throws when the vault root is not a directory', () => {
      const dir = makeVault({ '06-knowledge/a.md': 'a' });
      assert.throws(() => walk(join(dir, '06-knowledge', 'a.md')), /ENOTDIR/);
    });

    // Absence is the only thing tolerated. A bucket that exists and cannot be read is a
    // vault the walk can only answer half of, and half a vault is as wrong as an empty one.
    it('throws when a bucket exists but cannot be read', () => {
      const dir = makeVault({ '06-knowledge/a.md': 'a' });
      whileUnreadable(join(dir, '06-knowledge'), () => assert.throws(() => walk(dir), /EACCES/));
    });
  });

  it('honours a narrowed bucket list', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'a', '01-daily/2026-01-01.md': 'd' });
    assert.deepEqual(walkVault(dir, { ...DEFAULT_CONFIG, buckets: ['06-knowledge'] }).notes, ['06-knowledge/a.md']);
  });
});

describe('entryOf', () => {
  it('describes a note', () => {
    assert.deepEqual(entryOf('03-initiatives/house-elm/deck-rebuild.md', true), {
      path: '03-initiatives/house-elm/deck-rebuild.md',
      segments: ['03-initiatives', 'house-elm', 'deck-rebuild'],
      basename: 'deck-rebuild',
      isNote: true,
    });
  });

  it('describes an asset, extension included', () => {
    const entry = entryOf('03-initiatives/deck-plan.png', false);
    assert.equal(entry.basename, 'deck-plan.png');
    assert.equal(entry.isNote, false);
  });
});

describe('loadVault', () => {
  it('indexes notes and assets', () => {
    const vault = loadVault(makeVault({ '06-knowledge/a.md': 'a', '06-knowledge/diagram.png': 'png' }));
    assert.deepEqual(
      vault.notes.map((n) => n.path),
      ['06-knowledge/a.md']
    );
    assert.deepEqual(
      vault.assets.map((a) => a.path),
      ['06-knowledge/diagram.png']
    );
    assert.equal(vault.entries.length, 2);
    assert.equal(vault.byPath.get('06-knowledge/a.md')?.basename, 'a');
    assert.deepEqual(vault.config, DEFAULT_CONFIG);
    assert.deepEqual(vault.vocabulary, TEST_TAG_VOCABULARY);
    assert.equal(vault.vocabularyError, null);
  });

  it('reads a note back byte for byte, CRLF and all', () => {
    const text = '---\r\ncreated: 2026-01-01\r\n---\r\n\r\nBody with no trailing newline';
    assert.equal(loadVault(makeVault({ '06-knowledge/a.md': text })).read('06-knowledge/a.md'), text);
  });

  it('reads an asset byte for byte', () => {
    const text = 'asset\r\nbytes without a trailing newline';
    assert.equal(loadVault(makeVault({ '06-knowledge/diagram.txt': text })).read('06-knowledge/diagram.txt'), text);
  });

  it('resolves absolute paths at the filesystem boundary only', () => {
    const vault = loadVault(makeVault({ '06-knowledge/a.md': 'a' }));
    assert.equal(vault.absolute('06-knowledge/a.md'), join(vault.baseDir, '06-knowledge/a.md'));
    assert.equal(readFileSync(vault.absolute('06-knowledge/a.md'), 'utf8'), 'a');
  });

  it('takes a partial config override', () => {
    const vault = loadVault(makeVault({ '06-knowledge/a.md': 'a', '01-daily/x.md': 'd' }), {
      buckets: ['06-knowledge'],
    });
    assert.deepEqual(
      vault.notes.map((n) => n.path),
      ['06-knowledge/a.md']
    );
    assert.equal(vault.config.archiveBucket, '08-archive');
  });

  // Only the frontmatter check needs the vocabulary, so a vault without a usable one still
  // loads and says why.
  describe('without a usable vocabulary', () => {
    const cases: [string, string | null, RegExp][] = [
      ['absent', null, /missing/],
      ['malformed', '{', /invalid JSON/],
      ['empty', '{"domainTags":[],"shapeTags":[]}', /domainTags is empty/],
    ];
    for (const [name, vocabulary, error] of cases) {
      it(`loads when the vocabulary is ${name}`, () => {
        const vault = loadVault(makeVault({ '06-knowledge/a.md': 'a' }, { vocabulary }));
        assert.equal(vault.vocabulary, null);
        assert.match(vault.vocabularyError ?? '', error);
        assert.deepEqual(
          vault.notes.map((n) => n.path),
          ['06-knowledge/a.md']
        );
      });
    }
  });
});

// The library's own containment guarantee: `read` and `absolute` refuse an escaping path
// themselves, whoever the caller is.
//
// NEGATIVE CONTROL. The secret is a REAL readable file beside the vault, so an `absolute`
// that stopped checking returns its contents instead of throwing.
describe('vault containment', () => {
  const SECRET = 'SECRET-OUTSIDE-THE-VAULT';
  const root = makeVault(
    {
      'vault/06-knowledge/nested/deep.md': '# deep\n',
      [`vault/${TAG_VOCABULARY_FILE}`]: JSON.stringify(TEST_TAG_VOCABULARY),
      'secret.md': SECRET,
    },
    { vocabulary: null }
  );
  const secretPath = join(root, 'secret.md');
  const vault = loadVault(join(root, 'vault'));

  const escaping: [string, string][] = [
    ['a relative escape to a file that exists', '../secret.md'],
    ['an absolute path to a file that exists', secretPath],
    ['a normalised escape', '06-knowledge/../../secret.md'],
    ['the classic traversal', '../../../../etc/passwd'],
    ['a Windows-separator escape', '..\\secret.md'],
  ];

  for (const [name, path] of escaping) {
    it(`read() refuses ${name}, never its contents`, () => {
      // Settled rather than assert.throws, so a read that WAS served prints what it leaked.
      let outcome: { status: string; value?: string; error?: unknown };
      try {
        outcome = { status: 'served', value: vault.read(path) };
      } catch (error) {
        outcome = { status: 'refused', error };
      }
      assert.equal(outcome.status, 'refused', JSON.stringify(outcome));
      assert.match(String(outcome.error), /escapes the vault/);
      assert.ok(!JSON.stringify(outcome).includes(SECRET));
    });

    it(`absolute() refuses ${name}, so no writer is handed one`, () => {
      assert.throws(() => vault.absolute(path), /escapes the vault/);
    });
  }

  // POSITIVE CONTROL. A guard that blocks everything also passes the cases above — which is
  // what a realpath comparison would do here, because macOS resolves the tmpdir this vault
  // lives in through /private/var.
  it('still reads a legitimate nested note under a temp dir', () => {
    assert.equal(vault.read('06-knowledge/nested/deep.md'), '# deep\n');
    assert.equal(vault.absolute('06-knowledge/nested/deep.md'), join(vault.baseDir, '06-knowledge/nested/deep.md'));
    // A contained path the walk skipped is still *contained*; not listing it is the walk's job.
    assert.equal(isContained(vault.baseDir, '02-inbox/secrets/creds.md'), true);
  });
});
