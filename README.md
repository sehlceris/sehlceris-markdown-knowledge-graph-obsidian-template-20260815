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

`tags` come from the vault's closed vocabulary in `tag-vocabulary.json` (empty to start —
add domain tags as real areas appear). `status` runs `active`/`paused`/`done` on
initiatives and areas only. References carry `source:`; entities carry `email`, `phone`,
`url`.

The `.obsidian/` config turns on daily notes (into `01-daily/` from
`templates/daily-note.md`), templates, and link-updating on rename. In VS Code, Foam gives
the same rename-safe wikilinks. Agents: see `AGENTS.md` and the `knowledge-graph` skill in
`.agents/skills/`.

**A vault holds addresses, door codes and the occasional credential.** If you put your
copy under git, keep the remote private.
