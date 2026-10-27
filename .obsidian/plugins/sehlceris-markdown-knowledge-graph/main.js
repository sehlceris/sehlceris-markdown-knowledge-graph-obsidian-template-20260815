// Generated from plugins/sehlceris-markdown-knowledge-graph/ by `npm run plugin:build`. Do not edit.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// plugins/sehlceris-markdown-knowledge-graph/src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => KnowledgeGraphPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// scripts/lib/frontmatter.ts
var OPEN = /^---[ \t]*\r?\n/;
var CLOSE = /^---[ \t]*(\r?\n|$)/gm;
function locate(text) {
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
    body: text.slice(bodyStart, close.index)
  };
}
var escape = (key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var scalarRe = (key) => new RegExp(`^${escape(key)}:([ \\t]*)([^\\n]*)$`, "m");
function valueEnd(rest) {
  let i = 0;
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    for (i = 1; i < rest.length; i += 1) {
      if (quote === '"' && rest[i] === "\\") i += 1;
      else if (rest[i] === quote) {
        if (quote === "'" && rest[i + 1] === "'") i += 1;
        else {
          i += 1;
          break;
        }
      }
    }
  }
  for (; i < rest.length; i += 1) {
    if (rest[i] === "#" && (i === 0 || rest[i - 1] === " " || rest[i - 1] === "	")) return i;
  }
  return rest.length;
}
function findScalar(body, key) {
  var _a, _b;
  const m = scalarRe(key).exec(body);
  if (!m || m.index === void 0) return null;
  const lead = (_a = m[1]) != null ? _a : "";
  const raw = (_b = m[2]) != null ? _b : "";
  const cr = raw.endsWith("\r") ? "\r" : "";
  const rest = cr ? raw.slice(0, -1) : raw;
  const value = rest.slice(0, valueEnd(rest)).replace(/[ \t]+$/, "");
  return {
    start: m.index + m[0].length - raw.length,
    value,
    lead,
    trailing: rest.slice(value.length) + cr
  };
}
function readFrontmatter(text) {
  const block = locate(text);
  if (!block) {
    return {
      present: false,
      start: 0,
      end: 0,
      body: "",
      get: () => null,
      listValues: () => []
    };
  }
  return {
    present: true,
    start: block.start,
    end: block.end,
    body: block.body,
    get: (key) => {
      var _a, _b;
      return (_b = (_a = findScalar(block.body, key)) == null ? void 0 : _a.value) != null ? _b : null;
    },
    listValues: (key) => listValues(block.body, key)
  };
}
function listValues(body, key) {
  var _a, _b;
  const block = (_b = (_a = new RegExp(
    `^${escape(key)}:[ \\t]*(?:#[^\\r\\n]*)?\\r?\\n((?:[ \\t]+-[^\\n]*\\n?)*)`,
    "m"
  ).exec(body)) == null ? void 0 : _a[1]) != null ? _b : "";
  return [...block.matchAll(/^[ \t]+-[ \t]*(.*)$/gm)].map((m) => {
    var _a2;
    return ((_a2 = m[1]) != null ? _a2 : "").trim();
  }).filter((v) => v.length > 0);
}
function setFrontmatterKey(text, key, value) {
  const block = locate(text);
  if (!block) return { text, changed: false };
  if (listValues(block.body, key).length > 0) return { text, changed: false };
  const found = findScalar(block.body, key);
  if (!found) return { text, changed: false };
  const before = found.lead === "" ? " " : "";
  const after = found.value === "" && found.trailing.startsWith("#") ? " " : "";
  const start = block.bodyStart + found.start;
  const next = text.slice(0, start) + before + value + after + text.slice(start + found.value.length);
  return { text: next, changed: next !== text };
}

