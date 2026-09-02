import type {
  DndpediaEntryDetail,
  DndpediaSearchRequest,
  DndpediaSearchResult,
} from '../shared/dndpedia';
import type { LanguagePreferences } from '../shared/languages';
import { errorMessage, escapeHtml } from './html';
import { getApplicationLocale, languageName, t } from './i18n';

interface DndpediaControllerActions {
  openRulesPackSettings(): void;
  notify(message: string, type: 'success' | 'error' | 'info'): void;
}

interface DndpediaControllerOptions {
  developerMode?: boolean;
}

type RefreshState = { status: 'idle' | 'loading' | 'success' | 'error'; message: string };

export class DndpediaController {
  private request: DndpediaSearchRequest = { sort: 'name-asc', page: 1, pageSize: 25 };
  private result: DndpediaSearchResult | null = null;
  private loading = false;
  private failure: string | null = null;
  private debounceTimer: number | null = null;
  private searchSequence = 0;
  private readonly detailStack: string[] = [];
  private returnFocus: HTMLElement | null = null;
  private renderedLocale = '';
  private languagePreferences: LanguagePreferences = {
    applicationLocale: 'cs', encyclopediaLocales: ['cs', 'en'],
    supportedApplicationLocales: ['cs', 'en'],
    supportedEncyclopediaLocales: ['cs', 'en', 'de', 'es', 'fr', 'it'],
    supportedLocales: ['cs', 'en', 'de', 'es', 'fr', 'it'],
    availableContentLocales: ['en'],
  };
  private detailLocaleOverride: string | null = null;
  private refreshState: RefreshState = { status: 'idle', message: '' };
  private readonly developerMode: boolean;

