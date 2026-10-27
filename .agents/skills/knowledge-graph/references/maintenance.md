# Maintenance round

Run when drift is visible, not on a schedule. Report findings before making sweeping
changes — batch edits across a vault are hard to review after the fact.

`02-inbox/` and `01-daily/` are **not** part of this round. Both are capture surfaces with
their own drain, run when User asks for it — an undrained day is not backlog, and a
sweep that tidies a queue nobody asked it to touch destroys the queue's meaning.

## 1. Run the checkers

```bash
kg check-frontmatter   # frontmatter shape, closed tag vocabulary
kg check-links         # broken links, orphans, invented targets
kg tag list            # live domain and shape policy
```

Add `--base <dir>` to check a vault elsewhere, `--json` if you are going to parse the
result rather than read it.

That is orphans and broken links done, properly. Do not hand-roll a grep for either:
`check-links.ts` knows about attachments, and about the buckets that owe nobody an
inbound link — `templates/` and `02-inbox/`, in the `08-archive/` mirror as well as
live. A grep does not, so it reports every one of those as an orphan, and an agent that
trusts it closes them with invented links. **Fabricating a relationship to satisfy a
script is the one repair never allowed.** Fix a real orphan by linking from the note
that should own it, never by inventing an index note; where no honest linker exists,
leave it unlinked and tell User.

The script agrees: broken links fail, orphans are listed and do not. A note nothing cites
yet is a judgement call, so it is reported to User rather than suppressed in the script.
Report the list; do not close it unasked.

A link to a note that does not exist is removed, not answered with a new note:
`kg unlink-missing --dry-run`, review the plan, then run it without the flag. It
replaces `[[target]]` and `[[target#heading]]` with `target`, `[[target|display]]` with
`display`, and leaves code, ambiguous links and missing `![[embeds]]` (listed) alone.

Tag sprawl is also handled here rather than by counting: the vault-owned vocabulary is
closed, so a novel tag fails instead of accumulating. Inspect it with `kg tag list`.
Reuse an existing semantic domain when it fits; register with `kg tag add <tag>` only
for a genuine new ongoing area, never simply to clear a failure. Review `--dry-run` first,
and use `--allow-near-duplicate` only for an intentionally distinct spelling.

## 2. What the checkers miss

**Frontmatter keys nothing else uses.** The checker closes the tag list but not the key
set, so a note carrying an invented key passes silently — usually because an instruction
said to record something "in frontmatter" and meant an existing key.

```bash
find 0*-* templates \
  -name '*.md' -exec awk '/^---$/{n++;next} n==1 && /^[a-z_]+:/{print $1}' {} \; \
  | sort | uniq -c | sort -rn
```

One key against hundreds is the whole signal.

**Duplicate filenames** are no longer here — `check-links.ts` fails on them before it
checks anything else. A wikilink names a file rather than a path, so two notes sharing a
basename is an ambiguous address, and the link checker's own resolution collapses them
into one note: a link to either counts as an inbound link to both, which hides an orphan.
It is the precondition for the rest of that script, not a tidiness rule.

**Stale status.** `03-initiatives/` with `status: active` and `updated` more than ~3 months
old: finished, abandoned, or genuinely paused? Set `paused`/`done` and archive if done.
`status` exists only on initiatives and areas — no other bucket carries it.

This check is blind for a while after a bulk import, because every imported note is
stamped with the import date and `updated:` carries no staleness signal until the vault
has been lived in for a season.

**Flat areas.** Every area is a folder, so a `.md` at the bucket root is
drift — move it to `04-areas/<name>/<name>.md`.

```bash
find 04-areas 08-archive/04-areas -maxdepth 1 -name '*.md'
kg move 04-areas/pottery.md 04-areas/pottery/pottery.md
```

Use the CLI, not `mv`. The basename does not change here so no link needs rewriting,
but the script is what establishes that rather than assuming it.

**iCloud residue.**

```bash
find . -name '*.icloud'            # evicted placeholders — materialize before touching
find . -name '*conflicted copy*'   # merge by hand, then delete the loser
```

## 3. Leaked notes

A graph holds addresses, door codes and the occasional credential. If the vault is a git
repo, every note travels with a push — keep the remote private, and say so if it isn't.
If something sensitive is already pushed, say so — rewriting history is User's call.

## 4. Drift

Re-read `SKILL.md`, `README.md` and this file against what the vault actually looks like.
Rules describing a practice that was abandoned are worse than no rule — they mislead
every future agent. Delete them.

Check the machinery too, not just the prose: a snippet that no longer matches how the
vault is checked teaches the wrong habit every time someone follows it. This file has
drifted three times — once carrying a `status` ladder that had been removed from
`06-knowledge/`; once telling agents to grep for orphans in a way that would have reported
four deliberate decisions as defects; and once describing those four exceptions as a list
inside `check-links.ts` after the list had been deleted, when three of the four were only
ever the archive mirror of `02-inbox/` being read as a live bucket.
