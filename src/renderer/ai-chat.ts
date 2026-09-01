import type { PendingAiProposal, AiTurnClientEvent, PendingTurnProposal } from '../shared/ai';
import type { DataChange } from '../shared/editable-domain';
import type { ConversationMessage, RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import { errorMessage, escapeHtml, humanize } from './html';

export interface AiChatActions {
  openSettings(): void;
  createCharacter(): void;
  createConversation(): void;
}

export class AiChatController {
  private campaignId: string | null = null;
  private conversationId: string | null = null;
  private activeCharacterId: string | null = null;
  private keyConfigured = false;
  private messages: ConversationMessage[] = [];
  private proposals: PendingAiProposal[] = [];
  private runId: string | null = null;
  private starting = false;
  private lastSettledRunId: string | null = null;
  private activeTurnContent: string | null = null;
  private retryTurn: { content: string; userMessageId: string } | null = null;
  private draftAssistant = '';
  private toolStatus = '';
  private error = '';
  private userNearBottom = true;
  private newMessagesPending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: AiChatActions,
  ) {
    root.addEventListener('submit', (event) => void this.onSubmit(event));
    root.addEventListener('click', (event) => void this.onClick(event));
    root.addEventListener('scroll', (event) => this.onScroll(event), true);
    window.chronicle.onAiTurnEvent((event) => void this.onTurnEvent(event));
    this.render();
  }

  async load(
    campaign: RuntimeWorkspaceCampaign | null,
    options: { preserveError?: boolean } = {},
  ): Promise<void> {
    const nextCampaignId = campaign?.id ?? null;
    if (this.runId && nextCampaignId !== this.campaignId) {
      await window.chronicle.cancelAiTurn(this.runId);
      this.runId = null;
    }
    this.campaignId = nextCampaignId;
    this.conversationId = campaign?.runtime.activeConversationId ?? null;
    this.activeCharacterId = campaign?.runtime.activePlayerCharacterId ?? null;
    this.draftAssistant = '';
    this.toolStatus = '';
    this.newMessagesPending = false;
    try {
      const [messages, proposals, secret] = await Promise.all([
        this.conversationId
          ? window.chronicle.getConversationMessages(this.conversationId)
          : Promise.resolve([]),
        this.campaignId
          ? window.chronicle.getPendingAiProposals(this.campaignId)
          : Promise.resolve([]),
        window.chronicle.getAiSecretStatus(),
      ]);
      this.messages = messages;
      this.proposals = proposals;
      this.keyConfigured = secret.configured;
      if (!options.preserveError) {
        this.error = '';
        this.retryTurn = null;
      }
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.userNearBottom = true;
    this.render();
  }

  private render(): void {
    const rows = this.messages.map(messageRow);
    if (this.draftAssistant) rows.push(`<article class="chat-message is-assistant is-streaming">
      <span>Chronicle</span><div>${renderMarkdown(this.draftAssistant)}</div></article>`);
    const prerequisite = !this.campaignId
      ? 'campaign'
      : !this.activeCharacterId
        ? 'character'
        : !this.conversationId
          ? 'conversation'
          : !this.keyConfigured
            ? 'key'
            : null;
    this.root.innerHTML = `<header class="chat-heading">
      <div><p>AI VYPRAVĚČ</p><h2>Chronicle Chat</h2></div>
      <button type="button" data-chat-action="settings">⚙ Nastavení AI</button></header>
      <div class="chat-scroll" data-chat-scroll aria-live="polite">
        ${rows.length ? rows.join('') : emptyChat(prerequisite)}
      </div>
      ${this.newMessagesPending ? '<button type="button" class="new-messages" data-chat-action="scroll-bottom">Nové zprávy ↓</button>' : ''}
      ${this.toolStatus ? `<p class="chat-tool-status">${escapeHtml(this.toolStatus)}</p>` : ''}
      ${this.proposals.map(proposalCard).join('')}
      ${this.error ? `<section class="chat-error" role="alert"><p>${escapeHtml(this.error)}</p><div>
        ${this.retryTurn ? '<button type="button" data-chat-action="retry">Zkusit znovu</button>' : ''}
        <button type="button" data-chat-action="settings">Nastavení AI</button>
        <button type="button" data-chat-action="dismiss-error" aria-label="Skrýt chybu">Skrýt</button>
      </div></section>` : ''}
      ${prerequisite ? prerequisiteAction(prerequisite) : ''}
      <form class="chat-composer">
        <textarea name="message" rows="2" maxlength="20000" placeholder="Co vaše postava udělá?" ${prerequisite || this.runId || this.starting ? 'disabled' : ''}></textarea>
        ${this.runId ? '<button type="button" data-chat-action="cancel">Zastavit</button>' : `<button type="submit" ${prerequisite || this.starting ? 'disabled' : ''}>Odeslat</button>`}
      </form>`;
    if (this.userNearBottom) requestAnimationFrame(() => this.scrollToBottom());
  }

  private async onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.campaignId || !this.conversationId || !this.activeCharacterId || !this.keyConfigured || this.runId || this.starting) return;
    const form = event.target as HTMLFormElement;
    const textarea = form.elements.namedItem('message') as HTMLTextAreaElement;
    const content = textarea.value.trim();
    if (!content) return;
    textarea.value = '';
    await this.startTurn(content, null, true);
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-chat-action]');
    if (!button) return;
    const action = button.dataset.chatAction;
    if (action === 'settings') return this.actions.openSettings();
    if (action === 'dismiss-error') {
      this.error = '';
      this.retryTurn = null;
      this.render();
      return;
    }
    if (action === 'retry' && this.retryTurn) {
      const retry = this.retryTurn;
      await this.startTurn(retry.content, retry.userMessageId, false);
      return;
    }
    if (action === 'create-character') return this.actions.createCharacter();
    if (action === 'create-conversation') return this.actions.createConversation();
    if (action === 'scroll-bottom') {
      this.userNearBottom = true;
      this.newMessagesPending = false;
      this.render();
      return;
    }
    if (action === 'cancel' && this.runId) {
      button.disabled = true;
      await window.chronicle.cancelAiTurn(this.runId);
      return;
    }
    const proposalId = button.dataset.proposalId;
    if (!proposalId) return;
    button.disabled = true;
    try {
      if (action === 'apply') await window.chronicle.applyAiProposal(proposalId);
      if (action === 'reject') await window.chronicle.rejectAiProposal(proposalId);
      await this.reloadCurrent();
    } catch (error) {
      this.error = errorMessage(error);
      this.render();
    }
  }

  private async onTurnEvent(event: AiTurnClientEvent): Promise<void> {
    if (this.runId && event.runId !== this.runId) return;
    if (event.type === 'started') {
      this.starting = false;
      this.runId = event.runId;
    }
    if (event.type === 'text-delta') {
      this.draftAssistant += event.delta;
      this.toolStatus = '';
      if (!this.userNearBottom) this.newMessagesPending = true;
    }
    if (event.type === 'tool-status') {
      this.toolStatus = event.status === 'running'
        ? `Načítám: ${humanize(event.name.replace('chronicle.', ''))}…`
        : '';
    }
    if (event.type === 'proposal') {
      this.proposals = [event.proposal, ...this.proposals.filter((item) => item.id !== event.proposal.id)];
    }
    if (event.type === 'failed') {
      this.error = event.message;
      this.retryTurn = this.activeTurnContent
        ? { content: this.activeTurnContent, userMessageId: event.userMessageId }
        : null;
      this.runId = null;
      this.starting = false;
      this.lastSettledRunId = event.runId;
      this.activeTurnContent = null;
      this.draftAssistant = '';
      this.toolStatus = '';
      await this.reloadCurrent(true);
      return;
    }
    if (event.type === 'cancelled' || event.type === 'completed') {
      this.runId = null;
      this.starting = false;
      this.lastSettledRunId = event.runId;
      this.activeTurnContent = null;
      this.retryTurn = null;
      this.draftAssistant = '';
      this.toolStatus = '';
      await this.reloadCurrent();
      return;
    }
    this.render();
  }

  private onScroll(event: Event): void {
    const scroll = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-scroll]');
    if (!scroll) return;
    this.userNearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    if (this.userNearBottom && this.newMessagesPending) {
      this.newMessagesPending = false;
      this.root.querySelector('[data-chat-action="scroll-bottom"]')?.remove();
    }
  }

  private scrollToBottom(): void {
    const scroll = this.root.querySelector<HTMLElement>('[data-chat-scroll]');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  private async reloadCurrent(preserveError = false): Promise<void> {
    if (!this.campaignId) return this.load(null, { preserveError });
    const workspace = await window.chronicle.getRuntimeWorkspace(this.campaignId);
    await this.load(workspace.campaigns[0] ?? null, { preserveError });
  }

  private async startTurn(
    content: string,
    retryUserMessageId: string | null,
    optimisticMessage: boolean,
  ): Promise<void> {
    if (!this.campaignId || !this.conversationId || this.runId || this.starting) return;
    this.error = '';
    this.retryTurn = null;
    this.draftAssistant = '';
    this.toolStatus = 'Chronicle přemýšlí…';
    this.activeTurnContent = content;
    this.starting = true;
    this.userNearBottom = true;
    if (optimisticMessage) {
      this.messages.push({
        id: `local_${Date.now()}`,
        campaignId: this.campaignId,
        conversationId: this.conversationId,
        sequence: this.messages.length + 1,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        relatedEventId: null,
        metadata: null,
      });
    }
    this.render();
    try {
      const started = await window.chronicle.startAiTurn({
        campaignId: this.campaignId,
        conversationId: this.conversationId,
        content,
        ...(retryUserMessageId ? { retryUserMessageId } : {}),
      });
      this.starting = false;
      if (this.lastSettledRunId !== started.runId) this.runId = started.runId;
      this.render();
    } catch (error) {
      this.error = errorMessage(error);
      this.runId = null;
      this.starting = false;
      this.activeTurnContent = null;
      this.draftAssistant = '';
      this.toolStatus = '';
      await this.reloadCurrent(true);
    }
  }
}