// scripts/lib/vault.ts
var ARCHIVE_BUCKET = "08-archive";
var TEMPLATES = "templates";
var DEFAULT_CONFIG = {
  buckets: [
    "01-daily",
    "02-inbox",
    "03-initiatives",
    "04-areas",
    "05-entities",
    "06-knowledge",
    "07-references",
    ARCHIVE_BUCKET,
    TEMPLATES
  ],
  archiveBucket: ARCHIVE_BUCKET,
  statusBuckets: ["03-initiatives", "04-areas"],
  unlinkedBuckets: [TEMPLATES, "01-daily", "02-inbox"],
  emptyTagBuckets: [TEMPLATES, "01-daily", "02-inbox"],
  skipPrefixes: ["02-inbox/secrets/"]
};
function normalizeVaultPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}
function segmentsOf(vaultPath) {
  return normalizeVaultPath(vaultPath).replace(/\.md$/, "").split("/");
}
function bucketOf(vaultPath, config = DEFAULT_CONFIG) {
  var _a;
  const segs = normalizeVaultPath(vaultPath).split("/");
  if (segs[0] === config.archiveBucket) segs.shift();
  return (_a = segs[0]) != null ? _a : "";
}
function isArchived(vaultPath, config = DEFAULT_CONFIG) {
  return normalizeVaultPath(vaultPath).startsWith(`${config.archiveBucket}/`);
}
function archivePathFor(vaultPath, config = DEFAULT_CONFIG) {
  const path = normalizeVaultPath(vaultPath);
  return isArchived(path, config) ? path : `${config.archiveBucket}/${path}`;
}
function unarchivePathFor(vaultPath, config = DEFAULT_CONFIG) {
  const path = normalizeVaultPath(vaultPath);
  return isArchived(path, config) ? path.slice(config.archiveBucket.length + 1) : path;
}
function isInBuckets(vaultPath, config = DEFAULT_CONFIG) {
  const path = normalizeVaultPath(vaultPath);
  if (/^(\/|[A-Za-z]:)/.test(path) || path.split("/").includes("..")) return false;
  return config.buckets.some((b) => path === b || path.startsWith(`${b}/`));
}
function isSkipped(vaultPath, config = DEFAULT_CONFIG) {
  return config.skipPrefixes.some((p) => vaultPath.startsWith(p));
}
function isScanned(vaultPath, config = DEFAULT_CONFIG) {
  const path = normalizeVaultPath(vaultPath);
  return config.buckets.some((b) => path.startsWith(`${b}/`)) && !path.split("/").some((s) => s.startsWith(".")) && !isSkipped(path, config);
}
function entryOf(vaultPath, isNote) {
  var _a;
  const segments = segmentsOf(vaultPath);
  return { path: vaultPath, segments, basename: (_a = segments[segments.length - 1]) != null ? _a : "", isNote };
}
function indexEntries(paths, config = DEFAULT_CONFIG) {
  const scanned = [...paths].map(normalizeVaultPath).filter((p) => isScanned(p, config)).sort();
  const notes = scanned.filter((p) => p.endsWith(".md")).map((p) => entryOf(p, true));
  const assets = scanned.filter((p) => !p.endsWith(".md")).map((p) => entryOf(p, false));
  const entries = [...notes, ...assets];
  return { notes, assets, entries, byPath: new Map(entries.map((e) => [e.path, e])) };
}

