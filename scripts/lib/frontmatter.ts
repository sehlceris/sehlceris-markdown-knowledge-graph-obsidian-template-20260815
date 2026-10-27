// Line-precise frontmatter reading and one-key writing. No YAML library, ever: they coerce
// `created: 2026-08-15` into a Date and destroy comments, quote styles and inline arrays,
// and reserializing breaks the rule that an edit to one part of a note leaves every other
// byte untouched.
//
// So this is regexes over offsets, and a write is a splice of exactly the value that
// changed — which means the value has to be delimited exactly, comment and all. CRLF
// survives because nothing here rewrites a line ending.

export interface Frontmatter {
  present: boolean;
  /** Offsets of the whole block including its --- delimiters. */
  start: number;
  end: number;
  /** Raw text between the --- fences. */
  body: string;
  /** Scalar value, trimmed and without any trailing `# comment`; null if the key is
   *  absent. Quotes are part of the value — this reports the line, it does not decode it. */
  get(key: string): string | null;
  /** Items of a block sequence under `key:`. */
  listValues(key: string): string[];
}

interface Block {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  body: string;
}

/** Frontmatter opens on the very first line, the way Obsidian requires. A `---` further
 *  down is a horizontal rule. */
const OPEN = /^---[ \t]*\r?\n/;
// The closing fence may end the file without a newline — a note last written by a tool
// that trimmed the trailing byte still has frontmatter.
const CLOSE = /^---[ \t]*(\r?\n|$)/gm;

function locate(text: string): Block | null {
  const open = OPEN.exec(text);
  if (!open) return null;
  const bodyStart = open[0].length;
  CLOSE.lastIndex = bodyStart;
  const close = CLOSE.exec(text);
  if (!close) return null;
  return {
    start: 0,
    end: close.index + close[0].length,
    bodyStart,
    bodyEnd: close.index,
    body: text.slice(bodyStart, close.index),
  };
}

const escape = (key: string): string => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the key at column zero only, so a nested `  updated:` under some other key is
 *  not mistaken for the note's own. Group 1 is the whitespace after the colon, group 2 is
 *  the rest of the line — value, any trailing comment, and a CRLF's \r. */
const scalarRe = (key: string): RegExp => new RegExp(`^${escape(key)}:([ \\t]*)([^\\n]*)$`, 'm');

interface Scalar {
  /** Offset of the value within the frontmatter body. */
  start: number;
  /** The value alone: no surrounding whitespace, no trailing comment, no \r. */
  value: string;
  /** Whitespace between the colon and the value. Empty on a bare `status:`. */
  lead: string;
  /** Everything from the end of the value to the newline: the whitespace before a
   *  comment, the comment itself, and a CRLF's \r. */
  trailing: string;
}

/** Where a scalar value ends: at a `#` that starts a comment, or at the end of the line.
 *
 *  YAML starts a comment at a `#` that opens the line or follows whitespace, so `b#c` is
 *  the value `b#c` and needs no care. A quoted scalar does: `title: "a # b"` holds a hash,
 *  not a comment, so a value that opens with a quote is scanned to its closing quote
 *  first. That is the whole of the quote handling — this is a line-level splice, not a
 *  YAML parser. */
function valueEnd(rest: string): number {
  let i = 0;
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    for (i = 1; i < rest.length; i += 1) {
      if (quote === '"' && rest[i] === '\\') i += 1;
      else if (rest[i] === quote) {
        // '' is an escaped quote inside a single-quoted scalar, not the end of one.
        if (quote === "'" && rest[i + 1] === "'") i += 1;
        else {
          i += 1;
          break;
        }
      }
    }
  }
  for (; i < rest.length; i += 1) {
    if (rest[i] === '#' && (i === 0 || rest[i - 1] === ' ' || rest[i - 1] === '\t')) return i;
  }
  return rest.length;
}

function findScalar(body: string, key: string): Scalar | null {
  const m = scalarRe(key).exec(body);
  if (!m || m.index === undefined) return null;

  const lead = m[1] ?? '';
  const raw = m[2] ?? '';
  // A CRLF line puts its \r at the end of the capture. Keep it out of the value and out of
  // the splice — normalizing line endings is exactly the byte-level damage this module
  // exists to avoid.
  const cr = raw.endsWith('\r') ? '\r' : '';
  const rest = cr ? raw.slice(0, -1) : raw;
  const value = rest.slice(0, valueEnd(rest)).replace(/[ \t]+$/, '');

  return {
    start: m.index + m[0].length - raw.length,
    value,
    lead,
    trailing: rest.slice(value.length) + cr,
  };
}

export function readFrontmatter(text: string): Frontmatter {
  const block = locate(text);
  if (!block) {
    return {
      present: false,
      start: 0,
      end: 0,
      body: '',
      get: () => null,
      listValues: () => [],
    };
  }
  return {
    present: true,
    start: block.start,
    end: block.end,
    body: block.body,
    get: (key) => findScalar(block.body, key)?.value ?? null,
    listValues: (key) => listValues(block.body, key),
  };
}

// Only the sequence under the named key. Reading every `  - x` in the block instead treats
// an `aliases:` entry as a tag and reports the note as carrying unknown vocabulary — the
// note is correct and the checker is wrong. Obsidian's Properties pane writes `aliases:`
// as soon as one is added, so this is one edit away at any time.
function listValues(body: string, key: string): string[] {
  const block =
    new RegExp(
      `^${escape(key)}:[ \\t]*(?:#[^\\r\\n]*)?\\r?\\n((?:[ \\t]+-[^\\n]*\\n?)*)`,
      'm'
    ).exec(body)?.[1] ?? '';
  return [...block.matchAll(/^[ \t]+-[ \t]*(.*)$/gm)]
    .map((m) => (m[1] ?? '').trim())
    .filter((v) => v.length > 0);
}

/** Returns new text with `key: value` set. Replaces exactly the existing value — the
 *  splice touches no other byte, so a trailing `# comment`, the surrounding quotes' style
 *  and the line ending all survive.
 *
 *  Three cases return the text unchanged with `changed: false`: no frontmatter block, the
 *  key is absent, and the key heads a block sequence. Inventing the key is the caller's
 *  decision, not this function's: archiving bumps `status:` only on notes that already
 *  carry one, and a checker that repairs what it reads is a checker nobody can trust.
 *  A sequence has no scalar to replace at all — writing one where `tags:` opens a list
 *  would leave the `  - ` items orphaned under a scalar, so it is refused too. */
export function setFrontmatterKey(
  text: string,
  key: string,
  value: string
): { text: string; changed: boolean } {
  const block = locate(text);
  if (!block) return { text, changed: false };
  if (listValues(block.body, key).length > 0) return { text, changed: false };

  const found = findScalar(block.body, key);
  if (!found) return { text, changed: false };

  // `status:` ships bare in the initiative template, and a value spliced straight onto the
  // colon — `status:done` — is not a mapping entry any more, so Obsidian loses the
  // property. Supply the separator the line never had.
  const before = found.lead === '' ? ' ' : '';
  // `status:  # set when finished` puts the comment where the value goes; keep them apart.
  const after = found.value === '' && found.trailing.startsWith('#') ? ' ' : '';

  const start = block.bodyStart + found.start;
  const next =
    text.slice(0, start) + before + value + after + text.slice(start + found.value.length);
  return { text: next, changed: next !== text };
}
