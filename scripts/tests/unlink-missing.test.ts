// unlink-missing rewrites prose, so like move it is held to bytes: the dead link becomes its
// text and nothing else in the note shifts.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { checkLinks } from '../lib/checks.ts';
import { applyUnlinkMissing, executeUnlinkMissing, planUnlinkMissing } from '../lib/unlink-missing.ts';
import { loadVault } from '../lib/vault-fs.ts';
import { makeVault, read, snapshot } from './helpers.ts';

describe('planUnlinkMissing', () => {
  it('plans nothing when every link resolves', () => {
    const dir = makeVault({
      '06-knowledge/a.md': 'See [[b]] and [[b|bee]] and ![[pic.png]].\n',
      '06-knowledge/b.md': 'See [[a#Top]].\n',
      '06-knowledge/pic.png': 'png',
    });
    assert.deepEqual(planUnlinkMissing(loadVault(dir)), { edits: [], embeds: [] });
  });

  it('replaces each form of a missing link with its plain text', () => {
    const before = [
      'Bare [[gone]], shown [[gone|Gone Note]], anchored [[gone#Part]] and [[a/gone#^blk]].',
      '| who |',
      '| --- |',
      '| [[hugo-wang\\|Hugo]] |',
      'Kept: [[b]] and [[b|bee]].',
      '',
    ].join('\n');
    const dir = makeVault({ '06-knowledge/a.md': before, '06-knowledge/b.md': 'x\n' });

    const plan = planUnlinkMissing(loadVault(dir));
    assert.deepEqual(
      plan.edits.map((e) => [e.was, e.replacement]),
      [
        ['[[gone]]', 'gone'],
        ['[[gone|Gone Note]]', 'Gone Note'],
        ['[[gone#Part]]', 'gone'],
        ['[[a/gone#^blk]]', 'a/gone'],
        ['[[hugo-wang\\|Hugo]]', 'Hugo'],
      ]
    );

    const applied = applyUnlinkMissing(loadVault(dir), plan);
    assert.deepEqual(applied, { edited: ['06-knowledge/a.md'], errors: [] });
    assert.equal(
      read(dir, '06-knowledge/a.md'),
      ['Bare gone, shown Gone Note, anchored gone and a/gone.', '| who |', '| --- |', '| Hugo |', 'Kept: [[b]] and [[b|bee]].', ''].join('\n')
    );
    assert.deepEqual(checkLinks(loadVault(dir)).broken, []);
  });

  it('replaces every occurrence of one dead target, not just the first', () => {
    // check-links reports a dead target once per note; the repair has to reach all of them.
    const dir = makeVault({ '06-knowledge/a.md': '[[gone]] and [[gone]] and [[gone]].\n' });

    applyUnlinkMissing(loadVault(dir), planUnlinkMissing(loadVault(dir)));
    assert.equal(read(dir, '06-knowledge/a.md'), 'gone and gone and gone.\n');
  });

  it('reports a missing embed but leaves it in the text', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'Photo: ![[missing.png]] and [[gone]].\n' });

    const plan = planUnlinkMissing(loadVault(dir));
    assert.deepEqual(plan.embeds, [{ path: '06-knowledge/a.md', raw: '![[missing.png]]' }]);
    applyUnlinkMissing(loadVault(dir), plan);
    assert.equal(read(dir, '06-knowledge/a.md'), 'Photo: ![[missing.png]] and gone.\n');
  });

  it('leaves an ambiguous link alone — both notes exist', () => {
    const dir = makeVault({
      '06-knowledge/x/dup.md': 'x\n',
      '06-knowledge/y/dup.md': 'y\n',
      '06-knowledge/a.md': 'See [[dup]].\n',
    });
    assert.deepEqual(planUnlinkMissing(loadVault(dir)).edits, []);
  });

  it('does not touch links quoted in code spans or fenced blocks', () => {
    const text = 'Write `[[gone]]` like so:\n\n```\n[[gone]]\n```\n\nReal [[gone]].\n';
    const dir = makeVault({ '06-knowledge/a.md': text });

    applyUnlinkMissing(loadVault(dir), planUnlinkMissing(loadVault(dir)));
    assert.equal(read(dir, '06-knowledge/a.md'), 'Write `[[gone]]` like so:\n\n```\n[[gone]]\n```\n\nReal gone.\n');
  });

  it('respects the paths the checker skips', () => {
    const secret = 'Door code for [[gone]].\n';
    const dir = makeVault({ '02-inbox/secrets/codes.md': secret });

    assert.deepEqual(planUnlinkMissing(loadVault(dir)).edits, []);
    assert.equal(read(dir, '02-inbox/secrets/codes.md'), secret);
  });

  it('keeps CRLF line endings and a missing trailing newline', () => {
    const crlf = '---\r\nupdated: 2026-01-01\r\n---\r\n\r\nSee [[gone|Gone]] once.';
    const dir = makeVault({ '06-knowledge/a.md': crlf });

    applyUnlinkMissing(loadVault(dir), planUnlinkMissing(loadVault(dir)));
    assert.equal(read(dir, '06-knowledge/a.md'), '---\r\nupdated: 2026-01-01\r\n---\r\n\r\nSee Gone once.');
  });
});

describe('applyUnlinkMissing', () => {
  it('skips a note edited after the plan was made, and says so', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'See [[gone]].\n' });
    const plan = planUnlinkMissing(loadVault(dir));
    writeFileSync(join(dir, '06-knowledge/a.md'), 'New line.\nSee [[gone]].\n');

    const applied = applyUnlinkMissing(loadVault(dir), plan);
    assert.deepEqual(applied.edited, []);
    assert.match(applied.errors[0]!, /06-knowledge\/a\.md changed since the plan was made/);
    assert.equal(read(dir, '06-knowledge/a.md'), 'New line.\nSee [[gone]].\n');
  });
});

describe('executeUnlinkMissing', () => {
  it('writes nothing on a dry run but lists every planned change', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'See [[gone|Gone]] and ![[missing.png]].\n' });
    const before = snapshot(dir);

    const outcome = executeUnlinkMissing(loadVault(dir), { dryRun: true });
    assert.equal(outcome.applied, null);
    assert.ok(outcome.human.includes('06-knowledge/a.md: [[gone|Gone]] -> Gone'));
    assert.ok(outcome.human.includes('  06-knowledge/a.md: ![[missing.png]]'));
    assert.equal(outcome.human.at(-1), 'would unlink 1 link in 1 note');
    assert.deepEqual(snapshot(dir), before);
  });

});