// scripts/lib/wikilinks.ts
var FENCE_LINE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
var LIST_ITEM = /^[ \t]*([-*+]|\d{1,9}[.)])(\s|$)/;
var blank = (line) => " ".repeat(line.length);
function indentWidth(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "	") width += 4;
    else break;
  }
  return width;
}
function maskInlineCode(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line.charAt(i) !== "`") {
      out += line.charAt(i);
      i += 1;
      continue;
    }
    const openStart = i;
    while (i < line.length && line.charAt(i) === "`") i += 1;
    const runLength = i - openStart;
    let j = i;
    let closeEnd = -1;
    while (j < line.length) {
      if (line.charAt(j) !== "`") {
        j += 1;
        continue;
      }
      const runStart = j;
      while (j < line.length && line.charAt(j) === "`") j += 1;
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
function maskCode(text) {
  const lines = text.split("\n");
  const out = [];
  let fence = null;
  let inIndentedCode = false;
  let prevBlank = true;
  let inList = false;
  for (const raw of lines) {
    const eol = raw.endsWith("\r") ? "\r" : "";
    const line = eol ? raw.slice(0, -1) : raw;
    const emit = (masked) => {
      out.push(masked + eol);
    };
    const fenceMatch = FENCE_LINE.exec(line);
    let fenceRun = null;
    if (fenceMatch) {
      const [, pad = "", run = "", info = ""] = fenceMatch;
      fenceRun = { indent: indentWidth(pad), char: run.slice(0, 1), len: run.length, info };
    }
    if (fence) {
      if (fenceRun && fenceRun.char === fence.char && fenceRun.len >= fence.len && fenceRun.info.trim() === "" && fenceRun.indent <= fence.indent + 3) {
        fence = null;
      }
      emit(blank(line));
      continue;
    }
    const blankLine = line.trim() === "";
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
    if (fenceRun && (fenceRun.char === "~" || !fenceRun.info.includes("`"))) {
      fence = { char: fenceRun.char, len: fenceRun.len, indent: fenceRun.indent };
      prevBlank = false;
      emit(blank(line));
      continue;
    }
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
  return out.join("\n");
}
var WIKILINK = /(!?)\[\[([^[\]\n]*)\]\]/g;
function parseWikilinks(text) {
  var _a;
  const masked = maskCode(text);
  const out = [];
  for (const m of masked.matchAll(WIKILINK)) {
    const bang = m[1] === "!";
    const body = (_a = m[2]) != null ? _a : "";
    const start = m.index;
    const bodyStart = start + (bang ? 3 : 2);
    let head = body;
    let display = null;
    const pipe = body.indexOf("|");
    if (pipe >= 0) {
      head = body.slice(0, body.charAt(pipe - 1) === "\\" ? pipe - 1 : pipe);
      display = body.slice(pipe + 1).trim() || null;
    }
    let targetRaw = head;
    let anchor = null;
    const hash = head.indexOf("#");
    if (hash >= 0) {
      targetRaw = head.slice(0, hash);
      anchor = head.slice(hash + 1).trim() || null;
    }
    const target = targetRaw.trim();
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
      targetEnd: targetStart + target.length
    });
  }
  return out;
}

