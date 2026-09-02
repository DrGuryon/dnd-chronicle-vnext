import type {
  DndpediaEntryDetail,
  DndpediaSearchRequest,
  DndpediaSearchResult,
} from '../shared/dndpedia';
import { errorMessage, escapeHtml } from './html';

interface DndpediaControllerActions {
  openRulesPackSettings(): void;
  notify(message: string, type: 'success' | 'error' | 'info'): void;
}

export class DndpediaController {
  private request: DndpediaSearchRequest = { sort: 'name-asc', page: 1, pageSize: 25 };
  private result: DndpediaSearchResult | null = null;
  private loading = false;
  private failure: string | null = null;
  private debounceTimer: number | null = null;
  private readonly detailStack: string[] = [];
  private returnFocus: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly dialog: HTMLDialogElement,
    private readonly actions: DndpediaControllerActions,
  ) {
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('change', (event) => void this.onChange(event));
    this.root.addEventListener('click', (event) => void this.onClick(event));
    this.dialog.addEventListener('click', (event) => void this.onDialogClick(event));
    this.dialog.addEventListener('close', () => {
      this.detailStack.length = 0;
      this.returnFocus?.focus();
      this.returnFocus = null;
    });
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.dialog.close();
    });
  }

  async load(): Promise<void> {
    if (this.result && !this.failure) {
      this.render();
      return;
    }
    await this.search();
  }

  private async search(): Promise<void> {
    this.loading = true;
    this.failure = null;
    this.render();
    try {
      this.result = await window.chronicle.searchDndpedia(this.request);
      this.request.page = this.result.page;
    } catch (error) {
      this.failure = errorMessage(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const activeElement = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
    const focusKey = activeElement?.dataset.dndpediaControl;
    const selection = activeElement instanceof HTMLInputElement
      ? [activeElement.selectionStart, activeElement.selectionEnd] as const : null;
    const result = this.result;
    const hasFilters = Boolean(this.request.query?.trim() || this.request.definitionType
      || this.request.rulesetId || this.request.sourcePackId);
    const sourceSummary = result?.activeSourceSummary;
    this.root.innerHTML = `<div class="view-scroll dndpedia-view">
      <header class="view-heading dndpedia-heading">
        <div><p>PRAVIDLOVÝ KATALOG</p><h1>D&amp;Dpedie</h1>
          <div class="dndpedia-lead">Globální encyklopedie nainstalovaných pravidlových zdrojů, dostupná napříč aplikací.</div></div>
        <div class="dndpedia-source-summary"><strong>${sourceSummary ? `${sourceSummary.activePackCount} ${sourceSummary.activePackCount === 1 ? 'aktivní zdroj' : 'aktivní zdroje'}` : 'Načítám zdroje'}</strong>
          <span>${escapeHtml(sourceSummary?.displayNames.join(' · ') ?? '')}</span></div>
      </header>
      <section class="dndpedia-controls" aria-label="Vyhledávání a filtry">
        <label class="dndpedia-search"><span>Hledat</span><div>
          <span aria-hidden="true">⌕</span><input type="search" data-dndpedia-control="query"
            value="${escapeHtml(this.request.query ?? '')}" placeholder="Název, ID, popis nebo alias…" autocomplete="off">
          <button type="button" data-dndpedia-action="clear-query" aria-label="Vymazat hledání"${this.request.query ? '' : ' hidden'}>×</button>
        </div></label>
        <div class="dndpedia-filters">
          ${filterSelect('definitionType', 'Typ', this.request.definitionType ?? '', 'Všechny typy', result?.facets.definitionTypes ?? [])}
          ${rulesetSelect(this.request, result)}
          ${filterSelect('sourcePackId', 'Zdroj', this.request.sourcePackId ?? '', 'Všechny zdroje', result?.facets.sources ?? [])}
          <label><span>Řazení</span><select data-dndpedia-control="sort">
            ${sortOption('name-asc', 'Název A–Z', this.request.sort)}${sortOption('name-desc', 'Název Z–A', this.request.sort)}
            ${sortOption('type', 'Typ', this.request.sort)}${sortOption('ruleset', 'Verze pravidel', this.request.sort)}
          </select></label>
        </div>
      </section>
      <section class="dndpedia-results" aria-busy="${this.loading}">
        <header><div aria-live="polite">${result ? `<strong>${formatItemCount(result.totalItems)}</strong>` : '<strong>Načítám katalog…</strong>'}</div>
          <button type="button" class="dndpedia-reset" data-dndpedia-action="reset"${hasFilters ? '' : ' hidden'}>Zrušit filtry</button></header>
        ${this.renderResults(hasFilters)}
      </section>
    </div>`;
    if (focusKey) {
      const replacement = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-dndpedia-control="${focusKey}"]`);
      replacement?.focus();
      if (replacement instanceof HTMLInputElement && selection) {
        replacement.setSelectionRange(selection[0], selection[1]);
      }
    }
  }

  private renderResults(hasFilters: boolean): string {
    if (this.failure) return `<div class="dndpedia-state is-error" role="alert"><span>!</span><h2>D&amp;Dpedii se nepodařilo načíst</h2>
      <p>${escapeHtml(this.failure)}</p><button type="button" data-dndpedia-action="retry">Zkusit znovu</button></div>`;
    if (this.loading && !this.result) return '<div class="dndpedia-state"><span class="loading-spinner" aria-hidden="true"></span><p>Načítám pravidlový katalog…</p></div>';
    const result = this.result;
    if (!result) return '';
    if (result.activeSourceSummary.activePackCount === 0) return `<div class="dndpedia-state"><span>◇</span><h2>Žádný aktivní zdroj</h2>
      <p>Nainstalujte nebo aktivujte Rules Pack v Nastavení.</p><button type="button" data-dndpedia-action="open-settings">Otevřít Nastavení</button></div>`;
    if (!result.items.length) return `<div class="dndpedia-state"><span>⌕</span><h2>Nic jsme nenašli</h2>
      <p>Zkuste změnit hledaný výraz nebo filtry.</p>${hasFilters ? '<button type="button" data-dndpedia-action="reset">Zrušit filtry</button>' : ''}</div>`;
    const start = (result.page - 1) * result.pageSize + 1;
    const end = start + result.items.length - 1;
    return `<div class="dndpedia-table-wrap"><table class="dndpedia-table">
      <thead><tr><th scope="col">Objekt a canonical ID</th><th scope="col">Typ</th><th scope="col">Krátký popis</th><th scope="col">Pravidla a zdroj</th></tr></thead>
      <tbody>${result.items.map((item) => `<tr>
        <td><button type="button" class="dndpedia-name" data-dndpedia-entry="${escapeHtml(item.definitionId)}">${escapeHtml(item.name)}</button>
          <button type="button" class="dndpedia-id" data-dndpedia-entry="${escapeHtml(item.canonicalId)}">${escapeHtml(item.canonicalId)}</button></td>
        <td><span class="dndpedia-type">${escapeHtml(item.definitionTypeDisplayName)}</span>${item.completeness === 'partial' ? '<small>Částečný záznam</small>' : ''}</td>
        <td class="dndpedia-description">${escapeHtml(item.shortDescription || 'Tento zdroj neposkytuje krátký popis.')}</td>
        <td><strong class="dndpedia-ruleset">${escapeHtml(item.rulesetDisplayName)}</strong><small>${escapeHtml(item.sourceDisplayName)}</small></td>
      </tr>`).join('')}</tbody></table></div>
      <footer class="dndpedia-pagination"><span>${start}–${end} z ${result.totalItems} položek</span><div>
        <button type="button" data-dndpedia-action="previous" aria-label="Předchozí stránka"${result.page <= 1 ? ' disabled' : ''}>←</button>
        <span aria-current="page">${result.page} / ${result.totalPages}</span>
        <button type="button" data-dndpedia-action="next" aria-label="Další stránka"${result.page >= result.totalPages ? ' disabled' : ''}>→</button>
      </div></footer>`;
  }

  private onInput(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-dndpedia-control="query"]');
    if (!input) return;
    this.request.query = input.value;
    this.request.page = 1;
    this.root.querySelector<HTMLButtonElement>('[data-dndpedia-action="clear-query"]')!.hidden = !input.value;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.search();
    }, 250);
  }

  private async onChange(event: Event): Promise<void> {
    const control = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-dndpedia-control]');
    if (!control) return;
    const key = control.dataset.dndpediaControl;
    if (key === 'definitionType') this.request.definitionType = control.value || null;
    if (key === 'sourcePackId') this.request.sourcePackId = control.value || null;
    if (key === 'sort') this.request.sort = control.value as DndpediaSearchRequest['sort'];
    if (key === 'ruleset') {
      const [rulesetId, rulesetVersion] = control.value.split('@');
      this.request.rulesetId = rulesetId || null;
      this.request.rulesetVersion = rulesetVersion || null;
    }
    this.request.page = 1;
    await this.search();
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement;
    const entry = target.closest<HTMLButtonElement>('[data-dndpedia-entry]');
    if (entry) return this.openDetail(entry.dataset.dndpediaEntry ?? '', entry, true);
    const button = target.closest<HTMLButtonElement>('[data-dndpedia-action]');
    if (!button) return;
    switch (button.dataset.dndpediaAction) {
      case 'clear-query':
        this.request.query = '';
        this.request.page = 1;
        await this.search();
        this.root.querySelector<HTMLInputElement>('[data-dndpedia-control="query"]')?.focus();
        break;
      case 'reset':
        this.request = { sort: 'name-asc', page: 1, pageSize: 25 };
        await this.search();
        this.root.querySelector<HTMLInputElement>('[data-dndpedia-control="query"]')?.focus();
        break;
      case 'previous':
        this.request.page = Math.max(1, (this.request.page ?? 1) - 1);
        await this.search();
        break;
      case 'next':
        this.request.page = (this.request.page ?? 1) + 1;
        await this.search();
        break;
      case 'retry': await this.search(); break;
      case 'open-settings': this.actions.openRulesPackSettings(); break;
    }
  }

  private async openDetail(id: string, origin: HTMLElement, push: boolean): Promise<void> {
    if (!id) return;
    if (!this.dialog.open) {
      this.returnFocus = origin;
      this.dialog.showModal();
    }
    if (push && this.detailStack.at(-1) !== id) this.detailStack.push(id);
    this.dialog.setAttribute('aria-busy', 'true');
    this.dialog.innerHTML = detailShell('<div class="dndpedia-detail-state">Načítám detail…</div>', this.detailStack.length > 1);
    try {
      const detail = await window.chronicle.getDndpediaEntry({ id });
      this.dialog.innerHTML = detailShell(renderDetail(detail), this.detailStack.length > 1);
      this.dialog.querySelector<HTMLElement>('[data-dndpedia-detail-heading]')?.focus();
    } catch (error) {
      this.dialog.innerHTML = detailShell(`<div class="dndpedia-detail-state is-error" role="alert">${escapeHtml(errorMessage(error))}</div>`, this.detailStack.length > 1);
    } finally {
      this.dialog.removeAttribute('aria-busy');
    }
  }

  private async onDialogClick(event: MouseEvent): Promise<void> {
    if (event.target === this.dialog) {
      this.dialog.close();
      return;
    }
    const target = event.target as HTMLElement;
    const related = target.closest<HTMLButtonElement>('[data-dndpedia-related]');
    if (related) return this.openDetail(related.dataset.dndpediaRelated ?? '', related, true);
    const action = target.closest<HTMLButtonElement>('[data-dndpedia-detail-action]')?.dataset.dndpediaDetailAction;
    if (action === 'close') this.dialog.close();
    if (action === 'back' && this.detailStack.length > 1) {
      this.detailStack.pop();
      await this.openDetail(this.detailStack.at(-1)!, target, false);
    }
    if (action === 'copy') {
      const canonicalId = target.closest<HTMLElement>('[data-canonical-id]')?.dataset.canonicalId
        ?? this.dialog.querySelector<HTMLElement>('[data-canonical-id]')?.dataset.canonicalId;
      if (!canonicalId) return;
      try {
        await navigator.clipboard.writeText(canonicalId);
        this.actions.notify('Canonical ID bylo zkopírováno.', 'success');
      } catch {
        this.actions.notify('ID se nepodařilo zkopírovat.', 'error');
      }
    }
  }
}

function filterSelect(
  key: string,
  label: string,
  value: string,
  allLabel: string,
  options: Array<{ value: string; label: string; count: number }>,
): string {
  return `<label><span>${escapeHtml(label)}</span><select data-dndpedia-control="${escapeHtml(key)}">
    <option value="">${escapeHtml(allLabel)}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)} (${option.count})</option>`).join('')}
  </select></label>`;
}

