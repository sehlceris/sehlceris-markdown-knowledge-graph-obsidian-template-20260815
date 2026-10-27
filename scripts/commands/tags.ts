// The vault-owned tag vocabulary. `tag list` is the authority on which tags exist; register
// a domain only for a genuinely new ongoing area, never to silence an unknown-tag error.

import { type Command, UsageError } from '../cli.ts';
import { applyTagRegistration, loadTagVocabulary, planTagRegistration } from '../lib/vocabulary.ts';

export const tagList: Command = {
  name: 'tag list',
  args: '',
  summary: 'the registered domain and shape tags',
  run(ctx) {
    const vocabulary = loadTagVocabulary(ctx.baseDir);
    const list = (tags: string[]) => (tags.length ? tags.map((t) => `  ${t}`) : ['  (none)']);
    return {
      ok: true,
      human: ['domain tags:', ...list(vocabulary.domainTags), 'shape tags:', ...list(vocabulary.shapeTags)],
      json: vocabulary,
    };
  },
};

export const tagAdd: Command = {
  name: 'tag add',
  args: '<tag>',
  summary: 'register one domain tag; refuses a spelling one edit away from an existing tag',
  flags: {
    'allow-near-duplicate': { type: 'boolean', description: 'accept a spelling one edit away from an existing tag' },
  },
  run(ctx) {
    const [tag, ...extra] = ctx.positionals;
    if (!tag || extra.length) throw new UsageError('expected one <tag>');
    const plan = planTagRegistration(ctx.baseDir, tag, {
      allowNearDuplicate: ctx.flags['allow-near-duplicate'] === true,
    });
    if (!ctx.dryRun) applyTagRegistration(ctx.baseDir, plan);

    const human =
      plan.outcome === 'existing'
        ? [`ok — domain tag already registered: ${tag}`]
        : plan.outcome === 'refused'
          ? [`refused: ${plan.reason}`]
          : ctx.dryRun
            ? [`would register domain tag: ${tag}`, 'dry run — nothing written']
            : [`registered domain tag: ${tag}`];
    return { ok: plan.outcome !== 'refused', human, json: plan };
  },
};
