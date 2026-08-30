import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import { errorMessage, escapeHtml } from './html';

export class RuntimeControls {
  private campaign: RuntimeWorkspaceCampaign | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onCharacterChanged: (characterId?: string) => Promise<void>,
  ) {
    root.addEventListener('change', (event) => void this.onChange(event));
    root.addEventListener('click', (event) => void this.onClick(event));
  }

  async load(campaignId?: string): Promise<void> {
    try {
      const workspace = await window.chronicle.getRuntimeWorkspace(campaignId);
      this.campaign = workspace.campaigns[0] ?? null;
      this.render(workspace.campaigns);
    } catch (error) {
      this.root.innerHTML = `<p class="runtime-error">${escapeHtml(errorMessage(error))}</p>`;
    }
  }

  private render(campaigns: RuntimeWorkspaceCampaign[]): void {
    if (!this.campaign) {
      this.root.innerHTML = `
        <div class="runtime-empty">
          <strong>Chronicle Engine je připravený</strong>
          <span>Po vytvoření kampaně zde vyberete aktivní postavu a konverzaci.</span>
        </div>
      `;
      return;
    }
    const campaign = this.campaign;
    this.root.innerHTML = `
      <div class="runtime-heading">
        <span>SCÉNA</span>
        <strong>Chronicle Engine</strong>
      </div>
      <label>
        <span>Kampaň</span>
        <select data-runtime-campaign>
          ${campaigns.map((item) => option(item.id, item.name, item.id === campaign.id)).join('')}
        </select>
      </label>
      <label>
        <span>Aktivní postava</span>
        <select data-runtime-character>
          ${option('', 'Žádná aktivní postava', campaign.runtime.activePlayerCharacterId === null)}
          ${campaign.characters.map((item) => option(
            item.id,
            item.label,
            item.id === campaign.runtime.activePlayerCharacterId,
          )).join('')}
        </select>
      </label>
      <label>
        <span>Konverzace</span>
        <select data-runtime-conversation>
          ${option('', 'Žádná aktivní konverzace', campaign.runtime.activeConversationId === null)}
          ${campaign.conversations.map((item) => option(
            item.id,
            item.title ?? 'Konverzace bez názvu',
            item.id === campaign.runtime.activeConversationId,
          )).join('')}
        </select>
      </label>
      <button type="button" data-new-conversation>＋ Nová konverzace</button>
    `;
  }

  private async onChange(event: Event): Promise<void> {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('select');
    if (!select || !this.campaign) return;
    select.disabled = true;
    try {
      if (select.matches('[data-runtime-campaign]')) {
        await this.load(select.value);
        await this.onCharacterChanged(this.campaign?.runtime.activePlayerCharacterId ?? undefined);
      } else if (select.matches('[data-runtime-character]')) {
        await window.chronicle.setActivePlayerCharacter({
          campaignId: this.campaign.id,
          entityId: select.value || null,
        });
        await this.load(this.campaign.id);
        await this.onCharacterChanged(select.value || undefined);
      } else if (select.matches('[data-runtime-conversation]')) {
        await window.chronicle.setActiveConversation({
          campaignId: this.campaign.id,
          entityId: select.value || null,
        });
        await this.load(this.campaign.id);
      }
    } catch (error) {
      this.showError(error);
      select.disabled = false;
    }
  }

  private async onClick(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-new-conversation]');
    if (!button || !this.campaign) return;
    const title = window.prompt('Název nové konverzace:', 'Nová scéna');
    if (title === null) return;
    button.disabled = true;
    try {
      const conversation = await window.chronicle.createConversation({
        campaignId: this.campaign.id,
        title: title.trim() || null,
      });
      await window.chronicle.setActiveConversation({
        campaignId: this.campaign.id,
        entityId: conversation.id,
      });
      await this.load(this.campaign.id);
    } catch (error) {
      this.showError(error);
      button.disabled = false;
    }
  }

  private showError(error: unknown): void {
    const message = document.createElement('p');
    message.className = 'runtime-error';
    message.textContent = errorMessage(error);
    this.root.append(message);
  }
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}
