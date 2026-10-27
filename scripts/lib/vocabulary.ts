// The closed tag vocabulary, owned by the vault in `tag-vocabulary.json`.
//
// Two axes: domain tags say what a note is about, shape tags say what kind of record it is.
// Both lists are closed so a novel tag fails the frontmatter check instead of accumulating.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TAG_VOCABULARY_FILE = 'tag-vocabulary.json';

const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TagVocabulary {
  domainTags: string[];
  shapeTags: string[];
}

/** Strict: a vocabulary with no domain tags cannot validate a filed note, so it is an
 *  error here, not an empty answer. Registration uses `readVocabulary` instead. */
export function loadTagVocabulary(baseDir: string): TagVocabulary {
  const vocabulary = readVocabulary(baseDir);
  if (vocabulary === null) {
    throw new Error(`${vocabularyPath(baseDir)}: missing; run kg tag add <tag>`);
  }
  if (vocabulary.domainTags.length === 0) {
    throw new Error(`${vocabularyPath(baseDir)}: domainTags is empty; run kg tag add <tag>`);
  }
  return vocabulary;
}

/** The vocabulary, or null if the file does not exist. Malformed JSON throws: it has to be
 *  corrected deliberately, never silently replaced. */
export function readVocabulary(baseDir: string): TagVocabulary | null {
  const path = vocabularyPath(baseDir);
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseTagVocabulary(source, path);
}

export function parseTagVocabulary(source: string, path: string): TagVocabulary {
  const bad = (detail: string): Error => new Error(`${path}: malformed tag vocabulary: ${detail}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw bad('invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw bad('expected an object');
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== 'domainTags,shapeTags') {
    throw bad('expected only domainTags and shapeTags');
  }

  const list = (key: keyof TagVocabulary): string[] => {
    const value = record[key];
    if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) {
      throw bad(`${key} must be an array of strings`);
    }
    for (const tag of value as string[]) {
      if (!TAG.test(tag)) throw bad(`${key} contains a tag that is not lowercase kebab-case: ${JSON.stringify(tag)}`);
    }
    const dup = (value as string[]).find((t, i) => value.indexOf(t) !== i);
    if (dup) throw bad(`${key} contains a duplicate: ${dup}`);
    return value as string[];
  };

  const domainTags = list('domainTags');
  const shapeTags = list('shapeTags');
  const overlap = domainTags.filter((t) => shapeTags.includes(t));
  if (overlap.length) throw bad(`tags cannot appear in both lists: ${overlap.join(', ')}`);
  return { domainTags, shapeTags };
}

/** Problems with one note's tags. Empty tags are fine only where `permitEmpty` says so;
 *  everywhere else a note needs at least one registered domain. */
export function tagProblems(
  vocabulary: TagVocabulary,
  tags: readonly string[],
  permitEmpty: boolean
): string[] {
  if (tags.length === 0) {
    return permitEmpty ? [] : ['at least one registered domain tag is required'];
  }
  const known = new Set([...vocabulary.domainTags, ...vocabulary.shapeTags]);
  const problems = tags
    .filter((tag) => !known.has(tag))
    .map((tag) => `unknown tag "${tag}"; reuse a registered tag, or kg tag add <tag> for a new domain`);
  if (!tags.some((tag) => vocabulary.domainTags.includes(tag))) {
    problems.push('at least one registered domain tag is required');
  }
  return problems;
}

// ─── Registering a domain ────────────────────────────────────────────────────

export interface TagRegistration {
  tag: string;
  /** `added` is the only outcome that writes. `refused` carries a reason. */
  outcome: 'added' | 'existing' | 'refused';
  reason: string | null;
  /** Registered tags one edit away from `tag`. */
  nearDuplicates: string[];
  vocabulary: TagVocabulary;
}

export function planTagRegistration(
  baseDir: string,
  tag: string,
  opts: { allowNearDuplicate?: boolean } = {}
): TagRegistration {
  if (!TAG.test(tag)) throw new Error(`tag must be lowercase kebab-case: ${tag}`);

  const current = readVocabulary(baseDir) ?? { domainTags: [], shapeTags: [] };
  const result = (outcome: TagRegistration['outcome'], reason: string | null, near: string[] = []) => ({
    tag,
    outcome,
    reason,
    nearDuplicates: near,
    vocabulary: current,
  });

  if (current.domainTags.includes(tag)) return result('existing', null);
  if (current.shapeTags.includes(tag)) {
    return result('refused', `already registered as a shape tag: ${tag}`);
  }

  // A tag one typo from an existing one is almost always that one, misspelt.
  const near = [...current.domainTags, ...current.shapeTags].filter((t) => isOneEditApart(tag, t)).sort();
  if (near.length && !opts.allowNearDuplicate) {
    return result(
      'refused',
      `one edit away from ${near.join(', ')}; rerun with --allow-near-duplicate only if this spelling is intentional`,
      near
    );
  }

  return {
    ...result('added', null, near),
    vocabulary: { domainTags: [...current.domainTags, tag].sort(), shapeTags: current.shapeTags },
  };
}

/** Writes an `added` plan through a temp file and a rename, so a crash leaves the old
 *  vocabulary or the new one, never half of either. */
export function applyTagRegistration(baseDir: string, plan: TagRegistration): void {
  if (plan.outcome !== 'added') return;
  const path = vocabularyPath(baseDir);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(plan.vocabulary, null, 2)}\n`);
  renameSync(temp, path);
}

/** One insertion, deletion, substitution, or adjacent transposition apart. */
export function isOneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    const [i, j] = diffs;
    return diffs.length === 2 && j === i! + 1 && a[i!] === b[j] && a[j] === b[i!];
  }

  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let s = 0;
  let l = 0;
  let skipped = false;
  while (s < short.length && l < long.length) {
    if (short[s] === long[l]) {
      s++;
      l++;
    } else if (skipped) return false;
    else {
      skipped = true;
      l++;
    }
  }
  return true;
}

const vocabularyPath = (baseDir: string): string => join(baseDir, TAG_VOCABULARY_FILE);
