# Knowledge graph — Obsidian vault template

A PARA variant, tuned. Plain markdown, Obsidian-native, portable to anything else.
Copy this directory, open it as a vault in Obsidian, and start writing.

```
01-daily/        dated notes — what happened that day, and who I met
02-inbox/        fast capture, and things I can't classify yet
03-initiatives/  has a finish line — one folder each, attachments inside
04-areas/        ongoing roles and domains that never finish — one folder each
05-entities/     people and companies — the rolodex
06-knowledge/    what I know — learned, concluded, or synthesized in my own words
07-references/   raw material from outside: articles, PDFs, transcripts, tickets
08-archive/      mirrors the live buckets, numbered the same way
templates/       reusable note skeletons, one per repeated form
```

The number prefixes order the buckets by how often I reach for them. Notes are addressed
by filename, so the numbers carry no meaning a wikilink depends on.

Three departures from PARA:

- **`04-areas/` holds roles and identities**, not just duties: `father`, `entrepreneur`,
  `personal-finance`. Initiatives end; areas don't. Each gets a folder from the start —
  `04-areas/<name>/<name>.md`.
- **Resources → `07-references/` + `06-knowledge/`.** Split on authorship. A YouTube
  transcript about Paris is a reference; what I concluded from watching it is knowledge.
  Both exist, linked to each other.
- **`05-entities/` is new.** One note per person or organization, contact details in
  frontmatter, relationships as links. An entity's backlinks become the running history
  of my dealings with them.

## Conventions

`kebab-case.md` filenames, unique across the vault, with minimal frontmatter:

```yaml
---
created: 2026-08-11
updated: 2026-08-11
tags:
  - travel
---
```

`tags` come from the vault's closed vocabulary in `tag-vocabulary.json`, which starts with
a working set of domain tags — prune or extend it to fit. `status` runs `active`/`paused`/`done` on
initiatives and areas only. References carry `source:`; entities carry `email`, `phone`,
`url`.

## Maintenance scripts

`scripts/` is a zero-dependency CLI that keeps the graph healthy — Node ≥22.18 runs the
TypeScript directly. `node scripts/kg.ts` lists the commands:

```
node scripts/kg.ts check                      broken or ambiguous links, frontmatter drift, orphans
node scripts/kg.ts move 02-inbox/x.md 06-knowledge/x.md   move without breaking a link
node scripts/kg.ts archive 03-initiatives/deck            finished work -> 08-archive/
node scripts/kg.ts tag add <tag>              register a new domain tag
```

`npm test` runs the suite.

## Obsidian plugin

The vault ships a small plugin, already built into `.obsidian/plugins/` and enabled: right-click
(long-press on a phone) a note or folder for **Archive** or **Unarchive**, or run
_Archive current note_ from the command palette. It runs the CLI's own archive plan — the
`08-archive/` mirror, `updated` bumped, `status: done` where a status exists, links kept
resolving — and works on desktop and mobile. Obsidian asks you to turn off Restricted mode
once per device before it loads any plugin. Source is in `plugins/`; `npm install` then
`npm run plugin:build` rebuilds it.

The `.obsidian/` config turns on daily notes (into `01-daily/` from
`templates/daily-note.md`), templates, and link-updating on rename. In VS Code, Foam gives
the same rename-safe wikilinks. Agents: see `AGENTS.md` and the `knowledge-graph` skill in
`.agents/skills/`.

**A vault holds addresses, door codes and the occasional credential.** If you put your
copy under git, keep the remote private.
