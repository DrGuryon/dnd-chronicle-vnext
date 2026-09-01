import type { BootstrapInfo, UpdateState } from '../shared/contracts';
import type { AiSecretStatus, CampaignAiSettings } from '../shared/ai';
import { aiReasoningEffortsForModel, normalizeAiReasoningEffort } from '../shared/ai';
import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import { errorMessage, escapeHtml, humanize } from './html';
import { updateCard } from './views/overview';
import type { RulesPackStatus } from '../shared/rules-packs';
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
      const [secret, settings, rulesPacks] = await Promise.all([
        window.chronicle.getAiSecretStatus(),
        this.campaignId ? window.chronicle.getAiSettings(this.campaignId) : Promise.resolve(null),
        window.chronicle.listRulesPacks(),
      ]);
      this.render(secret, settings, rulesPacks);
    } catch (error) {
      this.root.innerHTML = `<div class="view-scroll"><p class="dialog-error">${escapeHtml(errorMessage(error))}</p></div>`;
    }
  }

  private render(secret: AiSecretStatus, settings: CampaignAiSettings | null, rulesPacks: readonly RulesPackStatus[]): void {
    const info = this.info!;
    const update = this.update!;
    this.root.innerHTML = `<div class="view-scroll settings-view">
      <header class="view-heading"><div><p>NASTAVENÍ</p><h1>Aplikace a AI</h1></div></header>
      <section class="settings-section"><header><div><p>AI · GLOBÁLNÍ</p><h2>OpenAI přístup</h2></div>
        <span class="status-badge ${secret.configured ? 'is-ok' : ''}">${secret.configured ? 'Nakonfigurováno' : 'Chybí klíč'}</span></header>
        <form data-api-key-form class="settings-form"><label>OpenAI API klíč
          <input type="password" name="apiKey" autocomplete="off" placeholder="sk-…" minlength="20" maxlength="512"></label>
          <p>${secret.configured ? `Klíč je uložen (${escapeHtml(secret.persistence)}, končí …${escapeHtml(secret.maskedSuffix ?? '')}).` : 'Klíč zadáte pouze zde; není součástí aplikace ani databáze kampaně.'}</p>
          <div class="button-row"><button type="submit" class="primary-button">Uložit / nahradit klíč</button>
            ${secret.configured ? '<button type="button" data-settings-action="remove-key">Odebrat klíč</button>' : ''}
            <button type="button" data-settings-action="test-connection">Otestovat připojení</button></div>
        </form>
      </section>
      <section class="settings-section"><header><div><p>AI · KAMPAŇ</p><h2>Model a chování vypravěče</h2></div>
        ${this.campaigns.length ? `<label class="campaign-picker">Kampaň<select data-settings-campaign>${this.campaigns.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === this.campaignId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>` : ''}</header>
        ${settings ? campaignForm(settings) : `<div class="settings-empty"><p>Nejdřív vytvořte kampaň. API klíč můžete uložit a otestovat už teď.</p>
          <button type="button" class="primary-button" data-action="create-campaign">Vytvořit kampaň</button></div>`}
      </section>
      <section class="settings-section"><header><div><p>AKTUALIZACE</p><h2>Verze aplikace</h2></div></header>${updateCard(update)}</section>
      <section class="settings-section"><header><div><p>PRAVIDLA · OFFLINE</p><h2>Balíčky pravidel</h2></div>
        <button type="button" data-settings-action="update-packs">Ověřit všechny</button></header>
        <p class="settings-description">Balíčky se aktualizují odděleně od aplikace, před aktivací se kontroluje schéma, odkazy a kontrolní součet. Při chybě zůstane aktivní předchozí verze.</p>
        <div class="rules-pack-list">${rulesPacks.map((pack) => `<article><div><strong>${escapeHtml(pack.displayName)}</strong>
          <span>${escapeHtml(pack.packId)} · ${escapeHtml(pack.version)} · ${pack.active ? 'aktivní' : 'neaktivní'}</span>
          <small>${escapeHtml(pack.license)} · ${escapeHtml(pack.attribution)}</small></div>
          <button type="button" data-settings-action="update-pack" data-pack-id="${escapeHtml(pack.packId)}">Ověřit</button></article>`).join('')}</div>
      </section>
      <section class="settings-section diagnostics"><header><div><p>ÚLOŽIŠTĚ / DIAGNOSTIKA</p><h2>Lokální data</h2></div></header>
        <dl><div><dt>Verze aplikace</dt><dd>${escapeHtml(info.appVersion)}</dd></div>
          <div><dt>Schéma databáze</dt><dd>v${info.storage.schemaVersion}</dd></div>
          <div><dt>Databáze</dt><dd title="${escapeHtml(info.storage.databasePath)}">${escapeHtml(info.storage.databasePath)}</dd></div></dl>
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
        this.message = 'API klíč byl odebrán.';
      } else if (button.dataset.settingsAction === 'test-connection') {
        const result = await window.chronicle.testAiConnection(this.campaignId ?? undefined);
        this.message = result.message;
      } else if (button.dataset.settingsAction === 'test-runtime') {
        if (!this.campaignId) throw new Error('Nejdřív vyberte kampaň.');
        const result = await window.chronicle.testAiRuntime(this.campaignId);
        this.message = result.message;
      } else if (button.dataset.settingsAction === 'update-packs' || button.dataset.settingsAction === 'update-pack') {
        const results = await window.chronicle.updateRulesPacks(button.dataset.packId || undefined);
        const changed = results.filter((result) => result.changed).length;
        this.message = changed ? `Aktualizováno balíčků: ${changed}.` : 'Balíčky pravidel jsou v pořádku a aktuální.';
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
      if (form.matches('[data-api-key-form]')) {
        await window.chronicle.setAiApiKey(String(data.get('apiKey') ?? ''));
        this.message = 'API klíč byl bezpečně uložen.';
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
        this.message = 'Nastavení kampaně bylo uloženo.';
      }
      this.notify(this.message, 'success');
    } catch (error) {
      this.message = errorMessage(error);
      this.notify(this.message, 'error');
    }
    await this.refresh();
  }
}

function campaignForm(settings: CampaignAiSettings): string {
  const reasoningEffort = normalizeAiReasoningEffort(settings.modelId, settings.reasoningEffort);
  return `<form data-campaign-ai-form class="settings-form"><label>Model
    <input name="modelId" value="${escapeHtml(settings.modelId)}" maxlength="120" required></label>
    <div class="settings-grid">
      ${selectField('reasoningEffort', 'Reasoning', [...aiReasoningEffortsForModel(settings.modelId)], reasoningEffort)}
      ${selectField('verbosity', 'Podrobnost', ['low', 'medium', 'high'], settings.verbosity)}
      ${selectField('approvalPolicy', 'Schvalování změn', ['review', 'automatic', 'manual'], settings.approvalPolicy)}
      <label>Max. výstupních tokenů<input type="number" name="maxOutputTokens" min="256" max="32768" value="${settings.maxOutputTokens}" required></label>
    </div><label>Pokyny pro kampaň<textarea name="campaignInstructions" rows="6" maxlength="12000">${escapeHtml(settings.campaignInstructions)}</textarea></label>
    <div class="button-row"><button type="submit" class="primary-button">Uložit nastavení kampaně</button>
      <button type="button" data-settings-action="test-runtime">Otestovat AI runtime</button></div></form>`;
}

function selectField(name: string, label: string, values: string[], selected: string): string {
  return `<label>${escapeHtml(label)}<select name="${name}">${values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(humanize(value))}</option>`).join('')}</select></label>`;
}
