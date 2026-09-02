import type { BootstrapInfo, UpdateState } from '../shared/contracts';
import type { AiSecretStatus, CampaignAiSettings } from '../shared/ai';
import { aiReasoningEffortsForModel, normalizeAiReasoningEffort } from '../shared/ai';
import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import type { RulesPackStatus } from '../shared/rules-packs';
import type { LanguagePreferences } from '../shared/languages';
import { errorMessage, escapeHtml, humanize } from './html';
import { languageName, setApplicationLocale, t } from './i18n';
import type { ToastType } from './toast-service';

export class AiSettingsController {
  private campaigns: readonly RuntimeWorkspaceCampaign[] = [];
  private campaignId: string | null = null;
  private info: BootstrapInfo | null = null;
  private update: UpdateState | null = null;
  private message = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly notify: (message: string, type?: ToastType) => void = () => undefined,
    private readonly onApplicationLocaleChanged: () => void = () => undefined,
  ) {
    root.addEventListener('change', (event) => void this.onChange(event));
    root.addEventListener('click', (event) => void this.onClick(event));
    root.addEventListener('submit', (event) => void this.onSubmit(event));
  }

  async load(
    campaigns: readonly RuntimeWorkspaceCampaign[],
    preferredCampaignId: string | null,
    info: BootstrapInfo,
    update: UpdateState,
  ): Promise<void> {
    this.campaigns = campaigns;
    this.info = info;
    this.update = update;
    this.campaignId = campaigns.some((item) => item.id === this.campaignId)
      ? this.campaignId
      : campaigns.find((item) => item.id === preferredCampaignId)?.id ?? campaigns[0]?.id ?? null;
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [secret, settings, rulesPacks, languages] = await Promise.all([
        window.chronicle.getAiSecretStatus(),
        this.campaignId ? window.chronicle.getAiSettings(this.campaignId) : Promise.resolve(null),
        window.chronicle.listRulesPacks(),
        window.chronicle.getLanguagePreferences(),
      ]);
      this.render(secret, settings, rulesPacks, languages);
    } catch (error) {
      this.root.innerHTML = `<div class="view-scroll"><p class="dialog-error">${escapeHtml(errorMessage(error))}</p></div>`;
    }
  }

  private render(
    secret: AiSecretStatus,
    settings: CampaignAiSettings | null,
    rulesPacks: readonly RulesPackStatus[],
    languages: LanguagePreferences,
  ): void {
    const info = this.info!;
    const update = this.update!;
    this.root.innerHTML = `<div class="view-scroll settings-view">
      <header class="view-heading"><div><p>${t('settings.eyebrow')}</p><h1>${t('settings.title')}</h1></div></header>
      ${languageSettingsForm(languages)}
      <section class="settings-section"><header><div><p>${t('settings.aiGlobal')}</p><h2>${t('settings.openAiAccess')}</h2></div>
        <span class="status-badge ${secret.configured ? 'is-ok' : ''}">${secret.configured ? t('settings.configured') : t('settings.missingKey')}</span></header>
        <form data-api-key-form class="settings-form"><label>${t('settings.apiKey')}
          <input type="password" name="apiKey" autocomplete="off" placeholder="sk-…" minlength="20" maxlength="512"></label>
          <p>${secret.configured
            ? t('settings.keySaved', { persistence: escapeHtml(secret.persistence), suffix: escapeHtml(secret.maskedSuffix ?? '') })
            : t('settings.keyHelp')}</p>
          <div class="button-row"><button type="submit" class="primary-button">${t('settings.saveKey')}</button>
            ${secret.configured ? `<button type="button" data-settings-action="remove-key">${t('settings.removeKey')}</button>` : ''}
            <button type="button" data-settings-action="test-connection">${t('settings.testConnection')}</button></div>
        </form>
      </section>
      <section class="settings-section"><header><div><p>${t('settings.aiCampaign')}</p><h2>${t('settings.modelBehavior')}</h2></div>
        ${this.campaigns.length ? `<label class="campaign-picker">${t('settings.campaign')}<select data-settings-campaign>${this.campaigns.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === this.campaignId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>` : ''}</header>
        ${settings ? campaignForm(settings) : `<div class="settings-empty"><p>${t('settings.createCampaignHelp')}</p>
          <button type="button" class="primary-button" data-action="create-campaign">${t('settings.createCampaign')}</button></div>`}
      </section>
      <section class="settings-section"><header><div><p>${t('settings.updates')}</p><h2>${t('settings.appVersion')}</h2></div></header>${settingsUpdateCard(update)}</section>
      <section class="settings-section"><header><div><p>${t('settings.rulesOffline')}</p><h2>${t('settings.rulesPacks')}</h2></div>
        <button type="button" data-settings-action="update-packs">${t('settings.checkAll')}</button></header>
        <p class="settings-description">${t('settings.rulesPackHelp')}</p>
        <div class="rules-pack-list">${rulesPacks.map((pack) => `<article><div><strong>${escapeHtml(pack.displayName)}</strong>
          <span>${escapeHtml(pack.packId)} · ${escapeHtml(pack.version)} · ${pack.active ? t('settings.active') : t('settings.inactive')}</span>
          <small>${escapeHtml(pack.license)} · ${escapeHtml(pack.attribution)}</small></div>
          <button type="button" data-settings-action="update-pack" data-pack-id="${escapeHtml(pack.packId)}">${t('settings.check')}</button></article>`).join('')}</div>
      </section>
      <section class="settings-section diagnostics"><header><div><p>${t('settings.storage')}</p><h2>${t('settings.localData')}</h2></div></header>
        <dl><div><dt>${t('settings.appVersion')}</dt><dd>${escapeHtml(info.appVersion)}</dd></div>
          <div><dt>${t('settings.databaseSchema')}</dt><dd>v${info.storage.schemaVersion}</dd></div>
          <div><dt>${t('settings.database')}</dt><dd title="${escapeHtml(info.storage.databasePath)}">${escapeHtml(info.storage.databasePath)}</dd></div></dl>
      </section>
      ${this.message ? `<p class="settings-toast" role="status">${escapeHtml(this.message)}</p>` : ''}
    </div>`;
  }

  private async onChange(event: Event): Promise<void> {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-settings-campaign]');
    if (!select) return;
    this.campaignId = select.value || null;
    this.message = '';
    await this.refresh();
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-settings-action]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.settingsAction === 'remove-key') {
        await window.chronicle.removeAiApiKey();
        this.message = t('settings.keyRemoved');
      } else if (button.dataset.settingsAction === 'test-connection') {
        const result = await window.chronicle.testAiConnection(this.campaignId ?? undefined);
        this.message = result.message;
      } else if (button.dataset.settingsAction === 'test-runtime') {
        if (!this.campaignId) throw new Error(t('settings.chooseCampaign'));
        const result = await window.chronicle.testAiRuntime(this.campaignId);
        this.message = result.message;
      } else if (button.dataset.settingsAction === 'update-packs' || button.dataset.settingsAction === 'update-pack') {
        const results = await window.chronicle.updateRulesPacks(button.dataset.packId || undefined);
        const changed = results.filter((result) => result.changed).length;
        this.message = changed ? t('settings.updateCount', { count: changed }) : t('settings.packsCurrent');
      }
      this.notify(this.message, 'success');
    } catch (error) {
      this.message = errorMessage(error);
      this.notify(this.message, 'error');
    }
    await this.refresh();
  }

  private async onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const data = new FormData(form);
      if (form.matches('[data-language-settings-form]')) {
        const encyclopediaLocales = data.getAll('encyclopediaLocales').map(String);
        if (!encyclopediaLocales.length) throw new Error(t('settings.chooseLanguage'));
        const saved = await window.chronicle.saveLanguagePreferences({
          applicationLocale: String(data.get('applicationLocale') ?? 'cs'),
          encyclopediaLocales,
        });
        setApplicationLocale(saved.applicationLocale);
        this.message = t('settings.languagesSaved');
        this.onApplicationLocaleChanged();
      } else if (form.matches('[data-api-key-form]')) {
        await window.chronicle.setAiApiKey(String(data.get('apiKey') ?? ''));
        this.message = t('settings.keyStored');
      } else if (form.matches('[data-campaign-ai-form]') && this.campaignId) {
        await window.chronicle.saveAiSettings({
          campaignId: this.campaignId,
          settings: {
            modelId: String(data.get('modelId') ?? ''),
            reasoningEffort: String(data.get('reasoningEffort')) as CampaignAiSettings['reasoningEffort'],
            verbosity: String(data.get('verbosity')) as CampaignAiSettings['verbosity'],
            approvalPolicy: String(data.get('approvalPolicy')) as CampaignAiSettings['approvalPolicy'],
            maxOutputTokens: Number(data.get('maxOutputTokens')),
            campaignInstructions: String(data.get('campaignInstructions') ?? ''),
          },
        });
        this.message = t('settings.campaignSaved');
      }
      this.notify(this.message, 'success');
    } catch (error) {
      this.message = errorMessage(error);
      this.notify(this.message, 'error');
    }
    await this.refresh();
  }
}

