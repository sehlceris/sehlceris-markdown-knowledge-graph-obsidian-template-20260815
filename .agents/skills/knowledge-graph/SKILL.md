---
name: knowledge-graph
description: Rules for reading, writing, filing, and maintaining User's Obsidian knowledge graph (01-daily / 02-inbox / 03-initiatives / 04-areas / 05-entities / 06-knowledge / 07-references / 08-archive / templates). Use this whenever you touch a note in this vault — capturing something, deciding where a file goes, writing frontmatter, adding links, archiving finished work, or tidying drift. Also use it when the user says "save this", "capture this", "where does this go", "add to my notes", "file this", "clean up the vault", "who is X", "add a contact", or hands you an article, transcript, PDF, or screenshot to keep.
---

# Knowledge graph

A PARA variant. Seven live buckets, `templates/`, and a mirrored archive. The graph's
value is in the links, not the folders — folders give each note one home, links do the
real work.

Bucket folders carry a number prefix ordering them by how often User reaches for them:
`01-daily/` through `08-archive/`, with the archive's mirror subfolders numbered to
match. `templates/` is unnumbered. Write the number whenever you name a path — the
prefix is part of the folder name.

**Wikilinks resolve by path suffix**, so `[[note]]` finds that note whatever folder it
sits in. Three consequences run through everything below: moving a note between buckets
breaks no inbound link, renaming one breaks every inbound link, and a duplicate basename
costs every linker the bare form. Keep filenames unique vault-wide.

## Filing decision

Ask in order; first match wins.

1. **Is it the record of one particular day** — what happened, who was there?
   → `01-daily/YYYY-MM-DD.md`
2. **Is it a person or organization?** → `05-entities/<name>.md`
3. **Does it have a finish line, or serve one?** → `03-initiatives/<slug>/`
4. **Is it an ongoing role or domain that never completes, or a record kept to run
   one?** → `04-areas/<name>/`
5. **Did it come from outside, captured largely as-is?** (article, PDF, YouTube
   transcript, screenshot, ticket, spec) → `07-references/`
6. **Is it something User produced** — learned, concluded, synthesized, measured, or
   recorded? → `06-knowledge/`
7. **Can't tell, or is User moving fast?** → `02-inbox/`

Steps 3 and 4 catch an area's records, not only its hub note — ask them of every
note before reaching for knowledge or references. The test is whether the note is about a
_particular instance_: this house, these cats, my boards, my machines. A cat weight log
dies with the cats and lives under `04-areas/pets/`; a provisioning runbook outlives
the lab that prompted it and stays in `06-knowledge/`.

Two near misses. Why a note was captured is not what it is about — almost every reference
was pulled for some purpose, so provenance alone never moves one out of `07-references/`.
And only records that _operate_ an area move into it: one that is a standing interest
rather than something User runs — travel, reading — has nothing operational to hold, and
its material stays put, linked from the hub.

Never leave something in `02-inbox/` when the answer is obvious — inbox is for genuine
uncertainty and fast capture, not a default.

### References or knowledge

The split is authorship, not topic. `07-references/` is raw outside material captured
largely intact — articles, transcripts, clippings, deep-research output. Everything else
is `06-knowledge/`: not only what User concluded but what User recorded — observed values
logs, procedures, runbooks, build sheets, curated lists. A transcript of a video about
Paris is a reference; what User concluded from watching it is knowledge, and the two link
each other. The same subject routinely has notes in both. In doubt, it is knowledge.

Size decides a snippet, not origin. A few figures off a forum, a command someone posted —
User gathered that, so it is knowledge: reformat it into User's voice, noting where it
came from if that changes what it means. A whole document captured intact is a reference
however useful User found it.

**Recipes are the exception: a recipe is `07-references/` even when User wrote it.** A
recipe is looked up in order to be followed, so the collection has to sit in one place —
splitting a kitchen by who first wrote each dish down makes it unusable for the only thing
it is for. User's own derived ratios, macro workings and reformulations of someone else's
recipe are references too, linked to the original. What stays `06-knowledge/` nearby is
whatever is not itself a recipe: tasting notes, preferences, conclusions about ingredients.

### Before writing a new note, look for the note that already covers it

A finding about a device belongs in the note about that class of device; a gotcha about a
procedure belongs in that procedure. Search the vault first, and if something already owns
the subject, add to it and keep the addition tight. A separate note earns its place when it
is looked up on its own, not merely when it is true and interesting. The tell that this
went wrong is a stub — an existing note carrying one line and a link to the note that
should have been a paragraph inside it.

