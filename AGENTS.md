# AGENTS.md

This directory is a markdown knowledge graph: an Obsidian vault of plain files, edited
from Obsidian, VS Code with Foam, and agents in a terminal. The files are the system.

**Invoke the `knowledge-graph` skill before touching any note.** It holds the filing
rules, frontmatter convention, linking and archiving practice. Don't reconstruct them
from the folder names — the references/knowledge split in particular is not guessable.

Whenever a note names a person or company, link the entity (`[[jane-okafor]]`). The
rolodex is only as good as its backlinks.

## Layout

```
01-daily/        dated notes, `YYYY-MM-DD.md` — what happened, who was there
02-inbox/        fast capture + genuine uncertainty
03-initiatives/  work with a finish line; one folder each, attachments inside
04-areas/        ongoing roles and domains that never complete; one folder each
05-entities/     people and organizations: contact details, tags, relationships
06-knowledge/    what User knows: learned, concluded, synthesized
07-references/   raw material captured from outside, largely as-is
08-archive/      mirrors the live buckets, using the same numbered names
templates/       reusable note skeletons, one per repeated form
```

Always write the full folder name including the number — `06-knowledge/`, never
`knowledge/`. Skills live in `.agents/skills/`; `.claude/skills` is a symlink to it.

## Hard constraints

- **Wikilinks resolve by path suffix, not by folder.** `[[note]]` finds that note in any
  folder, so moving a note between buckets breaks nothing — but renaming one breaks every
  inbound link. Keep filenames unique across the vault so the bare form always works.
- **Never `mv` a note.** Move and rename in Obsidian or Foam, which rewrite inbound links,
  or with the `kg` CLI from the knowledge-graph tooling (`kg move --base <vault>`). The
  `kg` commands the skill names come from that tooling; without it, use the editor.
- **Never run a note through a markdown or YAML serializer.** A round trip with no edit
  rewrites `---` to `***`, setext headings to ATX, list markers and indents. Edit in place.
- **`*.icloud` files are empty placeholders**, not notes. Materialize first with
  `brctl download <path>`. Don't move or rename across the vault during a large iCloud sync.
- **Stage by path, never `git add -A`**, if the vault is a git repo — Obsidian writes
  constantly, and a blanket stage sweeps up whatever User is mid-sentence on.

## Conventions

Notes are `kebab-case.md` with minimal YAML frontmatter: `created`, `updated`, and `tags`
as a block sequence (one `  - tag` per line, the form Obsidian's Properties editor
writes). `status` appears only on initiatives and areas. Dates are absolute. Links are
`[[wikilinks]]`; attachments embed as `![[file.png]]`.

Tags come from the closed vocabulary in `tag-vocabulary.json`. Every filed note carries at
least one registered domain tag; only `01-daily/`, `02-inbox/` and `templates/` may have
an empty tag list. Reuse an existing domain whenever it fits; register a new one only for
a genuinely new ongoing domain.