  constructor(
    private readonly root: HTMLElement,
    private readonly dialog: HTMLDialogElement,
    private readonly actions: DndpediaControllerActions,
    options: DndpediaControllerOptions = {},
  ) {
    this.developerMode = options.developerMode ?? false;
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('change', (event) => void this.onChange(event));
    this.root.addEventListener('click', (event) => void this.onClick(event));
    this.dialog.addEventListener('click', (event) => void this.onDialogClick(event));
    this.dialog.addEventListener('close', () => {
      this.detailStack.length = 0;
      this.detailLocaleOverride = null;
      this.returnFocus?.focus();
      this.returnFocus = null;
    });
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.dialog.close();
    });
  }

  async load(): Promise<void> {
    try {
      this.languagePreferences = await window.chronicle.getLanguagePreferences();
    } catch {
      // The catalog remains usable with safe built-in locale defaults.
    }
    this.ensureShell();
    if (this.result && !this.failure) {
      this.renderCatalogChrome();
      this.renderResultsRegion();
      return;
    }
    await this.search();
  }

  private ensureShell(): void {
    const locale = getApplicationLocale();
    if (this.root.querySelector('[data-dndpedia-shell]') && this.renderedLocale === locale) return;
    this.renderedLocale = locale;
    this.root.innerHTML = `<div class="view-scroll dndpedia-view" data-dndpedia-shell>
      <header class="view-heading dndpedia-heading">
        <div><p>${t('dndpedia.eyebrow')}</p><h1>${t('nav.dndpedia')}</h1>
          <div class="dndpedia-lead">${t('dndpedia.lead')}</div></div>
        <div class="dndpedia-heading-actions">
          <div class="dndpedia-source-summary"><strong data-dndpedia-source-count>${t('dndpedia.loadingSources')}</strong>
            <span data-dndpedia-source-names></span></div>
          <button type="button" class="dndpedia-refresh" data-dndpedia-action="refresh-sources">
            <span aria-hidden="true">↻</span> <span data-dndpedia-refresh-label>${t('dndpedia.refresh')}</span>
          </button>
          <span class="dndpedia-refresh-status" data-dndpedia-refresh-status aria-live="polite"></span>
        </div>
      </header>
      <section class="dndpedia-controls" aria-label="${t('dndpedia.controls')}">
        <label class="dndpedia-search"><span>${t('dndpedia.search')}</span><div>
          <span aria-hidden="true">⌕</span><input type="search" data-dndpedia-control="query"
            value="${escapeHtml(this.request.query ?? '')}" placeholder="${t('dndpedia.searchPlaceholder')}" autocomplete="off">
          <button type="button" data-dndpedia-action="clear-query" aria-label="${t('dndpedia.clearSearch')}" hidden>×</button>
        </div></label>
        <div class="dndpedia-filters">
          <label><span>${t('dndpedia.type')}</span><select data-dndpedia-control="definitionType"></select></label>
          <label><span>${t('dndpedia.rules')}</span><select data-dndpedia-control="ruleset"></select></label>
          <label><span>${t('dndpedia.source')}</span><select data-dndpedia-control="sourcePackId"></select></label>
          <label><span>${t('dndpedia.sort')}</span><select data-dndpedia-control="sort">
            ${sortOption('name-asc', t('dndpedia.sortNameAsc'), this.request.sort)}
            ${sortOption('name-desc', t('dndpedia.sortNameDesc'), this.request.sort)}
            ${sortOption('type', t('dndpedia.sortType'), this.request.sort)}
            ${sortOption('ruleset', t('dndpedia.sortRules'), this.request.sort)}
          </select></label>
        </div>
      </section>
      <section class="dndpedia-results" data-dndpedia-results aria-busy="false">
        <header><div aria-live="polite" data-dndpedia-result-count><strong>${t('dndpedia.loadingCatalog')}</strong></div>
          <button type="button" class="dndpedia-reset" data-dndpedia-action="reset" hidden>${t('dndpedia.resetFilters')}</button></header>
        <div data-dndpedia-results-body></div>
      </section>
    </div>`;
  }

  private async search(): Promise<void> {
    this.ensureShell();
    const sequence = ++this.searchSequence;
    const request = { ...this.request };
    this.loading = true;
    this.failure = null;
    this.renderCatalogChrome();
    this.renderResultsRegion();
    try {
      const result = await window.chronicle.searchDndpedia(request);
      if (sequence !== this.searchSequence) return;
      this.result = result;
      this.request.page = result.page;
    } catch (error) {
      if (sequence !== this.searchSequence) return;
      this.failure = errorMessage(error);
    } finally {
      if (sequence === this.searchSequence) {
        this.loading = false;
        this.renderCatalogChrome();
        this.renderResultsRegion();
      }
    }
  }

  private renderCatalogChrome(): void {
    this.ensureShell();
    const sourceSummary = this.result?.activeSourceSummary;
    setText(this.root, '[data-dndpedia-source-count]', sourceSummary
      ? sourceSummary.activePackCount === 1
        ? t('dndpedia.activeSourceOne')
        : t('dndpedia.activeSourceMany', { count: sourceSummary.activePackCount })
      : t('dndpedia.loadingSources'));
    setText(this.root, '[data-dndpedia-source-names]', sourceSummary?.displayNames.join(' · ') ?? '');
    const clear = this.root.querySelector<HTMLButtonElement>('[data-dndpedia-action="clear-query"]');
    if (clear) clear.hidden = !this.request.query;
    const reset = this.root.querySelector<HTMLButtonElement>('[data-dndpedia-action="reset"]');
    if (reset) reset.hidden = !this.hasFilters();
    setText(this.root, '[data-dndpedia-result-count]', this.result
      ? formatItemCount(this.result.totalItems) : t('dndpedia.loadingCatalog'));
    this.updateFilterOptions();
    this.updateRefreshChrome();
  }

  private renderResultsRegion(): void {
    const region = this.root.querySelector<HTMLElement>('[data-dndpedia-results]');
    const body = this.root.querySelector<HTMLElement>('[data-dndpedia-results-body]');
    if (!region || !body) return;
    region.setAttribute('aria-busy', String(this.loading));
    if (this.loading && this.result) return;
    body.innerHTML = this.renderResults(this.hasFilters());
  }

  private renderResults(hasFilters: boolean): string {
    if (this.failure) return `<div class="dndpedia-state is-error" role="alert"><span>!</span><h2>${t('dndpedia.loadFailed')}</h2>
      <p>${escapeHtml(this.failure)}</p><button type="button" data-dndpedia-action="retry">${t('dndpedia.retry')}</button></div>`;
    if (this.loading && !this.result) return `<div class="dndpedia-state"><span class="loading-spinner" aria-hidden="true"></span><p>${t('dndpedia.loadingRules')}</p></div>`;
    const result = this.result;
    if (!result) return '';
    if (result.activeSourceSummary.activePackCount === 0) return `<div class="dndpedia-state"><span>◇</span><h2>${t('dndpedia.noSource')}</h2>
      <p>${t('dndpedia.noSourceHelp')}</p><button type="button" data-dndpedia-action="open-settings">${t('dndpedia.openSettings')}</button></div>`;
    if (!result.items.length) return `<div class="dndpedia-state"><span>⌕</span><h2>${t('dndpedia.notFound')}</h2>
      <p>${t('dndpedia.notFoundHelp')}</p>${hasFilters ? `<button type="button" data-dndpedia-action="reset">${t('dndpedia.resetFilters')}</button>` : ''}</div>`;
    const start = (result.page - 1) * result.pageSize + 1;
    const end = start + result.items.length - 1;
    return `<div class="dndpedia-table-wrap"><table class="dndpedia-table">
      <thead><tr><th scope="col">${this.developerMode ? `${t('dndpedia.object')} a canonical ID` : t('dndpedia.object')}</th><th scope="col">${t('dndpedia.type')}</th><th scope="col">${t('dndpedia.shortDescription')}</th><th scope="col">${t('dndpedia.rulesAndSource')}</th></tr></thead>
      <tbody>${result.items.map((item) => `<tr>
        <td><button type="button" class="dndpedia-name" data-dndpedia-entry="${escapeHtml(item.definitionId)}">${escapeHtml(item.name)}</button>
          ${this.developerMode ? `<button type="button" class="dndpedia-id" data-developer-only data-dndpedia-entry="${escapeHtml(item.canonicalId)}">${escapeHtml(item.canonicalId)}</button>` : ''}</td>
        <td><span class="dndpedia-type">${escapeHtml(definitionTypeName(item.definitionType, item.definitionTypeDisplayName))}</span>${item.completeness === 'partial' ? `<small>${t('dndpedia.partial')}</small>` : ''}</td>
        <td class="dndpedia-description">${escapeHtml(item.shortDescription || t('dndpedia.noShortDescription'))}</td>
        <td><strong class="dndpedia-ruleset">${escapeHtml(item.rulesetDisplayName)}</strong><small>${escapeHtml(item.sourceDisplayName)}</small></td>
      </tr>`).join('')}</tbody></table></div>
      <footer class="dndpedia-pagination"><span>${t('dndpedia.itemsRange', { start, end, count: result.totalItems })}</span><div>
        <button type="button" data-dndpedia-action="previous" aria-label="${t('dndpedia.previousPage')}"${result.page <= 1 ? ' disabled' : ''}>←</button>
        <span aria-current="page">${result.page} / ${result.totalPages}</span>
        <button type="button" data-dndpedia-action="next" aria-label="${t('dndpedia.nextPage')}"${result.page >= result.totalPages ? ' disabled' : ''}>→</button>
      </div></footer>`;
  }

  private updateFilterOptions(): void {
    const result = this.result;
    updateSelect(this.root, 'definitionType', this.request.definitionType ?? '',
      filterOptions(t('dndpedia.allTypes'), (result?.facets.definitionTypes ?? []).map((item) => ({
        ...item, label: definitionTypeName(item.value, item.label),
      }))));
    const rulesetValue = this.request.rulesetId && this.request.rulesetVersion
      ? `${this.request.rulesetId}@${this.request.rulesetVersion}` : '';
    updateSelect(this.root, 'ruleset', rulesetValue,
      filterOptions(t('dndpedia.allRules'), result?.facets.rulesets ?? []));
    updateSelect(this.root, 'sourcePackId', this.request.sourcePackId ?? '',
      filterOptions(t('dndpedia.allSources'), result?.facets.sources ?? []));
  }

  private updateRefreshChrome(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-dndpedia-action="refresh-sources"]');
    const status = this.root.querySelector<HTMLElement>('[data-dndpedia-refresh-status]');
    if (!button || !status) return;
    const refreshing = this.refreshState.status === 'loading';
    button.disabled = refreshing;
    button.setAttribute('aria-busy', String(refreshing));
    button.classList.toggle('is-loading', refreshing);
    const label = button.querySelector<HTMLElement>('[data-dndpedia-refresh-label]');
    if (label) label.textContent = refreshing ? t('dndpedia.refreshing') : t('dndpedia.refresh');
    status.textContent = this.refreshState.message;
    status.className = `dndpedia-refresh-status is-${this.refreshState.status}`;
    if (this.refreshState.status === 'error') status.setAttribute('role', 'alert');
    else status.removeAttribute('role');
  }

  private hasFilters(): boolean {
    return Boolean(this.request.query?.trim() || this.request.definitionType
      || this.request.rulesetId || this.request.sourcePackId);
  }

  private onInput(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-dndpedia-control="query"]');
    if (!input) return;
    this.request.query = input.value;
    this.request.page = 1;
    const clear = this.root.querySelector<HTMLButtonElement>('[data-dndpedia-action="clear-query"]');
    if (clear) clear.hidden = !input.value;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.search();
    }, 250);
  }

  private async onChange(event: Event): Promise<void> {
    const control = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-dndpedia-control]');
    if (!control || control.dataset.dndpediaControl === 'query') return;
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
        setInputValue(this.root, 'query', '');
        await this.search();
        this.root.querySelector<HTMLInputElement>('[data-dndpedia-control="query"]')?.focus();
        break;
      case 'reset':
        this.request = { sort: 'name-asc', page: 1, pageSize: 25 };
        setInputValue(this.root, 'query', '');
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
      case 'refresh-sources': await this.refreshSources(); break;
    }
  }

  private async refreshSources(): Promise<void> {
    if (this.refreshState.status === 'loading') return;
    this.refreshState = { status: 'loading', message: t('dndpedia.refreshing') };
    this.updateRefreshChrome();
    try {
      const results = await window.chronicle.updateRulesPacks();
      const changed = results.filter((result) => result.changed).length;
      const message = changed
        ? t('dndpedia.refreshCount', { count: changed }) : t('dndpedia.sourcesCurrent');
      this.refreshState = { status: 'success', message };
      this.actions.notify(message, 'success');
      await this.search();
    } catch (error) {
      const message = errorMessage(error);
      this.refreshState = { status: 'error', message };
      this.actions.notify(message, 'error');
    } finally {
      this.updateRefreshChrome();
    }
  }

  private preferredDetailLocale(): string {
    return this.detailLocaleOverride ?? this.languagePreferences.encyclopediaLocales[0]
      ?? this.languagePreferences.applicationLocale ?? 'cs';
  }

  private async openDetail(
    id: string,
    origin: HTMLElement,
    push: boolean,
    focusTarget: 'heading' | 'locale' = 'heading',
  ): Promise<void> {
    if (!id) return;
    if (!this.dialog.open) {
      this.returnFocus = origin;
      this.detailLocaleOverride = null;
      this.dialog.showModal();
    }
    if (push && this.detailStack.at(-1) !== id) this.detailStack.push(id);
    const requestedLocale = this.preferredDetailLocale();
    this.dialog.setAttribute('aria-busy', 'true');
    this.dialog.innerHTML = detailShell(`<div class="dndpedia-detail-state">${t('dndpedia.loadingDetail')}</div>`, this.detailStack.length > 1);
    try {
      const detail = await window.chronicle.getDndpediaEntry({ id, locale: requestedLocale });
      this.dialog.innerHTML = detailShell(renderDetail(detail, this.developerMode), this.detailStack.length > 1);
      if (focusTarget === 'locale') {
        const focusLocale = detail.availableLocales.some((locale) => normalizeLocale(locale) === normalizeLocale(requestedLocale))
          ? requestedLocale : detail.locale;
        this.dialog.querySelector<HTMLButtonElement>(`[data-dndpedia-detail-locale="${cssEscape(focusLocale)}"]`)?.focus();
      } else {
        this.dialog.querySelector<HTMLElement>('[data-dndpedia-detail-heading]')?.focus();
      }
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
    const localeButton = target.closest<HTMLButtonElement>('[data-dndpedia-detail-locale]');
    if (localeButton) {
      this.detailLocaleOverride = localeButton.dataset.dndpediaDetailLocale ?? null;
      const id = this.detailStack.at(-1);
      if (id) await this.openDetail(id, localeButton, false, 'locale');
      return;
    }
    const related = target.closest<HTMLButtonElement>('[data-dndpedia-related]');
    if (related) return this.openDetail(related.dataset.dndpediaRelated ?? '', related, true);
    const actionTarget = target.closest<HTMLButtonElement>('[data-dndpedia-detail-action]');
    const action = actionTarget?.dataset.dndpediaDetailAction;
    if (action === 'close') this.dialog.close();
    if (action === 'back' && this.detailStack.length > 1) {
      this.detailStack.pop();
      await this.openDetail(this.detailStack.at(-1)!, actionTarget!, false);
    }
    if (action === 'copy' && this.developerMode) {
      const canonicalId = this.dialog.querySelector<HTMLElement>('[data-canonical-id]')?.dataset.canonicalId;
      if (!canonicalId) return;
      try {
        await navigator.clipboard.writeText(canonicalId);
        this.actions.notify(t('dndpedia.idCopied'), 'success');
      } catch {
        this.actions.notify(t('dndpedia.idCopyFailed'), 'error');
      }
    }
  }
}

