import type { AppLogPage, AppLogQuery } from '../shared/app-log';
import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import { errorMessage, escapeHtml, humanize } from './html';
import type { ToastType } from './toast-service';

export class AppLogController {
  private campaigns: readonly RuntimeWorkspaceCampaign[] = [];
  private query: AppLogQuery = { limit: 100 };
  private page: AppLogPage = { items: [], total: 0, nextOffset: null };
  private searchTimer: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly confirm: (title: string, description: string, submitLabel: string) => Promise<boolean>,
    private readonly notify: (message: string, type?: ToastType) => void,
  ) {
    root.addEventListener('change', (event) => void this.onFilter(event));
    root.addEventListener('input', (event) => this.onSearch(event));
    root.addEventListener('click', (event) => void this.onClick(event));
  }

  async load(campaigns: readonly RuntimeWorkspaceCampaign[]): Promise<void> {
    this.campaigns = campaigns;
    this.query = { ...this.query, offset: 0 };
    await this.refresh(false);
  }

  private async refresh(append: boolean): Promise<void> {
    try {
      const page = await window.chronicle.queryAppLog(this.query);
      this.page = append ? { ...page, items: [...this.page.items, ...page.items] } : page;
      this.render();
    } catch (error) {
      this.notify(errorMessage(error), 'error');
    }
  }

  private render(): void {
    this.root.innerHTML = `<div class="view-scroll log-view">
      <header class="view-heading"><div><p>DIAGNOSTIKA</p><h1>Aplikační log</h1></div>
        <div class="button-row"><button type="button" data-log-action="export-json">Export JSON</button>
          <button type="button" data-log-action="export-txt">Export TXT</button>
          <button type="button" class="danger-button" data-log-action="clear">Vymazat log</button></div></header>
      <section class="log-filters" aria-label="Filtry logu">
        ${select('severity', 'Závažnost', ['', 'info', 'success', 'warning', 'error'], this.query.severity ?? '')}
        ${select('category', 'Kategorie', ['', 'application', 'ai', 'updater', 'rules-pack', 'data'], this.query.category ?? '')}
        <label>Kampaň<select data-log-filter="campaignId"><option value="">Všechny</option>${this.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}"${campaign.id === this.query.campaignId ? ' selected' : ''}>${escapeHtml(campaign.name)}</option>`).join('')}</select></label>
        <label class="log-search">Hledat<input type="search" data-log-search value="${escapeHtml(this.query.search ?? '')}" placeholder="Událost nebo zpráva"></label>
      </section>
      <p class="log-count">Zobrazeno ${this.page.items.length} z ${this.page.total} záznamů. Citlivé údaje se do logu neukládají.</p>
      <ol class="log-list">${this.page.items.map((item) => `<li class="log-entry is-${item.severity}">
        <header><time datetime="${item.createdAt}">${escapeHtml(new Date(item.createdAt).toLocaleString('cs-CZ'))}</time>
          <span>${escapeHtml(item.severity)}</span><span>${escapeHtml(item.category)}</span><code>${escapeHtml(item.event)}</code></header>
        <p>${escapeHtml(item.message)}</p>${item.details ? `<details><summary>Podrobnosti</summary><pre>${escapeHtml(JSON.stringify(item.details, null, 2))}</pre></details>` : ''}
      </li>`).join('') || '<li class="log-empty">Filtru neodpovídají žádné záznamy.</li>'}</ol>
      ${this.page.nextOffset !== null ? '<button type="button" class="log-load-more" data-log-action="more">Načíst další</button>' : ''}
    </div>`;
  }

  private async onFilter(event: Event): Promise<void> {
    const selectElement = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-log-filter]');
    if (!selectElement) return;
    const key = selectElement.dataset.logFilter as 'severity' | 'category' | 'campaignId';
    this.query = { ...this.query, [key]: selectElement.value || undefined, offset: 0 };
    await this.refresh(false);
  }

  private onSearch(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-log-search]');
    if (!input) return;
    window.clearTimeout(this.searchTimer);
    const value = input.value;
    this.searchTimer = window.setTimeout(() => {
      this.query = { ...this.query, search: value || undefined, offset: 0 };
      void this.refresh(false);
    }, 250);
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-log-action]');
    if (!button) return;
    const action = button.dataset.logAction;
    try {
      if (action === 'more' && this.page.nextOffset !== null) {
        this.query = { ...this.query, offset: this.page.nextOffset };
        await this.refresh(true);
      } else if (action === 'clear') {
        if (!await this.confirm('Vymazat aplikační log?', 'Tato akce odstraní všechny diagnostické záznamy. Data kampaní zůstanou beze změny.', 'Vymazat')) return;
        const count = await window.chronicle.clearAppLog();
        this.notify(`Odstraněno ${count} záznamů logu.`, 'success');
        this.query = { ...this.query, offset: 0 };
        await this.refresh(false);
      } else if (action === 'export-json' || action === 'export-txt') {
        const file = await window.chronicle.exportAppLog({ format: action === 'export-json' ? 'json' : 'txt', query: this.query });
        if (file) this.notify('Sanitizovaný log byl exportován.', 'success');
      }
    } catch (error) { this.notify(errorMessage(error), 'error'); }
  }
}

function select(key: string, label: string, values: readonly string[], selected: string): string {
  return `<label>${label}<select data-log-filter="${key}">${values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value ? humanize(value) : 'Všechny'}</option>`).join('')}</select></label>`;
}
