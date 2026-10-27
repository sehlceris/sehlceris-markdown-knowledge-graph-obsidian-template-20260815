import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { maskCode, parseWikilinks, type Wikilink } from '../lib/wikilinks.ts';

/** Every link must point at itself: raw is the text at [start,end) and target is the text
 *  at [targetStart,targetEnd). If that holds, a rename splice cannot land in the wrong
 *  place. */
function assertOffsets(text: string): void {
  for (const l of parseWikilinks(text)) {
    assert.equal(text.slice(l.start, l.end), l.raw);
    assert.equal(text.slice(l.targetStart, l.targetEnd), l.target);
  }
}

/** The named fields of `link`, so a test states only what it is about. */
function pick(link: Wikilink | undefined, expected: Partial<Wikilink>): void {
  assert.ok(link, 'expected a link');
  const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, link[k as keyof Wikilink]]));
  assert.deepEqual(actual, expected);
}

const targets = (text: string): string[] => parseWikilinks(text).map((l) => l.target);

/** The grammar every editor of the vault has to agree on. */
const GRAMMAR: Partial<Wikilink>[] = [
  { raw: '[[note]]', target: 'note', anchor: null, display: null, isEmbed: false },
  {
    raw: '[[folder/note#Heading|label]]',
    target: 'folder/note',
    anchor: 'Heading',
    display: 'label',
    isEmbed: false,
  },
  { raw: '[[note#^block-id]]', target: 'note', anchor: '^block-id', display: null, isEmbed: false },
  { raw: '![[image.png]]', target: 'image.png', anchor: null, display: null, isEmbed: true },
];