### Notes that grow into folders

**Any bucket's note can be a folder.** A note starts flat as `<bucket>/<slug>.md` and
becomes `<bucket>/<slug>/<slug>.md` once it grows children — sub-notes or attachments.
Promote when it grows rather than pre-building folders.

**`04-areas/` is the exception: an area is a folder from the day it is created**,
`04-areas/<name>/<name>.md`, even while that file is the only thing in it. An area never
completes, so it always accumulates eventually. Records kept to run an ongoing area live
under that area, not in `06-knowledge/`.

The note sharing the folder's name is the entry point — `04-areas/pets/pets.md`,
`03-initiatives/europe-2026/europe-2026.md` — and it carries the prose index of what is
inside. Never prefix it to sort it to the top: renaming a hub breaks every inbound link,
and hubs are the most-linked notes there are.

Records sit flat beside the hub note. `references/` is the one subfolder worth adding, and
only once a folder holds more than two or three outside captures. Deeper structure rebuilds
inside the area the categorization the buckets exist to avoid.

## The two capture surfaces

`01-daily/` and `02-inbox/` both hold unsorted material. They differ by shape, not by topic:

- **`01-daily/` is what User types** — a name jotted mid-event, a thought, a line about what
  happened. Time-anchored, many per note.
- **`02-inbox/` is what arrives** — a PDF, an article, a screenshot, a file handed over.
  Object-shaped, one per note, never part of a day's narrative.

If it is a line, it belongs to the day. If it is a file, it belongs in inbox.

## Daily notes

`01-daily/YYYY-MM-DD.md`. A day is the container for what happened on it and who was there.
Names met in passing live here — most are first-name-only and would collide as entities.

**`01-daily/` holds only undrained days.** Draining means reading the day through, promoting
whatever outlives it, linking both directions, then moving the whole note to
`08-archive/01-daily/`. Presence in the folder is the status; there is no `status:` key and no
list of what has been processed. `08-archive/01-daily/` is the diary.

Promotion during a drain:

| Found in the day                                        | Becomes                                 |
| ------------------------------------------------------- | --------------------------------------- |
| A conclusion User reached                               | `06-knowledge/`, linked back to the day |
| Someone with a full name and a relationship to maintain | `05-entities/`                          |
| Work with a finish line                                 | `03-initiatives/`                       |
| Everything else                                         | stays in the day and archives with it   |

Archiving does not break the trail: a note citing `[[2026-03-28]]` still resolves once that
day is archived, so every promoted note keeps pointing at where it came from.

**Never drain a daily note unprompted.** User decides when a day is finished — an event
may still be running, and a note sitting in `01-daily/` is not backlog. Drains are requested,
not scheduled, and User may skip the drain and archive a day directly.

## Sensitive material

Secrets in a note are handled by _what they are_, not where they came from.

- **Identifiers are ordinary content. File them normally.** Driver's licence numbers,
  date of birth, address, phone, VIN, device serials, licence plates, salary and mortgage
  figures, tax confirmation numbers, membership and policy numbers, gift card numbers,
  door codes, software licences. An identifier names something; it does not open it.
  SSH _public_ keys are published by design and are not secrets either.
- Genuinely sensitive values — passwords, API tokens, auth keys, account credentials —
  go to `02-inbox/` for User to place. The test is whether the value grants access.
  When they sit inside an otherwise useful note, split them out: the sensitive fields to
  `02-inbox/`, the rest filed where it belongs, the two linked.
- A file whose _name_ announces secrets goes to `02-inbox/secrets/` unread. Do not open it,
  quote it, summarize it, or pass it to another agent. User processes that folder alone.

This is the one place where routing to `02-inbox/` is correct rather than a deferral — it
is a deliberate quarantine, not an unmade decision.

## Entities

The rolodex: one note per person or organization, `05-entities/<name>.md`. Contact
details go in frontmatter so Obsidian's Properties pane can edit them on a phone; add
only the keys that exist.

```yaml
---
created: 2026-08-11
updated: 2026-08-11
tags:
  - <registered-domain-tag>
email: jane@acme.example
phone: '+1 555 0142'
url: https://acme.example
---
Backend lead at [[acme-corp]]. Introduced by [[dev-conf-2026]].
```

The body holds relationships and whatever User would want on hand before talking to
them — worked with, married to, hired by, met at. Link both directions when it matters;
a company note listing its people is worth the duplication.

