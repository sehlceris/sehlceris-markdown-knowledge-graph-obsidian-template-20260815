// Health checks, and the one repair that goes with them.

import type { Command } from '../cli.ts';
import { checkFrontmatter, checkLinks, type FrontmatterReport, type LinksReport } from '../lib/checks.ts';
import { executeUnlinkMissing } from '../lib/unlink-missing.ts';
import { loadVault } from '../lib/vault.ts';

function linkLines(report: LinksReport): string[] {
  return [
    ...report.broken.map((b) => `  ${b.from}: [[${b.target}]] points at nothing`),
    ...report.ambiguous.map((a) => `  ${a.from}: [[${a.target}]] matches ${a.matches.join(', ')}`),
  ];
}

function orphanLines(report: LinksReport): string[] {
  // Orphans are a prompt to link, never a failure.
  if (!report.orphans.length) return [];
  return ['', `${report.orphans.length} note(s) nothing links to, for review:`, ...report.orphans.map((o) => `  ${o}`)];
}

const AMBIGUOUS_HINT = 'Lengthen an ambiguous link to the shortest path that names one note — [[sales/laptop]], not [[laptop]].';

export const check: Command = {
  name: 'check',
  args: '',
  summary: 'run every health check and report everything, failing if any check failed',
  run(ctx) {
    const vault = loadVault(ctx.baseDir);
    const links = checkLinks(vault);
    const frontmatter = checkFrontmatter(vault);
    const human = [
      links.ok ? `ok — links: ${links.notes} notes, every link resolves` : 'FAIL — links:',
      ...linkLines(links),
      ...(links.ambiguous.length ? [`  ${AMBIGUOUS_HINT}`] : []),
      frontmatter.ok ? `ok — frontmatter: ${frontmatter.checked} notes clean` : 'FAIL — frontmatter:',
      ...frontmatter.problems.map((p) => `  ${p.path}: ${p.message}`),
      ...orphanLines(links),
    ];
    return { ok: links.ok && frontmatter.ok, human, json: { ok: links.ok && frontmatter.ok, vault: ctx.baseDir, links, frontmatter } };
  },
};

export const checkLinksCommand: Command = {
  name: 'check-links',
  args: '',
  summary: 'fail on links that resolve to nothing or to several notes; list orphans',
  run(ctx) {
    const report = checkLinks(loadVault(ctx.baseDir));
    const human = [
      ...linkLines(report).map((l) => l.trimStart()),
      ...(report.ambiguous.length ? ['', AMBIGUOUS_HINT] : []),
      ...orphanLines(report),
      report.ok
        ? `ok — ${report.notes} notes, every link resolves`
        : `${report.broken.length} broken and ${report.ambiguous.length} ambiguous link(s) across ${report.notes} notes`,
    ];
    return { ok: report.ok, human, json: report };
  },
};

export const checkFrontmatterCommand: Command = {
  name: 'check-frontmatter',
  args: '',
  summary: 'frontmatter shape and the closed tag vocabulary',
  run(ctx) {
    const report: FrontmatterReport = checkFrontmatter(loadVault(ctx.baseDir));
    const human = report.ok
      ? [`ok — ${report.checked} notes, frontmatter clean`]
      : [...report.problems.map((p) => `${p.path}: ${p.message}`), '', `${report.problems.length} problem(s) across ${report.checked} notes`];
    return { ok: report.ok, human, json: report };
  },
};

export const unlinkMissing: Command = {
  name: 'unlink-missing',
  args: '',
  summary: 'replace links to missing notes with their plain text; missing embeds are kept',
  run(ctx) {
    const outcome = executeUnlinkMissing(loadVault(ctx.baseDir), { dryRun: ctx.dryRun });
    return { ok: outcome.ok, human: outcome.human, json: { plan: outcome.plan, applied: outcome.applied } };
  },
};