describe('parseWikilinks', () => {
  it('reads the shared editor grammar', () => {
    for (const expected of GRAMMAR) pick(parseWikilinks(expected.raw!)[0], expected);
  });

  it('reads a bare link', () => {
    pick(parseWikilinks('see [[deck-rebuild]] for detail')[0], {
      raw: '[[deck-rebuild]]',
      target: 'deck-rebuild',
      anchor: null,
      display: null,
      isEmbed: false,
      start: 4,
      end: 20,
      targetStart: 6,
      targetEnd: 18,
    });
  });

  it('splits display text', () => {
    pick(parseWikilinks('[[house-elm|the house]]')[0], {
      target: 'house-elm',
      display: 'the house',
      targetStart: 2,
      targetEnd: 11,
    });
  });

  it('reads a table-escaped pipe as the display separator, keeping the backslash out', () => {
    const text = '| [[hugo-wang\\|Hugo]] | [[a/b#Top\\|top]] |';
    const [plain, anchored] = parseWikilinks(text);
    pick(plain, { target: 'hugo-wang', display: 'Hugo', anchor: null });
    pick(anchored, { target: 'a/b', display: 'top', anchor: 'Top' });
    assertOffsets(text);
  });

  it('splits a heading anchor', () => {
    pick(parseWikilinks('[[deck-rebuild#Framing]]')[0], {
      target: 'deck-rebuild',
      anchor: 'Framing',
      display: null,
    });
  });

  it('splits a block anchor', () => {
    pick(parseWikilinks('[[deck-rebuild#^a1b2c3]]')[0], { target: 'deck-rebuild', anchor: '^a1b2c3' });
  });

  it('splits an anchor and display together', () => {
    pick(parseWikilinks('[[a/b#Framing|framing notes]]')[0], {
      target: 'a/b',
      anchor: 'Framing',
      display: 'framing notes',
    });
  });

  it('reads an embed', () => {
    pick(parseWikilinks('![[deck-plan.png]]')[0], {
      raw: '![[deck-plan.png]]',
      target: 'deck-plan.png',
      isEmbed: true,
      start: 0,
      targetStart: 3,
    });
  });

  it('accepts targets with spaces and dots', () => {
    assert.deepEqual(targets('![[refs/2026.08 field notes.pdf]]'), ['refs/2026.08 field notes.pdf']);
    assertOffsets('![[refs/2026.08 field notes.pdf]]');
  });

  it('trims padding but points targetStart at the first real character', () => {
    const text = '[[  deck-rebuild  |x]]';
    const [link] = parseWikilinks(text);
    assert.equal(link?.target, 'deck-rebuild');
    assert.equal(text.slice(link!.targetStart, link!.targetEnd), 'deck-rebuild');
  });

  it('ignores an unclosed [[', () => {
    assert.deepEqual(parseWikilinks('a [[deck-rebuild and then nothing'), []);
    assert.deepEqual(parseWikilinks('a [[deck\nrebuild]]'), []);
  });

  it('ignores a same-note heading link with no target', () => {
    assert.deepEqual(parseWikilinks('[[#Framing]]'), []);
  });

  it('ignores links inside a fenced block while keeping later offsets true', () => {
    const text = [
      'Intro [[first]].',
      '',
      '```md',
      '[[not-a-link]] and [[also-not]]',
      '```',
      '',
      'Outro [[second]].',
      '',
    ].join('\n');
    assert.deepEqual(targets(text), ['first', 'second']);
    assertOffsets(text);
  });

  it('ignores links inside a tilde fence', () => {
    const text = '~~~\n[[hidden]]\n~~~\n[[shown]]\n';
    assert.deepEqual(targets(text), ['shown']);
    assertOffsets(text);
  });

  it('ignores links inside an inline code span', () => {
    const text = 'Write `[[target]]` to link, as in [[deck-rebuild]].';
    const links = parseWikilinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.target, 'deck-rebuild');
    assert.equal(text.slice(links[0]!.start, links[0]!.end), '[[deck-rebuild]]');
  });

  it('ignores links inside a double-backtick span', () => {
    const text = 'Use ``[[old]]`` literally, then link [[deck-rebuild]].';
    assert.deepEqual(targets(text), ['deck-rebuild']);
    assertOffsets(text);
  });

  it('reads links on both sides of an inline code span', () => {
    const text = '[[before]] then `[[quoted]]` then [[after]].';
    assert.deepEqual(targets(text), ['before', 'after']);
    assertOffsets(text);
  });

  it('treats an unterminated fence as code to the end of the note', () => {
    const text = 'Intro [[first]].\n\n```js\nconst a = [[old]];\n';
    assert.deepEqual(targets(text), ['first']);
    assertOffsets(text);
  });

  it('keeps a long fence open across a shorter one inside it', () => {
    const text = [
      'Intro [[first]].',
      '',
      '`````md',
      '```',
      '[[inner]]',
      '```',
      '`````',
      '',
      'Outro [[second]].',
      '',
    ].join('\n');
    assert.deepEqual(targets(text), ['first', 'second']);
    assertOffsets(text);
  });

  it('closes a fence on a longer run of the same character', () => {
    const text = '```\n[[hidden]]\n``````\n[[shown]]\n';
    assert.deepEqual(targets(text), ['shown']);
    assertOffsets(text);
  });

  it('does not close a backtick fence on a tilde line, or the reverse', () => {
    assert.deepEqual(targets('```\n~~~\n[[hidden]]\n~~~\n```\n[[shown]]\n'), ['shown']);
    assert.deepEqual(targets('~~~\n```\n[[hidden]]\n```\n~~~\n[[shown]]\n'), ['shown']);
  });

  it('does not start a code span on a backtick inside a fenced block', () => {
    const text = '```\nlone ` backtick\n[[hidden]]\n```\n\nOutro [[shown]].\n';
    assert.deepEqual(targets(text), ['shown']);
    assertOffsets(text);
  });

  it('reads a fence indented under a list item', () => {
    const text = [
      '1. run:',
      '',
      '    ```sh',
      '    kg resolve [[old]]',
      '    ```',
      '',
      'Then [[after]].',
      '',
    ].join('\n');
    assert.deepEqual(targets(text), ['after']);
    assertOffsets(text);
  });

  it('ignores links in an indented code block', () => {
    const text = 'Intro.\n\n    const a = [[old]];\n\nOutro [[second]].\n';
    assert.deepEqual(targets(text), ['second']);
    assertOffsets(text);
  });

  it('keeps a link on an indented paragraph continuation line', () => {
    const text = 'A sentence that wraps\n    onto a continuation line about [[deck-rebuild]].\n';
    assert.deepEqual(targets(text), ['deck-rebuild']);
    assertOffsets(text);
  });

  it('keeps a link in a nested bullet under a loose list', () => {
    const text = '- outer\n\n    - nested [[house-elm]]\n';
    assert.deepEqual(targets(text), ['house-elm']);
    assertOffsets(text);
  });

  it('keeps offsets true for a link right after a masked region', () => {
    const text = '```\n[[hidden]]\n```\n[[shown]] and `x` [[again]]';
    const links = parseWikilinks(text);
    assert.deepEqual(
      links.map((l) => l.target),
      ['shown', 'again']
    );
    assert.equal(links[0]?.start, text.indexOf('[[shown]]'));
    assert.equal(links[1]?.start, text.indexOf('[[again]]'));
    assertOffsets(text);
  });

  it('masks a CRLF fence the same as an LF one', () => {
    const text = 'Intro [[first]].\r\n\r\n```md\r\n[[hidden]]\r\n```\r\n\r\nOutro [[second]].\r\n';
    assert.deepEqual(targets(text), ['first', 'second']);
    assertOffsets(text);
  });

  it('keeps offsets true across CRLF', () => {
    const text = '---\r\ntags:\r\n  - work\r\n---\r\n\r\nSee [[deck-rebuild]] and [[house-elm|home]].\r\n';
    assert.deepEqual(targets(text), ['deck-rebuild', 'house-elm']);
    assertOffsets(text);
  });

  it('finds every occurrence, not one per target', () => {
    const links = parseWikilinks('[[a]] then [[a]] then [[a]]');
    assert.deepEqual(
      links.map((l) => l.start),
      [0, 11, 22]
    );
  });
});