function languageSettingsForm(preferences: LanguagePreferences): string {
  const applicationLocales = preferences.supportedApplicationLocales;
  const available = new Set(preferences.availableContentLocales);
  return `<section class="settings-section language-settings"><header><div><p>${t('settings.languageEyebrow')}</p><h2>${t('settings.languageTitle')}</h2></div></header>
    <form class="settings-form" data-language-settings-form>
      <label>${t('settings.applicationLanguage')}<select name="applicationLocale">
        ${applicationLocales.map((locale) => `<option value="${locale}"${locale === preferences.applicationLocale ? ' selected' : ''}>${escapeHtml(languageName(locale))}</option>`).join('')}
      </select></label>
      <p>${t('settings.applicationLanguageHelp')}</p>
      <fieldset class="encyclopedia-language-fieldset"><legend>${t('settings.encyclopediaLanguages')}</legend>
        <p>${t('settings.encyclopediaLanguagesHelp')}</p>
        <div class="encyclopedia-language-list" data-encyclopedia-language-list>
          ${preferences.supportedEncyclopediaLocales.map((locale) => {
            const selected = preferences.encyclopediaLocales.includes(locale);
            const hasContent = available.has(locale);
            const status = locale === 'en' ? t('settings.originalAvailable')
              : hasContent ? (selected ? t('settings.languageEnabled') : t('settings.addLanguage'))
                : t('settings.contentUnavailable');
            return `<label class="encyclopedia-language-option${selected ? ' is-selected' : ''}">
              <input type="checkbox" name="encyclopediaLocales" value="${escapeHtml(locale)}"${selected ? ' checked' : ''}>
              <span><strong>${escapeHtml(languageName(locale))}</strong><small>${escapeHtml(status)}</small></span>
            </label>`;
          }).join('')}
        </div>
      </fieldset>
      <div class="button-row"><button type="submit" class="primary-button">${t('settings.saveLanguages')}</button></div>
    </form>
  </section>`;
}

