import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFrontmatter, setFrontmatterKey } from '../lib/frontmatter.ts';

const NOTE = `---
created: 2026-05-03
updated: 2026-08-12
tags:
  - house-elm
  - local
aliases:
  - the deck
status: active
---

# Deck rebuild

Body text with a --- horizontal rule below.

---

More body.
`;

describe('readFrontmatter', () => {
  it('locates the block including its delimiters', () => {
    const fm = readFrontmatter(NOTE);
    assert.ok(fm.present);
    assert.equal(fm.start, 0);
    assert.ok(NOTE.slice(fm.start, fm.end).startsWith('---\n'));
    assert.ok(NOTE.slice(fm.start, fm.end).endsWith('---\n'));
    assert.equal(NOTE.slice(fm.end), 
      '\n# Deck rebuild\n\nBody text with a --- horizontal rule below.\n\n---\n\nMore body.\n'
    );
  });

  it('stops at the first closing fence, not a later horizontal rule', () => {
    const fm = readFrontmatter(NOTE);
    assert.ok(!fm.body.includes('Deck rebuild'));
  });

  it('reads scalars trimmed', () => {
    const fm = readFrontmatter(NOTE);
    assert.equal(fm.get('created'), '2026-05-03');
    assert.equal(fm.get('status'), 'active');
  });

  it('returns null for an absent key', () => {
    assert.equal(readFrontmatter(NOTE).get('nope'), null);
  });

  it('reads the sequence under the named key and not an adjacent one', () => {
    const fm = readFrontmatter(NOTE);
    assert.deepEqual(fm.listValues('tags'), ['house-elm', 'local']);
    assert.deepEqual(fm.listValues('aliases'), ['the deck']);
    assert.ok(!fm.listValues('tags').includes('the deck'));
  });

  it('returns an empty list for a key with no sequence', () => {
    assert.deepEqual(readFrontmatter(NOTE).listValues('status'), []);
  });

  it('handles a block with no trailing newline after the closing fence', () => {
    const text = '---\ncreated: 2026-01-01\ntags:\n  - work\n---';
    const fm = readFrontmatter(text);
    assert.ok(fm.present);
    assert.equal(fm.end, text.length);
    assert.equal(fm.get('created'), '2026-01-01');
    assert.deepEqual(fm.listValues('tags'), ['work']);
  });

  it('handles CRLF', () => {
    const text = '---\r\ncreated: 2026-01-01\r\ntags:\r\n  - work\r\n  - ai\r\n---\r\n\r\nBody\r\n';
    const fm = readFrontmatter(text);
    assert.ok(fm.present);
    assert.equal(fm.get('created'), '2026-01-01');
    assert.deepEqual(fm.listValues('tags'), ['work', 'ai']);
  });

  it('reports absent frontmatter rather than guessing', () => {
    const fm = readFrontmatter('# Just a heading\n\nNo frontmatter here.\n');
    assert.ok(!fm.present);
    assert.equal(fm.get('created'), null);
    assert.deepEqual(fm.listValues('tags'), []);
  });

  it('does not treat a mid-file --- as an opening fence', () => {
    assert.ok(!readFrontmatter('Some prose.\n\n---\ncreated: x\n---\n').present);
  });

  it('ignores an indented key belonging to some other mapping', () => {
    const text = '---\nnested:\n  updated: 2020-01-01\nupdated: 2026-08-15\n---\n';
    assert.equal(readFrontmatter(text).get('updated'), '2026-08-15');
  });

  it('reads the value without a trailing comment', () => {
    const text = '---\nupdated: 2026-01-01  # last touched\nstatus:\n---\n';
    const fm = readFrontmatter(text);
    assert.equal(fm.get('updated'), '2026-01-01');
    assert.equal(fm.get('status'), '');
  });

  it('keeps a # that is inside a quoted value', () => {
    const text = '---\ndouble: "a # b"\nsingle: \'c # d\'\nplain: e#f\n---\n';
    const fm = readFrontmatter(text);
    assert.equal(fm.get('double'), '"a # b"');
    assert.equal(fm.get('single'), "'c # d'");
    assert.equal(fm.get('plain'), 'e#f');
  });

  it('reads a key whose name is a prefix of another', () => {
    const text = '---\nstatus-note: waiting on the permit\nstatus: active\n---\n';
    const fm = readFrontmatter(text);
    assert.equal(fm.get('status'), 'active');
    assert.equal(fm.get('status-note'), 'waiting on the permit');
  });
});