function emptyChat(prerequisite: 'campaign' | 'character' | 'conversation' | 'key' | null): string {
  const copy = {
    campaign: ['Vytvořte první kampaň', 'Chronicle potřebuje pracovní prostor pro váš příběh.'],
    character: ['Chybí hráčská postava', 'Vytvořte postavu, aby měl AI vypravěč aktivního hrdinu.'],
    conversation: ['Nemáte otevřenou scénu', 'Vytvořte konverzaci pro první tah.'],
    key: ['AI není nakonfigurovaná', 'Zadejte vlastní OpenAI API klíč v globálním nastavení.'],
  } as const;
  const value = prerequisite ? copy[prerequisite] : ['Scéna čeká na první zprávu', 'Co vaše postava udělá?'];
  return `<div class="chat-empty"><strong>${value[0]}</strong><p>${value[1]}</p></div>`;
}

function prerequisiteAction(value: 'campaign' | 'character' | 'conversation' | 'key'): string {
  if (value === 'campaign') return '';
  const action = value === 'character' ? 'create-character' : value === 'conversation' ? 'create-conversation' : 'settings';
  const label = value === 'character' ? 'Vytvořit postavu' : value === 'conversation' ? 'Nová konverzace' : 'Otevřít Nastavení AI';
  return `<div class="chat-prerequisite"><span>${value === 'key' ? 'AI není nakonfigurovaná.' : 'Chybí povinný krok.'}</span><button type="button" data-chat-action="${action}">${label}</button></div>`;
}