/** Every code form the masker knows about, each carrying a "[[" that must not survive, plus
 *  the shapes that have broken length preservation before: CRLF, unterminated fences, runs
 *  of odd length, tabs, no trailing newline. */
const ADVERSARIAL = [
  'a\n```\n[[x]]\n```\nb `[[y]]` c\n',
  '``[[x]]``',
  '```js\n[[x]]\n',
  '`````\n```\n[[x]]\n```\n`````\n',
  '~~~\n[[x]]\n~~~~~~\n',
  '1. run:\n\n    ```sh\n    [[x]]\n    ```\n',
  'intro\n\n    [[x]]\n',
  '\t[[x]]\n',
  '`` ` `` and ``[[x]]`` and `unclosed [[y]]',
  '```\r\n[[x]]\r\n```\r\n',
  '````\n``\n[[x]]\n``\n````',
  'no code at all, just [[a-link]] and prose',
  '',
  '\n\n\n',
  '```',
  '`',
];

describe('maskCode', () => {
  it('preserves length and line structure', () => {
    const text = 'a\n```\n[[x]]\n```\nb `[[y]]` c\n';
    const masked = maskCode(text);
    assert.equal(masked.length, text.length);
    assert.equal(masked.split('\n').length, text.split('\n').length);
    assert.ok(!masked.includes('[['));
  });

  it('blanks every code form that can hide a [[', () => {
    for (const text of ADVERSARIAL) {
      if (text.includes('[[x]]')) assert.ok(!maskCode(text).includes('[[x]]'), JSON.stringify(text));
    }
    // The one link that is not code survives, at its original offset.
    const prose = 'no code at all, just [[a-link]] and prose';
    assert.equal(maskCode(prose), prose);
  });

  it('preserves length and newline offsets on adversarial input', () => {
    for (const text of ADVERSARIAL) {
      const masked = maskCode(text);
      assert.equal(masked.length, text.length, JSON.stringify(text));
      for (let i = 0; i < text.length; i += 1) {
        assert.equal(masked[i] === '\n', text[i] === '\n', `${JSON.stringify(text)} at ${i}`);
      }
    }
  });
});