function campaignForm(settings: CampaignAiSettings): string {
  const reasoningEffort = normalizeAiReasoningEffort(settings.modelId, settings.reasoningEffort);
  return `<form data-campaign-ai-form class="settings-form"><label>${t('settings.model')}
    <input name="modelId" value="${escapeHtml(settings.modelId)}" maxlength="120" required></label>
    <div class="settings-grid">
      ${selectField('reasoningEffort', t('settings.reasoning'), [...aiReasoningEffortsForModel(settings.modelId)], reasoningEffort)}
      ${selectField('verbosity', t('settings.detail'), ['low', 'medium', 'high'], settings.verbosity)}
      ${selectField('approvalPolicy', t('settings.approvals'), ['review', 'automatic', 'manual'], settings.approvalPolicy)}
      <label>${t('settings.maxTokens')}<input type="number" name="maxOutputTokens" min="256" max="32768" value="${settings.maxOutputTokens}" required></label>
    </div><label>${t('settings.instructions')}<textarea name="campaignInstructions" rows="6" maxlength="12000">${escapeHtml(settings.campaignInstructions)}</textarea></label>
    <div class="button-row"><button type="submit" class="primary-button">${t('settings.saveCampaign')}</button>
      <button type="button" data-settings-action="test-runtime">${t('settings.testRuntime')}</button></div></form>`;
}

function selectField(name: string, label: string, values: string[], selected: string): string {
  return `<label>${escapeHtml(label)}<select name="${name}">${values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(humanize(value))}</option>`).join('')}</select></label>`;
}

function settingsUpdateCard(update: UpdateState): string {
  const progress = Math.min(100, Math.max(0, update.percent ?? 0));
  const busy = ['checking', 'available', 'downloading', 'not-configured'].includes(update.status);
  const heading = ({
    'not-configured': t('settings.updateNotConfigured'), idle: t('settings.updateIdle'),
    checking: t('settings.updateChecking'),
    available: t('settings.updateAvailable', { version: update.availableVersion ?? '' }),
    downloading: t('settings.updateDownloading'), downloaded: t('settings.updateDownloaded'),
    'up-to-date': t('settings.updateCurrent'), error: t('settings.updateError'),
  } satisfies Record<UpdateState['status'], string>)[update.status];
  return `<section class="update-panel" data-update-card>
    <div class="card-icon update-icon">↻</div><div class="grow">
      <p>${t('settings.updates')}</p><h2 data-update-heading>${escapeHtml(heading)}</h2>
      <span data-update-message>${escapeHtml(update.message)}</span>
      <div class="progress-track" data-progress-track ${update.status === 'downloading' || update.status === 'downloaded' ? '' : 'hidden'}>
        <div class="progress-bar" data-progress-bar style="width:${progress}%"></div></div>
    </div><button type="button" class="secondary-button" data-update-action ${busy ? 'disabled' : ''}>${update.status === 'downloaded' ? t('settings.install') : t('settings.checkUpdates')}</button>
  </section>`;
}