function rulesetSelect(request: DndpediaSearchRequest, result: DndpediaSearchResult | null): string {
  const value = request.rulesetId && request.rulesetVersion ? `${request.rulesetId}@${request.rulesetVersion}` : '';
  return filterSelect('ruleset', 'Pravidla', value, 'Všechna pravidla', result?.facets.rulesets ?? []);
}

function sortOption(value: string, label: string, selected: unknown): string {
  return `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function detailShell(content: string, canGoBack: boolean): string {
  return `<div class="dndpedia-detail-shell"><header class="dndpedia-detail-toolbar">
    <button type="button" data-dndpedia-detail-action="back" aria-label="Zpět"${canGoBack ? '' : ' disabled'}>←</button>
    <span>D&amp;Dpedie · detail pravidla</span>
    <button type="button" data-dndpedia-detail-action="close" aria-label="Zavřít detail">×</button>
  </header><div class="dndpedia-detail-scroll">${content}</div></div>`;
}

function renderDetail(detail: DndpediaEntryDetail): string {
  return `<article class="dndpedia-detail" data-canonical-id="${escapeHtml(detail.canonicalId)}">
    <div class="dndpedia-detail-tags"><span class="is-type">${escapeHtml(detail.definitionTypeDisplayName)}</span>
      <span>${escapeHtml(detail.rulesetDisplayName)}</span><span>${escapeHtml(detail.sourceDisplayName)}</span></div>
    <div class="dndpedia-detail-heading"><div><h2 tabindex="-1" data-dndpedia-detail-heading>${escapeHtml(detail.name)}</h2>
      <p>${escapeHtml(detail.shortDescription || 'Tento zdroj neposkytuje krátký popis.')}</p></div>
      <button type="button" data-dndpedia-detail-action="copy">⧉ Zkopírovat ID</button></div>
    ${detail.content.facts.length ? `<dl class="dndpedia-facts">${detail.content.facts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join('')}</dl>` : ''}
    ${detail.completeness === 'partial' ? '<div class="dndpedia-incomplete">Tento zdroj poskytuje pouze základní nebo starší záznam. Chybějící údaje nejsou domýšleny.</div>' : ''}
    <div class="dndpedia-detail-grid"><div>
      ${detail.fullDescription ? `<section><h3>Úplný popis</h3><p>${escapeHtml(detail.fullDescription)}</p></section>` : ''}
      ${detail.content.sections.map((section) => `<section><h3>${escapeHtml(section.title)}</h3>${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('')}
      ${detail.relatedDefinitions.length ? `<section><h3>Související definice</h3><div class="dndpedia-related">${detail.relatedDefinitions.map((related) => `<button type="button" data-dndpedia-related="${escapeHtml(related.definitionId)}"><strong>${escapeHtml(related.name)}</strong><small>${escapeHtml(related.relationDisplayName)}</small></button>`).join('')}</div></section>` : ''}
    </div><aside class="dndpedia-source-box" aria-label="Zdrojové informace">
      ${sourceRow('Canonical ID', detail.source.canonicalId, true)}${sourceRow('Ruleset', detail.source.rulesetDisplayName)}
      ${sourceRow('Balíček', `${detail.source.packDisplayName} · ${detail.source.packVersion}`)}${sourceRow('Jazyk', detail.source.locale)}
      ${sourceRow('Licence', detail.source.license)}${sourceRow('Atribuce', detail.source.attribution)}
      ${detail.source.sourceReference ? sourceRow('Místo ve zdroji', detail.source.sourceReference) : ''}${sourceRow('Zdroj', detail.source.sourceUrl)}
    </aside></div>
  </article>`;
}

function sourceRow(label: string, value: string, code = false): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd${code ? ' class="is-code"' : ''}>${escapeHtml(value)}</dd></div>`;
}

function formatItemCount(value: number): string {
  if (value === 1) return '1 položka';
  if (value >= 2 && value <= 4) return `${value} položky`;
  return `${value} položek`;
}