An entity note is _who someone is_. What User concluded from talking to them is
`06-knowledge/`, and a transcript of the conversation is `07-references/` — both linking
back to the entity.

An entity is earned: a full name, and a relationship User expects to have again. A one-off
mention stays a line in whatever note names it, and a contractor who quoted a single job
belongs in that job's note rather than the rolodex. A thin note that might fill in later is
not reason enough — the rolodex is worth having because everything in it matters.

## Frontmatter

Keep it minimal. It has to survive hand-editing on a phone.

```yaml
---
created: 2026-08-11
updated: 2026-08-11
tags:
  - <registered-domain-tag>
  - <registered-shape-tag-if-applicable>
---
```

Tags are written as a YAML block sequence, one per line, because that is what Obsidian's
Properties editor writes. An inline `[a, b]` array parses fine but gets rewritten the
first time the property is touched in the app, so matching it now avoids the churn.
`node scripts/kg.ts check-frontmatter` enforces this. The vault owns its closed lists in
`tag-vocabulary.json`; inspect the live policy with `node scripts/kg.ts tag list` before choosing tags.

Tags run on two axes: **domain tags** — the ongoing areas a note belongs to — plus **shape
tags** for what kind of record it is. At least one domain, more when a note genuinely
straddles two, and any shape tags that apply. Domains say what a note is about; shapes cut
across domains on purpose. Both lists are closed and stay short — an open tag list is how
a graph acquires forty tags and no way in. Reuse an existing domain whenever its meaning
fits. Register a domain with `node scripts/kg.ts tag add <tag>` only when it represents a genuinely
new ongoing area, never merely to silence an unknown-tag error. Shape meanings come from
the live vocabulary and vault practice; do not assume a product-supplied literal.

Every filed note requires a registered domain tag. Empty tags are allowed only on the
capture and machinery surfaces: `01-daily/`, `02-inbox/`, and `templates/`.

`status` vocabulary by bucket:

| Bucket                   | Values                                                 |
| ------------------------ | ------------------------------------------------------ |
| 03-initiatives, 04-areas | `active`, `paused`, `done`                             |
| 07-references            | omit `status`; carry `source:` instead (URL or origin) |
| everything else          | omit `status`                                          |

Only work that can finish carries a status. `06-knowledge/` deliberately has none — a
maturity ladder nobody maintains is noise, and `updated:` already says how stale a note
is. `05-entities/` carry contact keys instead.

Bump `updated` whenever you meaningfully change a note. Don't bump it for a typo fix.
Use absolute dates, never "today" or "last week".

## Naming

`kebab-case.md`, descriptive, no dates in the filename except for genuinely dated
artifacts (meeting notes, journal entries). Check a generic-sounding name is free with
`node scripts/kg.ts resolve` before creating it — see Linking below.

Name entities by full name — `jane-okafor.md`, `acme-corp.md`. First names and bare
brands collide with topic notes, and the collision is silent.

**A note named after a person carries that person's full name, including group notes
derived from them** — `jane-okafor-family.md`, never `jane-family.md`. The rule is about
the person, not about the note's shape, so it does not stop at the entity note itself. A
bare first name is the one part of a filename guaranteed to repeat: a second Jane arrives,
`jane-family` is already taken, and the collision surfaces as a link quietly pointing at
the wrong family. Groups named after somewhere or something rather than someone —
`san-jose-friends`, `swan-lane-neighbours` — are already specific and need nothing added.

Name knowledge notes as the claim they make, not the topic they cover:
`why-mvcc-beats-locking.md` beats `mvcc.md`. A note whose title is a claim tends to stay
about one idea. That governs notes that assert something; procedures, runbooks, logs and
records are named for what they are — `macos-provisioning.md`, `blood-pressure-log.md`.

This rule names a note already worth writing; it is not a reason to write one. A finding
that belongs inside an existing note stays a paragraph there and gets no title of its own,
however cleanly it would phrase as a claim.

## Linking

Every note should be reachable from something. A note nothing links to is lost, however
well it's filed.

- An initiative links to the area it serves.
- A knowledge note links to the references it was synthesized from.
- Any note naming a person or company links the entity: `met with [[jane-okafor]]`.
  That backlink pane is the rolodex's real payoff — every dealing with someone, in one
  place, without maintaining a log by hand.
- A reference gets linked _from_ whatever motivated capturing it — the reference itself
  usually stays a dumb capture.
- Related knowledge notes link to each other. This is where the graph earns its keep.

Prefer `[[note-name]]`. Use `[[note-name|display text]]` when the sentence needs it.
Embed attachments with `![[file.png]]`.