function messageRow(message: ConversationMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  return `<article class="chat-message is-${message.role}"><span>${message.role === 'user' ? 'Vy' : 'Chronicle'}</span><div>${renderMarkdown(message.content)}</div></article>`;
}

function proposalCard(proposal: PendingAiProposal): string {
  if (proposal.status !== 'pending') return '';
  const summary = proposal.kind === 'turn' ? proposal.transaction.event.summary : proposal.transaction.summary;
  const changes = proposal.kind === 'turn'
    ? proposal.transaction.changes.map(changeSummary)
    : proposal.transaction.changes.map(dataChangeSummary);
  return `<section class="proposal-card"><header><span>${proposal.kind === 'turn' ? 'Navržené změny světa' : 'Navržené úpravy dat'}</span><strong>${escapeHtml(summary)}</strong></header>
    <ul>${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('')}</ul>
    <div><button type="button" data-chat-action="reject" data-proposal-id="${escapeHtml(proposal.id)}">Zamítnout</button>
      <button type="button" data-chat-action="apply" data-proposal-id="${escapeHtml(proposal.id)}">Použít</button></div></section>`;
}

function dataChangeSummary(change: DataChange): string {
  switch (change.type) {
    case 'character.create': return `Vytvořit postavu ${change.name}`;
    case 'character.identity.set': return `Identita: ${change.name}${change.fullName ? ` (${change.fullName})` : ''}`;
    case 'character.biography.set': return 'Upravit biografii, vzhled a osobnost';
    case 'character.origin.set': return 'Upravit druh, původ a zázemí';
    case 'character.class.add': return `Přidat povolání na úrovni ${change.level}`;
    case 'character.class.update': return `Upravit povolání na úroveň ${change.level}`;
    case 'character.class.remove': return 'Odebrat povolání';
    case 'character.ability.set': return `${humanize(change.abilityId)}: ${change.baseScore}`;
    case 'character.proficiency.add': return `Přidat zdatnost ${change.customTarget ?? change.targetDefinitionId ?? ''}`;
    case 'character.proficiency.update': return `Upravit zdatnost ${change.customTarget ?? change.targetDefinitionId ?? ''}`;
    case 'character.proficiency.remove': return 'Odebrat zdatnost';
    case 'character.language.add': return `Přidat jazyk ${change.customLanguage ?? change.languageDefinitionId ?? ''}`;
    case 'character.language.update': return `Upravit jazyk ${change.customLanguage ?? change.languageDefinitionId ?? ''}`;
    case 'character.language.remove': return 'Odebrat jazyk';
    case 'character.feature.add': return `Přidat schopnost ${change.customName ?? change.definitionId ?? ''}`;
    case 'character.feature.update': return `Upravit schopnost ${change.customName ?? change.definitionId ?? ''}`;
    case 'character.feature.remove': return 'Odebrat schopnost';
    case 'character.spellcastingSource.add': return `Přidat zdroj sesílání (${humanize(change.abilityId)})`;
    case 'character.spellcastingSource.update': return `Upravit zdroj sesílání (${humanize(change.abilityId)})`;
    case 'character.spellcastingSource.remove': return 'Odebrat zdroj sesílání';
    case 'character.spell.add': return `Přidat kouzlo ${change.spellId}`;
    case 'character.spell.update': return `Upravit kouzlo ${change.spellId}`;
    case 'character.spell.remove': return 'Odebrat kouzlo';
    case 'character.notes.replace': return 'Nahradit poznámky';
    case 'character.notes.append': return 'Připojit poznámku';
    case 'ruleDefinition.homebrew.create': return `Vytvořit Homebrew definici ${change.name}`;
    case 'ruleDefinition.homebrew.update': return `Upravit Homebrew definici ${change.name}`;
    case 'ruleReference.reassign': return `Spárovat ${change.category} s kanonickou definicí`;
  }
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
