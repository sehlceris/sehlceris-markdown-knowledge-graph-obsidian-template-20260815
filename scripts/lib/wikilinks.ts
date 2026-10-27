// Finds wikilinks in a note and reports where they are.
//
// Offsets are into the ORIGINAL text, because a move splices them back. That is why code
// regions are masked with same-length filler rather than deleted: a link at offset 900 has
// to still be at offset 900 after the note above it turns out to contain a fenced block.

export interface Wikilink {
  /** The whole match, "![[a/b#h|d]]". */
  raw: string;
  /** "a/b" — trimmed, no anchor, no display. */
  target: string;
  /** "h" or "^block-id", without the leading #. */
  anchor: string | null;
  /** "d". */
  display: string | null;
  isEmbed: boolean;
  /** Offset of "[" (or "!") in the original text. */
  start: number;
  /** Offset just past "]]". */
  end: number;
  /** Offset of the target text itself — what rename splices. */
  targetStart: number;
  targetEnd: number;
}

// Code spans and fenced blocks hold examples, not links, and Obsidian does not resolve
// them either. Without this a note *about* wikilinks cannot be written: every `[[foo]]`
// it quotes reads as a link to a note that will never exist, and the honest repairs —
// delete the passage, or create the note it appears to name — both damage something to
// satisfy a script.
//
// The scan is line-oriented rather than a pair of regexes, because both fences and code
// spans are runs of variable length matched against a later run of at least (fence) or
// exactly (span) that length — a backreference can't express "three or more", so a regex
// pinned to ``` mispairs the moment a note quotes a fence inside a longer one.

/** An open fence remembers what would close it: same character, at least as long, not
 *  indented much further. */
interface OpenFence {
  char: string;
  len: number;
  indent: number;
}

/** ```/~~~ and up, at any indent — a fence inside a list sits past column 4. */
const FENCE_LINE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^[ \t]*([-*+]|\d{1,9}[.)])(\s|$)/;

/** Same-length filler for one line's worth of text, which never contains a newline. */
const blank = (line: string): string => ' '.repeat(line.length);

/** Columns of leading whitespace, counting a tab as four. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

/** Blanks inline code spans in one line. A span opens on a run of N backticks and closes
 *  on the next run of exactly N; a run with no closer is literal text, so scanning resumes
 *  after it rather than swallowing the rest of the line. */
function maskInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line.charAt(i) !== '`') {
      out += line.charAt(i);
      i += 1;
      continue;
    }
    const openStart = i;
    while (i < line.length && line.charAt(i) === '`') i += 1;
    const runLength = i - openStart;

    let j = i;
    let closeEnd = -1;
    while (j < line.length) {
      if (line.charAt(j) !== '`') {
        j += 1;
        continue;
      }
      const runStart = j;
      while (j < line.length && line.charAt(j) === '`') j += 1;
      if (j - runStart === runLength) {
        closeEnd = j;
        break;
      }
    }

    if (closeEnd < 0) {
      out += line.slice(openStart, i);
      continue;
    }
    out += blank(line.slice(openStart, closeEnd));
    i = closeEnd;
  }
  return out;
}

/** The text with code regions replaced by same-length filler. Exported because the link
 *  checkers want the same view of a note the parser had.
 *
 *  Every line comes back exactly as long as it went in and newlines stay put, so offsets
 *  taken from the masked text index the original. */