// scripts/lib/graph.ts
function resolveTarget(target, among) {
  const segs = target.replace(/^\//, "").replace(/\.md$/, "").split("/");
  return among.filter(
    (e) => segs.length <= e.segments.length && segs.every((s, i) => s === e.segments[e.segments.length - segs.length + i])
  );
}
function resolveLink(target, notes, assets) {
  const hits = resolveTarget(target, notes);
  return hits.length > 0 ? hits : resolveTarget(target, assets);
}
function shortestTarget(entry, notes, assets) {
  var _a;
  for (let n = 1; n <= entry.segments.length; n++) {
    const candidate = entry.segments.slice(-n).join("/");
    const hits = resolveLink(candidate, notes, assets);
    if (hits.length === 1 && ((_a = hits[0]) == null ? void 0 : _a.path) === entry.path) return candidate;
  }
  return entry.segments.join("/");
}

// scripts/lib/move.ts
function movedFiles(vault, from, to) {
  const src = normalizeVaultPath(from);
  const dest = normalizeVaultPath(to);
  if (vault.byPath.has(src)) return [{ from: src, to: dest }];
  const prefix = `${src}/`;
  return vault.entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ from: e.path, to: `${dest}/${e.path.slice(prefix.length)}` }));
}
function planMove(vault, from, to, frontmatter = []) {
  const src = normalizeVaultPath(from);
  const dest = normalizeVaultPath(to);
  const conflicts = refusals(vault, src, dest);
  if (conflicts.length) return refusedPlan(src, dest, conflicts);
  const files = movedFiles(vault, src, dest);
  return { from: src, to: dest, files, edits: computeEdits(vault, files), frontmatter, conflicts };
}
function refusedPlan(from, to, conflicts) {
  return { from, to, files: [], edits: [], frontmatter: [], conflicts };
}
function refusals(vault, from, to) {
  if (!from || !to) return ["a source and a destination are both required"];
  if (from === to) return [`source and destination are the same: ${from}`];
  const out = [];
  if (!isInBuckets(from, vault.config)) out.push(`source is outside the vault buckets: ${from}`);
  if (!isInBuckets(to, vault.config)) out.push(`destination is outside the vault buckets: ${to}`);
  if (movedFiles(vault, from, to).length === 0) out.push(`no such note or directory: ${from}`);
  if (to.startsWith(`${from}/`)) out.push(`destination is inside the source: ${to}`);
  if (vault.occupied(to, from)) out.push(`destination already exists: ${to}`);
  return out;
}
function computeEdits(vault, files) {
  var _a;
  const moves = new Map(files.map((f) => [f.from, f.to]));
  const future = (list) => list.map((e) => {
    const to = moves.get(e.path);
    return to ? entryOf(to, e.isNote) : e;
  });
  const futureNotes = future(vault.notes);
  const futureAssets = future(vault.assets);
  const edits = [];
  for (const note of vault.notes) {
    for (const link of parseWikilinks(vault.read(note.path))) {
      const now = resolveLink(link.target, vault.notes, vault.assets);
      if (now.length !== 1) continue;
      const current = now[0];
      const destPath = (_a = moves.get(current.path)) != null ? _a : current.path;
      const after = resolveLink(link.target, futureNotes, futureAssets);
      if (after.length === 1 && after[0].path === destPath) continue;
      edits.push({
        path: note.path,
        start: link.targetStart,
        end: link.targetEnd,
        replacement: shortestTarget(entryOf(destPath, current.isNote), futureNotes, futureAssets),
        was: link.target
      });
    }
  }
  return edits;
}
function renderMove(vault, plan) {
  var _a, _b;
  const links = [];
  for (const [path, edits] of byPath(plan.edits)) {
    const expected = vault.read(path);
    let text = expected;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    links.push({ path, expected, text });
  }
  const linked = new Map(links.map((w) => [w.path, w.text]));
  const source = new Map(plan.files.map((f) => [f.to, f.from]));
  const frontmatter = [];
  for (const [path, sets] of byPath(plan.frontmatter)) {
    const from = (_a = source.get(path)) != null ? _a : path;
    const expected = (_b = linked.get(from)) != null ? _b : vault.read(from);
    let text = expected;
    for (const set of sets) text = setFrontmatterKey(text, set.key, set.value).text;
    if (text !== expected) frontmatter.push({ path, expected, text });
  }
  return { links, frontmatter };
}
function byPath(items) {
  var _a;
  const out = /* @__PURE__ */ new Map();
  for (const item of items) out.set(item.path, [...(_a = out.get(item.path)) != null ? _a : [], item]);
  return out;
}
function describeMove(plan, opts) {
  const verb = opts.dryRun ? `would ${opts.verb}` : `${opts.verb}d`;
  const notes = new Set(plan.edits.map((e) => e.path)).size;
  const detail = [
    plan.files.length === 1 ? null : count(plan.files.length, "file"),
    plan.edits.length === 0 ? "no links needed rewriting" : `${opts.dryRun ? "would rewrite" : "rewrote"} ${count(plan.edits.length, "link")} in ${count(notes, "note")}`
  ].filter((s) => s !== null);
  return [
    `${verb} ${plan.from} -> ${plan.to} (${detail.join(", ")})`,
    ...plan.edits.map((e) => `  ${e.path}: ${e.was} -> ${e.replacement}`),
    ...plan.frontmatter.map((f) => `  ${opts.dryRun ? "would set" : "set"} ${f.key}: ${f.value} in ${f.path}`)
  ];
}
var count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// scripts/lib/archive.ts
function planArchive(vault, path, opts = {}) {
  const from = normalizeVaultPath(path);
  if (isArchived(from, vault.config)) return refusedPlan(from, from, [`already archived: ${from}`]);
  if (isBucketRoot(vault, from)) return refusedPlan(from, from, [`a bucket is not archived whole: ${from}`]);
  const to = archivePathFor(from, vault.config);
  return planMove(vault, from, to, bumps(vault, from, to, opts, true));
}
function planUnarchive(vault, path, opts = {}) {
  const from = normalizeVaultPath(path);
  if (!isArchived(from, vault.config)) return refusedPlan(from, from, [`not archived: ${from}`]);
  if (isBucketRoot(vault, unarchivePathFor(from, vault.config))) {
    return refusedPlan(from, from, [`a bucket is not unarchived whole: ${from}`]);
  }
  const to = unarchivePathFor(from, vault.config);
  return planMove(vault, from, to, bumps(vault, from, to, opts, false));
}
function bumps(vault, from, to, opts, setStatus) {
  var _a, _b;
  if (opts.frontmatter === false) return [];
  const today = isoDate((_a = opts.today) != null ? _a : /* @__PURE__ */ new Date());
  const out = [];
  for (const file of movedFiles(vault, from, to)) {
    if (!((_b = vault.byPath.get(file.from)) == null ? void 0 : _b.isNote)) continue;
    const fm = readFrontmatter(vault.read(file.from));
    if (fm.get("updated") !== null) out.push({ path: file.to, key: "updated", value: today });
    if (setStatus && fm.get("status") !== null && vault.config.statusBuckets.includes(bucketOf(file.to, vault.config))) {
      out.push({ path: file.to, key: "status", value: "done" });
    }
  }
  return out;
}
function isBucketRoot(vault, path) {
  return vault.config.buckets.includes(path);
}
function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// plugins/sehlceris-markdown-knowledge-graph/src/apply.ts
function verbFor(paths, config = DEFAULT_CONFIG) {
  const filed = paths.map(normalizeVaultPath).filter((p) => isInBuckets(p, config) && !config.buckets.includes(p));
  if (filed.length === 0 || filed.length !== paths.length) return null;
  if (filed.every((p) => isArchived(p, config))) return "unarchive";
  if (filed.every((p) => !isArchived(p, config))) return "archive";
  return null;
}
function planFor(verb, vault, path, opts = {}) {
  return verb === "archive" ? planArchive(vault, path, opts) : planUnarchive(vault, path, opts);
}
async function applyPlan(vault, plan, io) {
  const result = { ok: true, edited: [], moved: [], frontmatter: [], removedDirs: [], errors: [] };
  if (plan.conflicts.length) return { ...result, ok: false, errors: [...plan.conflicts] };
  if (await io.exists(plan.to)) return { ...result, ok: false, errors: [`destination already exists: ${plan.to}`] };
  const writes = renderMove(vault, plan);
  const sources = /* @__PURE__ */ new Set([...writes.links.map((w) => w.path), ...writes.frontmatter.map((w) => sourceOf(plan, w.path))]);
  for (const path of sources) {
    if (await io.read(path) !== vault.read(path)) {
      return { ...result, ok: false, errors: [`${path} changed while the archive was planned; nothing was written \u2014 try again`] };
    }
  }
  try {
    for (const w of writes.links) {
      await io.process(w.path, splice(w));
      result.edited.push(w.path);
    }
    for (const file of plan.files) {
      await ensureFolder(io, parentOf(file.to));
      await io.rename(file.from, file.to);
      result.moved.push(file);
    }
    for (const w of writes.frontmatter) {
      await io.process(w.path, splice(w));
      result.frontmatter.push(w.path);
    }
    await pruneEmptyFolders(vault, plan, io, result);
  } catch (err) {
    return halted(result, plan, err);
  }
  return result;
}
async function archivePaths(verb, paths, load, io, opts = {}) {
  const lines = [];
  const plans = [];
  for (const path of paths) {
    const vault = await load();
    const plan = planFor(verb, vault, path, opts);
    plans.push(plan);
    const applied = await applyPlan(vault, plan, io);
    if (!applied.ok) {
      lines.push(...plan.conflicts.length ? plan.conflicts.map((c) => `refused: ${c}`) : applied.errors);
      return { ok: false, lines, plans };
    }
    lines.push(...describeMove(plan, { verb, dryRun: false }));
  }
  return { ok: true, lines, plans };
}
function preview(verb, vault, paths, opts = {}) {
  const lines = [];
  let ok = true;
  for (const path of paths) {
    const plan = planFor(verb, vault, path, opts);
    if (plan.conflicts.length) {
      ok = false;
      lines.push(...plan.conflicts.map((c) => `refused: ${c}`));
    } else {
      lines.push(...describeMove(plan, { verb, dryRun: true }));
    }
  }
  return { ok, lines };
}
function splice(w) {
  return (text) => {
    if (text !== w.expected) throw new Error(`${w.path} changed while it was being archived`);
    return w.text;
  };
}
function sourceOf(plan, to) {
  var _a, _b;
  return (_b = (_a = plan.files.find((f) => f.to === to)) == null ? void 0 : _a.from) != null ? _b : to;
}
var parentOf = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
async function ensureFolder(io, path) {
  let prefix = "";
  for (const segment of path.split("/").filter(Boolean)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (!await io.exists(prefix)) await io.createFolder(prefix);
  }
}
async function pruneEmptyFolders(vault, plan, io, result) {
  for (const start of new Set(plan.files.map((f) => parentOf(f.from)))) {
    let dir = start;
    while (dir && !vault.config.buckets.includes(dir)) {
      if (!await io.removeEmptyFolder(dir)) break;
      result.removedDirs.push(dir);
      dir = parentOf(dir);
    }
  }
}
function halted(result, plan, err) {
  const errors = [err instanceof Error ? err.message : String(err)];
  if (result.edited.length) errors.push(`links were already rewritten in: ${result.edited.join(", ")}`);
  if (result.moved.length) {
    errors.push(`files were already moved: ${result.moved.map((m) => `${m.from} -> ${m.to}`).join(", ")}`);
  }
  if (result.frontmatter.length) errors.push(`frontmatter was already set in: ${result.frontmatter.join(", ")}`);
  errors.push(
    result.moved.length === 0 ? "nothing was moved: try again" : `${result.moved.length} of ${plan.files.length} files are already at the destination; finish the rest by hand`
  );
  return { ...result, ok: false, errors };
}