function updateSelect(root: HTMLElement, key: string, value: string, options: string): void {
  const select = root.querySelector<HTMLSelectElement>(`[data-dndpedia-control="${key}"]`);
  if (!select) return;
  if (select.dataset.options !== options) {
    select.innerHTML = options;
    select.dataset.options = options;
  }
  select.value = value;
}

function filterOptions(allLabel: string, options: Array<{ value: string; label: string; count: number }>): string {
  return `<option value="">${escapeHtml(allLabel)}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)} (${option.count})</option>`).join('')}`;
}

function sortOption(value: string, label: string, selected: unknown): string {
  return `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function detailShell(content: string, canGoBack: boolean): string {
  return `<div class="dndpedia-detail-shell"><header class="dndpedia-detail-toolbar">
    <button type="button" data-dndpedia-detail-action="back" aria-label="${t('dndpedia.back')}"${canGoBack ? '' : ' disabled'}>←</button>
    <span>${t('dndpedia.detailContext')}</span>
    <button type="button" data-dndpedia-detail-action="close" aria-label="${t('dndpedia.close')}">×</button>
  </header><div class="dndpedia-detail-scroll">${content}</div></div>`;
}

function renderDetail(detail: DndpediaEntryDetail, developerMode: boolean): string {
  return `<article class="dndpedia-detail"${developerMode ? ` data-canonical-id="${escapeHtml(detail.canonicalId)}"` : ''}>
    <div class="dndpedia-detail-meta"><div class="dndpedia-detail-tags"><span class="is-type">${escapeHtml(definitionTypeName(detail.definitionType, detail.definitionTypeDisplayName))}</span>
      <span>${escapeHtml(detail.rulesetDisplayName)}</span><span>${escapeHtml(detail.sourceDisplayName)}</span></div>
      <div class="dndpedia-locale-switch" role="group" aria-label="${t('dndpedia.detailLanguage')}">
        ${detail.availableLocales.map((locale) => `<button type="button" data-dndpedia-detail-locale="${escapeHtml(locale)}"
          aria-pressed="${normalizeLocale(detail.locale) === normalizeLocale(locale)}">${normalizeLocale(locale) === 'en' ? t('dndpedia.original') : escapeHtml(languageName(locale))}</button>`).join('')}
      </div></div>
    ${detail.usedFallback ? `<div class="dndpedia-locale-fallback" data-dndpedia-locale-fallback role="status">${t('dndpedia.fallback')}</div>` : ''}
    <div class="dndpedia-detail-heading"><div><h2 tabindex="-1" data-dndpedia-detail-heading>${escapeHtml(detail.name)}</h2>
      <p>${escapeHtml(detail.shortDescription || t('dndpedia.noShortDescription'))}</p></div>
      ${developerMode ? `<button type="button" data-developer-only data-dndpedia-detail-action="copy">⧉ ${t('dndpedia.copyId')}</button>` : ''}</div>
    ${detail.content.facts.length ? `<dl class="dndpedia-facts">${detail.content.facts.map((fact) => `<div><dt>${escapeHtml(factLabel(fact.key, fact.label))}</dt><dd>${escapeHtml(factValue(fact.value))}</dd></div>`).join('')}</dl>` : ''}
    ${detail.completeness === 'partial' ? `<div class="dndpedia-incomplete">${t('dndpedia.incomplete')}</div>` : ''}
    <div class="dndpedia-detail-grid"><div>
      ${detail.content.sections.length
        ? detail.content.sections.map((section) => `<section><h3>${escapeHtml(section.title)}</h3>${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('')
        : detail.fullDescription ? `<section><h3>${t('dndpedia.fullDescription')}</h3><p>${escapeHtml(detail.fullDescription)}</p></section>` : ''}
      ${detail.relatedDefinitions.length ? `<section><h3>${t('dndpedia.related')}</h3><div class="dndpedia-related">${detail.relatedDefinitions.map((related) => `<button type="button" data-dndpedia-related="${escapeHtml(related.definitionId)}"><strong>${escapeHtml(related.name)}</strong><small>${escapeHtml(relationLabel(related.relationType, related.relationDisplayName))}</small></button>`).join('')}</div></section>` : ''}
    </div><aside class="dndpedia-source-box" aria-label="${t('dndpedia.sourceInfo')}">
      ${developerMode ? sourceRow(t('dndpedia.canonicalId'), detail.source.canonicalId, true, true) : ''}
      ${sourceRow(t('dndpedia.ruleset'), detail.source.rulesetDisplayName)}
      ${sourceRow(t('dndpedia.package'), `${detail.source.packDisplayName} · ${detail.source.packVersion}`)}${sourceRow(t('dndpedia.language'), detail.source.locale)}
      ${sourceRow(t('dndpedia.license'), detail.source.license)}${sourceRow(t('dndpedia.attribution'), detail.source.attribution)}
      ${detail.source.adaptationAttribution ? sourceRow(t('dndpedia.translationAttribution'), detail.source.adaptationAttribution) : ''}
      ${detail.source.sourceReference ? sourceRow(t('dndpedia.sourceLocation'), detail.source.sourceReference) : ''}${sourceRow(t('dndpedia.source'), detail.source.sourceUrl)}
    </aside></div>
  </article>`;
}

function sourceRow(label: string, value: string, code = false, developerOnly = false): string {
  return `<div${developerOnly ? ' data-developer-only' : ''}><dt>${escapeHtml(label)}</dt><dd${code ? ' class="is-code"' : ''}>${escapeHtml(value)}</dd></div>`;
}

function formatItemCount(value: number): string {
  if (value === 1) return t('dndpedia.itemOne');
  if (value >= 2 && value <= 4) return t('dndpedia.itemFew', { count: value });
  return t('dndpedia.itemMany', { count: value });
}

function normalizeLocale(locale: string): string { return locale.toLowerCase().split('-')[0]; }

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function setInputValue(root: HTMLElement, key: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`[data-dndpedia-control="${key}"]`);
  if (input) input.value = value;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function definitionTypeName(value: string, fallback: string): string {
  const names: Record<string, [string, string]> = {
    Species: ['Druh', 'Species'], Race: ['Rasa', 'Race'], Lineage: ['Rod', 'Lineage'], Subrace: ['Poddruh', 'Subrace'],
    Background: ['Zázemí', 'Background'], Class: ['Povolání', 'Class'], Subclass: ['Podtřída', 'Subclass'],
    Feat: ['Výkon', 'Feat'], Feature: ['Prvek', 'Feature'], Spell: ['Kouzlo', 'Spell'], Condition: ['Stav', 'Condition'],
    Language: ['Jazyk', 'Language'], Proficiency: ['Zdatnost', 'Proficiency'], Skill: ['Dovednost', 'Skill'],
    DamageType: ['Typ poškození', 'Damage type'], Deity: ['Božstvo', 'Deity'], Weapon: ['Zbraň', 'Weapon'],
    Armor: ['Zbroj', 'Armor'], Equipment: ['Výbava', 'Equipment'], Tool: ['Nástroj', 'Tool'], Vehicle: ['Dopravní prostředek', 'Vehicle'],
    CreatureDefinition: ['Tvor', 'Creature'], Rule: ['Pravidlo', 'Rule'], Action: ['Akce', 'Action'],
    Property: ['Vlastnost', 'Property'], Mastery: ['Mistrovství', 'Mastery'],
    WeaponCategory: ['Kategorie zbraní', 'Weapon category'], Custom: ['Vlastní', 'Custom'],
  };
  return names[value]?.[getApplicationLocale() === 'en' ? 1 : 0] ?? fallback;
}

function factLabel(key: string, fallback: string): string {
  const names: Record<string, [string, string]> = {
    level: ['Úroveň', 'Level'], school: ['Škola', 'School'], castingTime: ['Seslání', 'Casting time'],
    range: ['Dosah', 'Range'], components: ['Komponenty', 'Components'], duration: ['Trvání', 'Duration'],
    concentration: ['Soustředění', 'Concentration'], ritual: ['Rituál', 'Ritual'], savingThrow: ['Záchrana', 'Saving throw'],
    attackType: ['Útok', 'Attack'], damageOrHealing: ['Poškození / léčení', 'Damage / healing'],
    category: ['Kategorie', 'Category'], damage: ['Poškození', 'Damage'], damageType: ['Typ poškození', 'Damage type'],
    properties: ['Vlastnosti', 'Properties'], mastery: ['Mistrovství', 'Mastery'], cost: ['Cena', 'Cost'], weight: ['Hmotnost', 'Weight'],
    armorClass: ['AC', 'AC'], strength: ['Síla', 'Strength'], stealth: ['Nenápadnost', 'Stealth'], don: ['Oblečení', 'Don'], doff: ['Sundání', 'Doff'],
    size: ['Velikost', 'Size'], speed: ['Rychlost', 'Speed'], creatureType: ['Typ tvora', 'Creature type'], senses: ['Smysly', 'Senses'],
    defenses: ['Obrany', 'Defenses'], languages: ['Jazyky', 'Languages'], primaryAbilities: ['Primární vlastnosti', 'Primary abilities'],
    hitDie: ['Kostka životů', 'Hit die'], savingThrows: ['Záchrany', 'Saving throws'], armorTraining: ['Zbroje', 'Armor training'],
    weaponProficiencies: ['Zbraně', 'Weapon proficiencies'], spellcasting: ['Sesílání', 'Spellcasting'],
    prerequisite: ['Předpoklad', 'Prerequisite'], repeatable: ['Opakovatelné', 'Repeatable'], parentClass: ['Povolání', 'Class'], focus: ['Zaměření', 'Focus'],
  };
  return names[key]?.[getApplicationLocale() === 'en' ? 1 : 0] ?? fallback;
}

function factValue(value: string): string {
  if (value === 'Ano' || value === 'Yes') return getApplicationLocale() === 'en' ? 'Yes' : 'Ano';
  if (value === 'Ne' || value === 'No') return getApplicationLocale() === 'en' ? 'No' : 'Ne';
  if (value === 'Žádné' || value === 'None') return getApplicationLocale() === 'en' ? 'None' : 'Žádné';
  return value;
}

function relationLabel(value: string, fallback: string): string {
  const names: Record<string, [string, string]> = {
    belongsToSpecies: ['Patří k druhu', 'Belongs to species'], belongsToRace: ['Patří k rase', 'Belongs to race'],
    belongsToClass: ['Patří k povolání', 'Belongs to class'], requiresDefinition: ['Vyžaduje', 'Requires'],
    compatibleWith: ['Kompatibilní', 'Compatible with'], incompatibleWith: ['Nekompatibilní', 'Incompatible with'],
    availableToClass: ['Dostupné povolání', 'Available to class'], grantsDefinition: ['Uděluje', 'Grants'],
    hasProperty: ['Má vlastnost', 'Has property'], hasMastery: ['Má mistrovství', 'Has mastery'],
    belongsToCategory: ['Patří do kategorie', 'Belongs to category'], usesDefinition: ['Používá', 'Uses'],
  };
  return names[value]?.[getApplicationLocale() === 'en' ? 1 : 0] ?? fallback;
}