Check a link lands before writing it, rather than after the checker fails:

```bash
node scripts/kg.ts resolve jane-okafor      # what does [[jane-okafor]] point at?
node scripts/kg.ts backlinks pottery.md     # what already points here?
```

`node scripts/kg.ts resolve` exits non-zero if the target hits nothing or more than one note, so it also
answers "is this filename already taken?" when you are about to create a note.

## Moving, renaming, archiving

**Never `mv` a note, and never rename one by hand.** Use the CLI:

```bash
node scripts/kg.ts move 02-inbox/thing.md 06-knowledge/thing.md
node scripts/kg.ts rename 06-knowledge/mvcc.md why-mvcc-beats-locking
node scripts/kg.ts move 03-initiatives/deck-rebuild.md 03-initiatives/deck-rebuild/
node scripts/kg.ts archive 03-initiatives/deck-rebuild.md   # -> 08-archive/03-initiatives/
node scripts/kg.ts unarchive 08-archive/01-daily/2026-08-15.md
```

`node scripts/kg.ts move` computes replacements against the vault's _post-move_ state and rewrites exactly
the links that would otherwise break, preserving `|display text`, `#headings` and
`^block-ids`. A move that changes no basename rewrites nothing — which is why changing
bucket and archiving are both free, and why hand-rewriting links afterward is wasted work
that risks breaking the graph. Renaming is the case that costs: every inbound `[[old-name]]`
has to change, and a new name colliding with an existing basename makes other notes' bare
links ambiguous. Use `--dry-run` first when the move is large — promoting a note to a
folder, archiving a folder, or draining a day.

`archive.ts` moves the file or folder to `08-archive/<same-bucket>/`, creating directories
as needed, bumps `updated`, and sets `status: done` where the bucket carries a status. It
never adds a `status` key to a note that had none. A bucket itself is never archived whole.
A folder whose mirror already exists merges into it; only a file landing on an existing
file is refused, and the refusal lists every collision.
User can do the same from Obsidian — Archive / Unarchive in the file menu runs the same
plan — so a note found already in `08-archive/` with a fresh `updated` got there properly.

Archive when an initiative ships or is abandoned, or an area ends (job change, kid
grows up, season over). Knowledge and references are archived rarely: outdated is not the
same as worthless, and a superseded note is better linked from its replacement than
buried. Entities effectively never archive — a person you've lost touch with is exactly
who you'll want to look up later; move one only when it's genuinely dead (company
dissolved, duplicate merged), and it carries no `status` to set.

## Attachments

Binaries live with the note that owns them, not in a central pile:

```
03-initiatives/london-paris-trip/
  itinerary.md
  flight-confirmation.png
  hotel-booking.pdf
07-references/
  paris-walking-tour-transcript.md
  paris-walking-tour-thumb.png
```

Embed them from the owning note so they're reachable in the graph.

## When the real world moves

A note that describes a running system goes stale the moment the system changes. Update it
to say what is true now, and link the replacement from whatever it replaced.

But a **recorded observation is not a claim about the present** — it preserves what
something did under stated conditions. Moving a workload off a machine does not make its
earlier reading wrong. Keep the value where it is and say what arrangement it was taken
under; deleting it loses data that cannot be re-taken. The same split governs the rest of
the note: procedures that still work are archived rather than dropped, while a statement
about where something runs is simply corrected.

## Templates

When the same note form recurs — a trip sheet, a machine-setup runbook, a race-day
checklist — the form itself belongs in `templates/` as one skeleton, and the instances
keep only what differs. Read `references/templates.md` before creating or deriving one:
a skeleton is copied into every note made from it, so a value left in one spreads.

## Maintenance

Do a cleanup round when drift shows up — orphaned notes, stale `status`, tag sprawl,
broken links. Read `references/maintenance.md` for the procedure; it's a checklist you
don't need in context the rest of the time. It never touches `02-inbox/` or `01-daily/`: those
are queues with their own drain, run when User asks.

Bulk-importing notes written outside this system is a different job with its own
failure mode — it has its own skill, `import-old-notes`. Read it before starting one.

## Updating this skill

When a filing decision turns out to be genuinely ambiguous and User resolves it, record
the resolution as one line in the section it belongs to — not a new section. If detail
outgrows a section, move it into this skill's own `references/` and leave a pointer.

Follow AGENTS.md's "Keep it simple" rules when doing so; this file loads on every vault
edit, so its context budget is tight.