/** Everything except the span [start, start + length) — the only bytes a write is allowed
 *  to touch. Comparing this either side of an edit asserts the byte-identity invariant
 *  directly, rather than by eyeballing a literal. */
const outside = (text: string, start: number, length: number): [string, string] => [
  text.slice(0, start),
  text.slice(start + length),
];

describe('setFrontmatterKey', () => {
  it('replaces the scalar and leaves every other byte identical', () => {
    const { text, changed } = setFrontmatterKey(NOTE, 'updated', '2026-08-15');
    assert.ok(changed);
    assert.equal(text, NOTE.replace('updated: 2026-08-12', 'updated: 2026-08-15'));
    assert.equal(text.length, NOTE.length);
  });

  it('sets status without disturbing the tag or alias sequences', () => {
    const { text } = setFrontmatterKey(NOTE, 'status', 'done');
    const fm = readFrontmatter(text);
    assert.equal(fm.get('status'), 'done');
    assert.deepEqual(fm.listValues('tags'), ['house-elm', 'local']);
    assert.deepEqual(fm.listValues('aliases'), ['the deck']);
    assert.equal(text.slice(fm.end), NOTE.slice(readFrontmatter(NOTE).end));
  });

  it('does not invent an absent key', () => {
    const { text, changed } = setFrontmatterKey(NOTE, 'status-x', 'done');
    assert.ok(!changed);
    assert.equal(text, NOTE);
  });

  it('does not invent a key on a note with no status', () => {
    const note = '---\ncreated: 2026-01-01\n---\n\nBody\n';
    const { text, changed } = setFrontmatterKey(note, 'status', 'done');
    assert.ok(!changed);
    assert.equal(text, note);
  });

  it('leaves a note with no frontmatter alone', () => {
    const note = '# Heading\n';
    assert.deepEqual(setFrontmatterKey(note, 'updated', '2026-08-15'), {
      text: note,
      changed: false,
    });
  });

  it('reports no change when the value already matches', () => {
    assert.ok(!setFrontmatterKey(NOTE, 'status', 'active').changed);
  });

  it('preserves CRLF on the edited line', () => {
    const text = '---\r\nupdated: 2026-01-01\r\nstatus: active\r\n---\r\nBody\r\n';
    const out = setFrontmatterKey(text, 'updated', '2026-08-15');
    assert.equal(out.text, '---\r\nupdated: 2026-08-15\r\nstatus: active\r\n---\r\nBody\r\n');
    assert.ok(!out.text.includes('2026-08-15\n'));
  });

  it('preserves a file that ends at the closing fence', () => {
    const text = '---\nstatus: active\n---';
    assert.equal(setFrontmatterKey(text, 'status', 'done').text, '---\nstatus: done\n---');
  });

  // templates/initiative-note.md ships a bare `status:` and a bare `updated:`, so every
  // note derived from it hits this path the first time it is archived. Splicing onto the
  // colon writes `status:done`, which is not a mapping entry and loses the property.
  it('supplies the separator when the existing value is empty', () => {
    const text = '---\ncreated: 2026-01-01\nupdated:\nstatus:\n---\n\nBody\n';
    const bumped = setFrontmatterKey(text, 'updated', '2026-08-15');
    assert.ok(bumped.changed);
    assert.equal(bumped.text, 
      '---\ncreated: 2026-01-01\nupdated: 2026-08-15\nstatus:\n---\n\nBody\n'
    );

    const done = setFrontmatterKey(bumped.text, 'status', 'done');
    assert.equal(done.text, 
      '---\ncreated: 2026-01-01\nupdated: 2026-08-15\nstatus: done\n---\n\nBody\n'
    );
    assert.equal(readFrontmatter(done.text).get('status'), 'done');
  });

  it('does not double the separator when the empty value already has one', () => {
    const text = '---\nstatus: \n---\n';
    assert.equal(setFrontmatterKey(text, 'status', 'done').text, '---\nstatus: done\n---\n');
  });

  it('keeps a trailing comment when the value is replaced', () => {
    const text = '---\nupdated: 2026-01-01  # last touched\n---\nb\n';
    const out = setFrontmatterKey(text, 'updated', '2026-08-15');
    assert.ok(out.changed);
    assert.equal(out.text, '---\nupdated: 2026-08-15  # last touched\n---\nb\n');
  });

  it('keeps a trailing comment when the value is empty', () => {
    const text = '---\nstatus:  # set when the work lands\n---\nb\n';
    const out = setFrontmatterKey(text, 'status', 'done');
    assert.equal(out.text, '---\nstatus:  done # set when the work lands\n---\nb\n');
    assert.equal(readFrontmatter(out.text).get('status'), 'done');
  });

  it('does not treat a # inside a quoted value as a comment', () => {
    const double = '---\ntitle: "a # b"\n---\n';
    assert.equal(setFrontmatterKey(double, 'title', '"c # d"').text, '---\ntitle: "c # d"\n---\n');

    const single = "---\ntitle: 'a # b'\n---\n";
    assert.equal(setFrontmatterKey(single, 'title', "'c # d'").text, "---\ntitle: 'c # d'\n---\n");
  });

  it('replaces a quoted value without disturbing the quotes around it', () => {
    const text = '---\ntitle: "Deck rebuild"  # keep the quotes\nstatus: active\n---\n';
    const out = setFrontmatterKey(text, 'title', '"Deck rebuild, phase 2"');
    assert.equal(out.text, 
      '---\ntitle: "Deck rebuild, phase 2"  # keep the quotes\nstatus: active\n---\n'
    );
  });

  // No caller does this today, but the function is exported: `tags:x\n  - work` would
  // orphan the sequence under a scalar.
  it('refuses a key that heads a block sequence', () => {
    assert.deepEqual(setFrontmatterKey(NOTE, 'tags', 'x'), { text: NOTE, changed: false });
    assert.deepEqual(setFrontmatterKey(NOTE, 'aliases', 'x'), { text: NOTE, changed: false });
  });

  it('still writes a key with no sequence under it', () => {
    const text = '---\ntags:\n---\n';
    assert.equal(setFrontmatterKey(text, 'tags', 'work').text, '---\ntags: work\n---\n');
  });

  it('writes the key and not the one whose name it prefixes', () => {
    const text = '---\nstatus-note: waiting on the permit\nstatus: active\n---\n';
    assert.equal(setFrontmatterKey(text, 'status', 'done').text, 
      '---\nstatus-note: waiting on the permit\nstatus: done\n---\n'
    );
    assert.equal(setFrontmatterKey(text, 'status-note', 'permit granted').text, 
      '---\nstatus-note: permit granted\nstatus: active\n---\n'
    );
  });

  it('preserves CRLF on a line whose value is empty or commented', () => {
    const text = '---\r\nupdated:\r\nstatus: active  # for now\r\n---\r\nBody\r\n';
    const bumped = setFrontmatterKey(text, 'updated', '2026-08-15');
    assert.equal(bumped.text, 
      '---\r\nupdated: 2026-08-15\r\nstatus: active  # for now\r\n---\r\nBody\r\n'
    );
    assert.equal(setFrontmatterKey(bumped.text, 'status', 'done').text, 
      '---\r\nupdated: 2026-08-15\r\nstatus: done  # for now\r\n---\r\nBody\r\n'
    );
  });

  it('writes a file that ends at the closing fence with no trailing newline', () => {
    const text = '---\nupdated: 2026-01-01\nstatus:\n---';
    assert.equal(setFrontmatterKey(text, 'status', 'done').text, 
      '---\nupdated: 2026-01-01\nstatus: done\n---'
    );
  });

  it('changes no byte outside the value span', () => {
    const before =
      '---\ncreated: 2026-05-03\nupdated: 2026-01-01  # last touched\ntags:\n  - work\nstatus: active\n---\n\n# Body # not a comment\n';
    const start = before.indexOf('2026-01-01');
    const { text } = setFrontmatterKey(before, 'updated', '2026-08-15');
    assert.deepEqual(outside(before, start, '2026-01-01'.length), 
      outside(text, start, '2026-08-15'.length)
    );
  });

  it('changes no byte outside the insertion point when the value is empty', () => {
    const before = '---\ncreated: 2026-05-03\nstatus:\ntags:\n  - work\n---\n\nBody\n';
    const start = before.indexOf('status:') + 'status:'.length;
    const { text } = setFrontmatterKey(before, 'status', 'done');
    assert.deepEqual(outside(before, start, 0), outside(text, start, ' done'.length));
  });
});
