// Archive and Unarchive in the file menu — right-click on desktop, long-press on a phone —
// and in the command palette for the open note. The rules are the vault's, from
// scripts/lib: the 08-archive/ mirror, `updated` bumped, `status: done` only where a status
// already exists, and every wikilink still resolving afterwards.

import { type App, type Menu, Modal, Notice, Plugin, Setting, type TAbstractFile, TFolder } from 'obsidian';

import { archivePaths, preview, type Verb, verbFor } from './apply.ts';
import { loadVault, obsidianIO, vaultConfig } from './obsidian-vault.ts';

const LABEL: Record<Verb, string> = { archive: 'Archive', unarchive: 'Unarchive' };
const ICON: Record<Verb, string> = { archive: 'archive', unarchive: 'archive-restore' };

export default class KnowledgeGraphPlugin extends Plugin {
  /** One run at a time: each plans against the index the previous one changed. */
  private busy = false;

  override async onload(): Promise<void> {
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => this.addMenuItem(menu, [file])));
    this.registerEvent(this.app.workspace.on('files-menu', (menu, files) => this.addMenuItem(menu, files)));

    for (const verb of ['archive', 'unarchive'] as const) {
      this.addCommand({
        id: `${verb}-current-note`,
        name: `${LABEL[verb]} current note`,
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          if (!file || verbFor([file.path], vaultConfig(this.app)) !== verb) return false;
          if (!checking) void this.run(verb, [file]);
          return true;
        },
      });
    }
  }

  private addMenuItem(menu: Menu, files: TAbstractFile[]): void {
    const verb = verbFor(
      files.map((f) => f.path),
      vaultConfig(this.app)
    );
    if (!verb) return;
    menu.addItem((item) =>
      item
        .setTitle(LABEL[verb])
        .setIcon(ICON[verb])
        .setSection('action')
        .onClick(() => void this.run(verb, files))
    );
  }

  /** A single note goes straight through. A folder or a selection shows its plan first:
   *  that is where a surprise — forty links rewritten — would hide. */
  private async run(verb: Verb, files: TAbstractFile[]): Promise<void> {
    if (this.busy) {
      new Notice('An archive is already running.');
      return;
    }
    this.busy = true;
    try {
      const paths = files.map((f) => f.path);
      if (files.length > 1 || files.some((f) => f instanceof TFolder)) {
        const plan = preview(verb, await loadVault(this.app), paths);
        if (!plan.ok) {
          report(false, plan.lines);
          return;
        }
        if (!(await confirm(this.app, `${LABEL[verb]} ${files.length === 1 ? files[0]!.name : `${files.length} items`}?`, plan.lines, LABEL[verb]))) {
          return;
        }
      }

      const working = new Notice(`${LABEL[verb]}…`, 0);
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
}

/** Success fades; a failure stays until dismissed, because it may say what to put back. */
function report(ok: boolean, lines: string[]): void {
  (ok ? console.log : console.error)(`[knowledge-graph]\n${lines.join('\n')}`);
  new Notice(lines.join('\n'), ok ? 6000 : 0);
}

function confirm(app: App, title: string, lines: string[], action: string): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, title, lines, action, resolve).open());
}

class ConfirmModal extends Modal {
  private answered = false;
  private readonly heading: string;
  private readonly lines: string[];
  private readonly action: string;
  private readonly answer: (ok: boolean) => void;

  constructor(app: App, heading: string, lines: string[], action: string, answer: (ok: boolean) => void) {
    super(app);
    this.heading = heading;
    this.lines = lines;
    this.action = action;
    this.answer = answer;
  }

  override onOpen(): void {
    this.setTitle(this.heading);
    const pre = this.contentEl.createEl('pre', { text: this.lines.join('\n') });
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.maxHeight = '50vh';
    pre.style.overflow = 'auto';
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.action)
          .setCta()
          .onClick(() => {
            this.answered = true;
            this.close();
          })
      );
  }

  override onClose(): void {
    this.contentEl.empty();
    this.answer(this.answered);
  }
}