export function maskCode(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  let fence: OpenFence | null = null;
  let inIndentedCode = false;
  // Start of document counts as "after a blank line", so a note may open with code.
  let prevBlank = true;
  // Continuation lines under a list marker are indented but are still prose; requiring a
  // deeper indent there keeps a nested bullet from reading as a code block.
  let inList = false;

  for (const raw of lines) {
    // Split on "\n" alone so CRLF keeps its "\r" at the offset it already had.
    const eol = raw.endsWith('\r') ? '\r' : '';
    const line = eol ? raw.slice(0, -1) : raw;
    const emit = (masked: string): void => {
      out.push(masked + eol);
    };

    const fenceMatch = FENCE_LINE.exec(line);
    let fenceRun: { indent: number; char: string; len: number; info: string } | null = null;
    if (fenceMatch) {
      const [, pad = '', run = '', info = ''] = fenceMatch;
      fenceRun = { indent: indentWidth(pad), char: run.slice(0, 1), len: run.length, info };
    }

    if (fence) {
      // A closer is the same character, at least as long, bare, and not indented far past
      // where the opener sat.
      if (
        fenceRun &&
        fenceRun.char === fence.char &&
        fenceRun.len >= fence.len &&
        fenceRun.info.trim() === '' &&
        fenceRun.indent <= fence.indent + 3
      ) {
        fence = null;
      }
      emit(blank(line));
      continue;
    }

    const blankLine = line.trim() === '';
    const indent = indentWidth(line);
    const codeIndent = inList ? 8 : 4;

    if (inIndentedCode) {
      if (blankLine || indent >= codeIndent) {
        prevBlank = blankLine;
        emit(blank(line));
        continue;
      }
      inIndentedCode = false;
    }

    // A backtick fence's info string may not contain a backtick; a tilde fence's may.
    if (fenceRun && (fenceRun.char === '~' || !fenceRun.info.includes('`'))) {
      fence = { char: fenceRun.char, len: fenceRun.len, indent: fenceRun.indent };
      prevBlank = false;
      emit(blank(line));
      continue;
    }

    // Indented code interrupts nothing: without the blank line this is just a wrapped
    // paragraph, and masking it would hide real links.
    if (!blankLine && prevBlank && indent >= codeIndent) {
      inIndentedCode = true;
      prevBlank = false;
      emit(blank(line));
      continue;
    }

    if (!blankLine) {
      if (LIST_ITEM.test(line)) inList = true;
      else if (indent === 0) inList = false;
    }
    prevBlank = blankLine;
    emit(maskInlineCode(line));
  }

  return out.join('\n');
}

// A wikilink lives on one line. Excluding newlines from the body is also what makes an
// unclosed "[[" not a link: there is nothing for the "]]" to match across.
const WIKILINK = /(!?)\[\[([^[\]\n]*)\]\]/g;

export function parseWikilinks(text: string): Wikilink[] {
  const masked = maskCode(text);
  const out: Wikilink[] = [];

  for (const m of masked.matchAll(WIKILINK)) {
    const bang = m[1] === '!';
    const body = m[2] ?? '';
    const start = m.index;
    // Offset of the first character inside "[[", in the original text.
    const bodyStart = start + (bang ? 3 : 2);

    let head = body;
    let display: string | null = null;
    const pipe = body.indexOf('|');
    if (pipe >= 0) {
      // Inside a markdown table the pipe has to be written `\|`, and Obsidian reads
      // `[[note\|label]]` as `[[note|label]]`. The backslash belongs to the table, not the
      // target, so it stays in the text and out of what resolves or gets spliced.
      head = body.slice(0, body.charAt(pipe - 1) === '\\' ? pipe - 1 : pipe);
      display = body.slice(pipe + 1).trim() || null;
    }

    let targetRaw = head;
    let anchor: string | null = null;
    const hash = head.indexOf('#');
    if (hash >= 0) {
      targetRaw = head.slice(0, hash);
      anchor = head.slice(hash + 1).trim() || null;
    }

    const target = targetRaw.trim();
    // "[[#heading]]" points inside the current note. It has no target to resolve and
    // nothing to rewrite on a rename, so it is not one of ours.
    if (!target) continue;

    const targetStart = bodyStart + (targetRaw.length - targetRaw.trimStart().length);
    const end = start + m[0].length;

    out.push({
      raw: text.slice(start, end),
      target,
      anchor,
      display,
      isEmbed: bang,
      start,
      end,
      targetStart,
      targetEnd: targetStart + target.length,
    });
  }

  return out;
}