// plugins/sehlceris-markdown-knowledge-graph/src/obsidian-vault.ts
var import_obsidian = require("obsidian");

// plugins/sehlceris-markdown-knowledge-graph/src/indexed-vault.ts
function indexedVault({ files, contents, taken }) {
  const occupied = new Set([...taken].map((p) => p.toLowerCase()));
  return {
    config: DEFAULT_CONFIG,
    vocabulary: null,
    vocabularyError: "the plugin does not load the tag vocabulary",
    ...indexEntries(files),
    read(path) {
      const text = contents.get(path);
      if (text === void 0) throw new Error(`not read into the index: ${path}`);
      return text;
    },
    // The file being moved is not in its own way, which matters only for a case-only rename.
    occupied: (path, self) => path.toLowerCase() !== self.toLowerCase() && occupied.has(path.toLowerCase())
  };
}

// plugins/sehlceris-markdown-knowledge-graph/src/obsidian-vault.ts
async function loadVault(app) {
  const files = app.vault.getFiles();
  const notes = files.filter((f) => f.path.endsWith(".md") && isScanned(f.path));
  const contents = new Map(await Promise.all(notes.map(async (f) => [f.path, await app.vault.cachedRead(f)])));
  return indexedVault({
    files: files.map((f) => f.path),
    contents,
    taken: app.vault.getAllLoadedFiles().map((f) => f.path)
  });
}
function obsidianIO(app) {
  const file = (path) => {
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian.TFile)) throw new Error(`no such file: ${path}`);
    return f;
  };
  return {
    read: (path) => app.vault.read(file(path)),
    process: async (path, fn) => {
      await app.vault.process(file(path), fn);
    },
    exists: (path) => app.vault.adapter.exists(path),
    rename: async (from, to) => {
      const f = app.vault.getAbstractFileByPath(from);
      if (!f) throw new Error(`no such file: ${from}`);
      await app.vault.rename(f, to);
    },
    createFolder: async (path) => {
      await app.vault.createFolder(path);
    },
    removeEmptyFolder: async (path) => {
      const folder = app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof import_obsidian.TFolder) || folder.children.length > 0) return false;
      const listed = await app.vault.adapter.list(path);
      if (listed.files.length > 0 || listed.folders.length > 0) return false;
      await app.vault.delete(folder);
      return true;
    }
  };
}

