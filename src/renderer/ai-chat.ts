import type {
  AiSecretStatus,
  AiTurnClientEvent,
  CampaignAiSettings,
  PendingTurnProposal,
} from '../shared/ai';
import type { ConversationMessage } from '../shared/chronicle-engine';
import { errorMessage, escapeHtml, humanize } from './html';

export class AiChatController {
  private campaignId: string | null = null;
  private conversationId: string | null = null;
  private messages: ConversationMessage[] = [];
  private proposals: PendingTurnProposal[] = [];
  private runId: string | null = null;
  private draftAssistant = '';
  private toolStatus = '';
  private error = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly settingsDialog: HTMLDialogElement,
  ) {
    root.addEventListener('submit', (event) => void this.onSubmit(event));
    root.addEventListener('click', (event) => void this.onClick(event));
    settingsDialog.addEventListener('click', (event) => void this.onSettingsClick(event));
    window.chronicle.onAiTurnEvent((event) => void this.onTurnEvent(event));
    this.render();
  }

  async load(): Promise<void> {
    try {
      const workspace = await window.chronicle.getRuntimeWorkspace();
      const campaign = workspace.campaigns[0] ?? null;
      this.campaignId = campaign?.id ?? null;
      this.conversationId = campaign?.runtime.activeConversationId ?? null;
      this.messages = this.conversationId
        ? await window.chronicle.getConversationMessages(this.conversationId)
        : [];
      this.proposals = this.campaignId
        ? await window.chronicle.getPendingAiProposals(this.campaignId)
        : [];
      this.error = '';
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.render();
  }

  private render(): void {
    const previous = this.root.querySelector<HTMLElement>('[data-chat-scroll]');
    const nearBottom = !previous || previous.scrollHeight - previous.scrollTop - previous.clientHeight < 80;
    const rows = this.messages.map(messageRow);
    if (this.draftAssistant) rows.push(`
      <article class="chat-message is-assistant is-streaming">
        <span>Chronicle</span><div>${renderMarkdown(this.draftAssistant)}</div>
      </article>
    `);
    this.root.innerHTML = `
      <header class="chat-heading">
        <div><p>AI VYPRAVĚČ</p><h2>Chronicle Chat</h2></div>
        <button type="button" data-chat-action="settings" ${this.campaignId ? '' : 'disabled'}>⚙ Nastavení AI</button>
      </header>
      <div class="chat-scroll" data-chat-scroll aria-live="polite">
        ${rows.length ? rows.join('') : `<div class="chat-empty">
          <strong>${this.conversationId ? 'Scéna čeká na první zprávu' : 'Vyberte nebo vytvořte konverzaci'}</strong>
          <p>AI načítá pouze kontext, který pro tah skutečně potřebuje.</p>
        </div>`}
      </div>
      ${this.toolStatus ? `<p class="chat-tool-status">${escapeHtml(this.toolStatus)}</p>` : ''}
      ${this.proposals.map(proposalCard).join('')}
      ${this.error ? `<p class="chat-error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      <form class="chat-composer">
        <textarea name="message" rows="2" maxlength="20000" placeholder="Co vaše postava udělá?"
          ${!this.conversationId || this.runId ? 'disabled' : ''}></textarea>
        ${this.runId
          ? '<button type="button" data-chat-action="cancel">Zastavit</button>'
          : `<button type="submit" ${this.conversationId ? '' : 'disabled'}>Odeslat</button>`}
      </form>
    `;
    if (nearBottom) requestAnimationFrame(() => {
      const scroll = this.root.querySelector<HTMLElement>('[data-chat-scroll]');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
  }

  private async onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.campaignId || !this.conversationId || this.runId) return;
    const form = event.target as HTMLFormElement;
    const textarea = form.elements.namedItem('message') as HTMLTextAreaElement;
    const content = textarea.value.trim();
    if (!content) return;
    this.error = '';
    this.draftAssistant = '';
    const now = new Date().toISOString();
    this.messages.push({
      id: `local_${Date.now()}`,
      campaignId: this.campaignId,
      conversationId: this.conversationId,
      sequence: this.messages.length + 1,
      role: 'user',
      content,
      createdAt: now,
      relatedEventId: null,
      metadata: null,
    });
    textarea.value = '';
    this.render();
    try {
      const started = await window.chronicle.startAiTurn({
        campaignId: this.campaignId,
        conversationId: this.conversationId,
        content,
      });
      this.runId = started.runId;
      this.render();
    } catch (error) {
      this.error = errorMessage(error);
      this.runId = null;
      await this.load();
    }
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-chat-action]');
    if (!button) return;
    if (button.dataset.chatAction === 'settings') {
      await this.openSettings();
      return;
    }
    if (button.dataset.chatAction === 'cancel' && this.runId) {
      button.disabled = true;
      await window.chronicle.cancelAiTurn(this.runId);
      return;
    }
    const proposalId = button.dataset.proposalId;
    if (!proposalId) return;
    button.disabled = true;
    try {
      if (button.dataset.chatAction === 'apply') await window.chronicle.applyAiProposal(proposalId);
      if (button.dataset.chatAction === 'reject') await window.chronicle.rejectAiProposal(proposalId);
      await this.load();
    } catch (error) {
      this.error = errorMessage(error);
      this.render();
    }
  }

  private async onTurnEvent(event: AiTurnClientEvent): Promise<void> {
    if (this.runId && event.runId !== this.runId) return;
    if (event.type === 'started') this.runId = event.runId;
    if (event.type === 'text-delta') this.draftAssistant += event.delta;
    if (event.type === 'tool-status') {
      this.toolStatus = event.status === 'running'
        ? `Načítám: ${humanize(event.name.replace('chronicle.', ''))}…`
        : '';
    }
    if (event.type === 'proposal') {
      this.proposals = [event.proposal, ...this.proposals.filter((value) => value.id !== event.proposal.id)];
    }
    if (event.type === 'failed') {
      this.error = event.message;
      this.runId = null;
      this.draftAssistant = '';
      this.toolStatus = '';
      await this.load();
      return;
    }
    if (event.type === 'cancelled' || event.type === 'completed') {
      this.runId = null;
      this.draftAssistant = '';
      this.toolStatus = '';
      await this.load();
      return;
    }
    this.render();
  }

  private async openSettings(): Promise<void> {
    if (!this.campaignId) return;
    this.settingsDialog.innerHTML = '<div class="ai-settings-loading">Načítám nastavení…</div>';
    this.settingsDialog.showModal();
    try {
      const [settings, secret] = await Promise.all([
        window.chronicle.getAiSettings(this.campaignId),
        window.chronicle.getAiSecretStatus(),
      ]);
      this.renderSettings(settings, secret);
    } catch (error) {
      this.settingsDialog.innerHTML = settingsShell(`<p class="chat-error">${escapeHtml(errorMessage(error))}</p>`);
    }
  }

  private renderSettings(settings: CampaignAiSettings, secret: AiSecretStatus, message = ''): void {
    this.settingsDialog.innerHTML = settingsShell(`
      <form data-ai-settings-form>
        <section class="api-key-box">
          <label>OpenAI API klíč
            <input type="password" name="apiKey" autocomplete="off" placeholder="sk-…">
          </label>
          <p>${secret.configured
            ? `Klíč je nastaven (${escapeHtml(secret.persistence)}, končí …${escapeHtml(secret.maskedSuffix ?? '')}).`
            : 'Klíč zatím není nastaven.'}</p>
          <div><button type="button" data-settings-action="save-key">Uložit klíč</button>
            <button type="button" data-settings-action="remove-key" ${secret.configured ? '' : 'disabled'}>Odebrat</button>
            <button type="button" data-settings-action="test">Otestovat připojení</button></div>
        </section>
        <label>Model <input name="modelId" value="${escapeHtml(settings.modelId)}" maxlength="120"></label>
        <div class="settings-grid">
          ${selectField('reasoningEffort', 'Reasoning', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], settings.reasoningEffort)}
          ${selectField('verbosity', 'Podrobnost', ['low', 'medium', 'high'], settings.verbosity)}
          ${selectField('approvalPolicy', 'Schvalování změn', ['review', 'automatic', 'manual'], settings.approvalPolicy)}
          <label>Max. výstupních tokenů <input type="number" name="maxOutputTokens" min="256" max="32768" value="${settings.maxOutputTokens}"></label>
        </div>
        <label>Pokyny pro kampaň
          <textarea name="campaignInstructions" rows="5" maxlength="12000">${escapeHtml(settings.campaignInstructions)}</textarea>
        </label>
        ${message ? `<p class="settings-message">${escapeHtml(message)}</p>` : ''}
        <footer><button type="button" data-settings-action="close">Zavřít</button>
          <button type="button" class="primary-button" data-settings-action="save">Uložit nastavení</button></footer>
      </form>
    `);
  }

  private async onSettingsClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-settings-action]');
    if (!button || !this.campaignId) return;
    if (button.dataset.settingsAction === 'close') {
      this.settingsDialog.close();
      return;
    }
    const form = this.settingsDialog.querySelector<HTMLFormElement>('[data-ai-settings-form]');
    if (!form) return;
    const data = new FormData(form);
    button.disabled = true;
    try {
      if (button.dataset.settingsAction === 'save-key') {
        const key = String(data.get('apiKey') ?? '');
        await window.chronicle.setAiApiKey(key);
      } else if (button.dataset.settingsAction === 'remove-key') {
        await window.chronicle.removeAiApiKey();
      } else if (button.dataset.settingsAction === 'test') {
        const result = await window.chronicle.testAiConnection(this.campaignId);
        const [settings, secret] = await Promise.all([
          window.chronicle.getAiSettings(this.campaignId), window.chronicle.getAiSecretStatus(),
        ]);
        this.renderSettings(settings, secret, result.message);
        return;
      } else if (button.dataset.settingsAction === 'save') {
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
      }
      const [settings, secret] = await Promise.all([
        window.chronicle.getAiSettings(this.campaignId), window.chronicle.getAiSecretStatus(),
      ]);
      this.renderSettings(settings, secret, 'Uloženo.');
    } catch (error) {
      const [settings, secret] = await Promise.all([
        window.chronicle.getAiSettings(this.campaignId), window.chronicle.getAiSecretStatus(),
      ]);
      this.renderSettings(settings, secret, errorMessage(error));
    }
  }
}

function messageRow(message: ConversationMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  return `<article class="chat-message is-${message.role}">
    <span>${message.role === 'user' ? 'Vy' : 'Chronicle'}</span>
    <div>${renderMarkdown(message.content)}</div>
  </article>`;
}

function proposalCard(proposal: PendingTurnProposal): string {
  if (proposal.status !== 'pending') return '';
  return `<section class="proposal-card">
    <header><span>Navržené změny</span><strong>${escapeHtml(proposal.transaction.event.summary)}</strong></header>
    <ul>${proposal.transaction.changes.map((change) => `<li>${escapeHtml(changeSummary(change))}</li>`).join('')}</ul>
    <div><button type="button" data-chat-action="reject" data-proposal-id="${escapeHtml(proposal.id)}">Zamítnout</button>
      <button type="button" data-chat-action="apply" data-proposal-id="${escapeHtml(proposal.id)}">Použít</button></div>
  </section>`;
}

function changeSummary(change: PendingTurnProposal['transaction']['changes'][number]): string {
  switch (change.type) {
    case 'hp.delta': return `Životy: ${change.amount > 0 ? '+' : ''}${change.amount}`;
    case 'temporaryHp.set': return `Dočasné životy: ${change.value}`;
    case 'resource.delta': return `Zdroj ${change.resourceId}: ${change.amount > 0 ? '+' : ''}${change.amount}`;
    case 'spellSlot.delta': return `Sesílací pozice: ${change.amount > 0 ? '+' : ''}${change.amount}`;
    case 'effect.add': return `Přidat efekt: ${change.name}`;
    case 'effect.end': return `Ukončit efekt ${change.effectId}`;
    case 'actorRelationship.upsert': return `Vztah ${change.relationType}: ${change.currentSummary}`;
    default: return humanize(change.type);
  }
}

function renderMarkdown(value: string): string {
  const safe = escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return safe.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`).join('');
}

function settingsShell(content: string): string {
  return `<div class="ai-settings-shell"><header><h2>Nastavení AI</h2>
    <button type="button" data-settings-action="close" aria-label="Zavřít">×</button></header>${content}</div>`;
}

function selectField(name: string, label: string, values: string[], selected: string): string {
  return `<label>${escapeHtml(label)}<select name="${name}">${values.map((value) => (
    `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(humanize(value))}</option>`
  )).join('')}</select></label>`;
}
