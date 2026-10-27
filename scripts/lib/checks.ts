// The vault's health checks.
//
// Links: a link that resolves to nothing is always wrong — its target was renamed and its
// linkers were not, or something invented a target. A link matching two notes has no single
// answer. Both fail. A note nothing links to is a judgement call — it may be waiting for the
// note that will cite it — so orphans are listed, never a failure.
//
// Frontmatter: the convention is `created`, `updated` and a block-sequence `tags` drawn from
// the closed vocabulary; `status` only on initiatives and areas.

import { buildLinkGraph } from './graph.ts';
import { readFrontmatter } from './frontmatter.ts';
import { bucketOf, type Vault } from './vault.ts';
import { tagProblems, TAG_VOCABULARY_FILE } from './vocabulary.ts';

export interface BrokenLink {
  /** Vault path of the note the link is written in. */
  from: string;
  target: string;
  /** The link as written, so a report can be grepped back to its source. */
  raw: string;
}

export interface AmbiguousLink extends BrokenLink {
  matches: string[];
}

export interface LinksReport {
  /** false when anything is broken or ambiguous. Orphans never move this. */
  ok: boolean;
  notes: number;
  broken: BrokenLink[];
  ambiguous: AmbiguousLink[];
  orphans: string[];
}

export function checkLinks(vault: Vault): LinksReport {
  const graph = buildLinkGraph(vault);
  // The graph records every occurrence; a report does not. One dead target quoted three
  // times in one note is one thing to fix.
  const broken = unique(graph.broken.map(({ from, link }) => ({ from, target: link.target, raw: link.raw })));
  const ambiguous = unique(
    graph.ambiguous.map(({ from, link, matches }) => ({ from, target: link.target, raw: link.raw, matches }))
  );
  return {
    ok: broken.length === 0 && ambiguous.length === 0,
    notes: vault.notes.length,
    broken,
    ambiguous,
    orphans: graph.orphans,
  };
}

function unique<T extends BrokenLink>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.from}\0${i.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface FrontmatterProblem {
  path: string;
  message: string;
}

export interface FrontmatterReport {
  ok: boolean;
  checked: number;
  problems: FrontmatterProblem[];
}

const ENTITIES = '05-entities';

export function checkFrontmatter(vault: Vault): FrontmatterReport {
  const { config, vocabulary } = vault;
  const problems: FrontmatterProblem[] = [];
  const say = (path: string, message: string) => problems.push({ path, message });

  // Without a vocabulary no tag can be judged, so say that once rather than once per note.
  if (!vocabulary) say(TAG_VOCABULARY_FILE, vault.vocabularyError ?? 'tag vocabulary unavailable');

  for (const note of vault.notes) {
    const fm = readFrontmatter(vault.read(note.path));
    if (!fm.present) {
      say(note.path, 'no frontmatter');
      continue;
    }

    for (const key of ['created', 'updated', 'tags']) {
      if (fm.get(key) === null) say(note.path, `missing ${key}:`);
    }

    // `tags: [a, b]` is valid YAML, but Obsidian's Properties editor rewrites it as a block
    // sequence the moment a tag is added — so one form on disk. An inline array cannot be
    // read safely as tag values, so it gets this diagnostic and no other.
    if (fm.get('tags')?.startsWith('[')) {
      say(note.path, 'tags is an inline array; Obsidian writes a block sequence');
    } else if (vocabulary) {
      const permitEmpty = config.emptyTagBuckets.includes(bucketOf(note.path, config));
      for (const problem of tagProblems(vocabulary, fm.listValues('tags'), permitEmpty)) {
        say(note.path, problem);
      }
    }

    // A bare `status:` is a template's placeholder, not a status. The archive mirrors the
    // live buckets, so an archived initiative keeps its status.
    const status = fm.get('status');
    if (status && !config.statusBuckets.includes(bucketOf(note.path, config))) {
      say(note.path, `status "${status}" — only ${config.statusBuckets.join(' and ')} carry one`);
    }
  }

  problems.push(...entityNameProblems(vault));
  return { ok: problems.length === 0, checked: vault.notes.length, problems };
}

// A group note named after a person carries that person's full name, so jane-family.md is
// wrong wherever jane-okafor.md exists. Only fires when the fuller name is in the vault.
function entityNameProblems(vault: Vault): FrontmatterProblem[] {
  const entities = vault.notes.filter((n) => n.path.startsWith(`${ENTITIES}/`));
  const out: FrontmatterProblem[] = [];
  for (const entity of entities) {
    const m = /^(.+)-(family|friends)$/.exec(entity.basename);
    if (!m) continue;
    const [, prefix, suffix] = m;
    const fuller = entities.find(
      (e) => e.basename.startsWith(`${prefix}-`) && !/-(family|friends)$/.test(e.basename)
    );
    if (fuller) {
      out.push({ path: entity.path, message: `names a person by first name only — use ${fuller.basename}-${suffix}` });
    }
  }
  return out;
}