// plugins/sehlceris-markdown-knowledge-graph/src/main.ts
var LABEL = { archive: "Archive", unarchive: "Unarchive" };
var ICON = { archive: "archive", unarchive: "archive-restore" };
var KnowledgeGraphPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    /** One run at a time: each plans against the index the previous one changed. */
    __publicField(this, "busy", false);
  }
  async onload() {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addMenuItem(menu, [file])));
    this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => this.addMenuItem(menu, files)));
    for (const verb of ["archive", "unarchive"]) {
      this.addCommand({
        id: `${verb}-current-note`,
        name: `${LABEL[verb]} current note`,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file || verbFor([file.path]) !== verb) return false;
          if (!checking) void this.run(verb, [file]);
          return true;
        }
      });
    }
  }
  addMenuItem(menu, files) {
    const verb = verbFor(files.map((f) => f.path));
    if (!verb) return;
    menu.addItem(
      (item) => item.setTitle(LABEL[verb]).setIcon(ICON[verb]).setSection("action").onClick(() => void this.run(verb, files))
    );
  }
  /** A single note goes straight through. A folder or a selection shows its plan first:
   *  that is where a surprise — forty links rewritten — would hide. */
  async run(verb, files) {
    if (this.busy) {
      new import_obsidian2.Notice("An archive is already running.");
      return;
    }
    this.busy = true;
    try {
      const paths = files.map((f) => f.path);
      if (files.length > 1 || files.some((f) => f instanceof import_obsidian2.TFolder)) {
        const plan = preview(verb, await loadVault(this.app), paths);
        if (!plan.ok) {
          report(false, plan.lines);
          return;
        }
        if (!await confirm(this.app, `${LABEL[verb]} ${files.length === 1 ? files[0].name : `${files.length} items`}?`, plan.lines, LABEL[verb])) {
          return;
        }
      }
      const working = new import_obsidian2.Notice(`${LABEL[verb]}\u2026`, 0);
      try {
        const result = await archivePaths(verb, paths, () => loadVault(this.app), obsidianIO(this.app));
        report(result.ok, result.lines);
      } finally {
        working.hide();
      }
    } catch (err) {
      report(false, [err instanceof Error ? err.message : String(err)]);
    } finally {
      this.busy = false;
    }
  }
};
function report(ok, lines) {
  (ok ? console.log : console.error)(`[knowledge-graph]
${lines.join("\n")}`);
  new import_obsidian2.Notice(lines.join("\n"), ok ? 6e3 : 0);
}
function confirm(app, title, lines, action) {
  return new Promise((resolve) => new ConfirmModal(app, title, lines, action, resolve).open());
}
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, heading, lines, action, answer) {
    super(app);
    __publicField(this, "answered", false);
    __publicField(this, "heading");
    __publicField(this, "lines");
    __publicField(this, "action");
    __publicField(this, "answer");
    this.heading = heading;
    this.lines = lines;
    this.action = action;
    this.answer = answer;
  }
  onOpen() {
    this.setTitle(this.heading);
    const pre = this.contentEl.createEl("pre", { text: this.lines.join("\n") });
    pre.style.whiteSpace = "pre-wrap";
    pre.style.maxHeight = "50vh";
    pre.style.overflow = "auto";
    new import_obsidian2.Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (b) => b.setButtonText(this.action).setCta().onClick(() => {
        this.answered = true;
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
    this.answer(this.answered);
  }
};
