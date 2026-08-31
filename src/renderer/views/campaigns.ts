import type { RuntimeWorkspaceCampaign } from '../../shared/chronicle-engine';
import { escapeHtml } from '../html';

export function renderCampaigns(root: HTMLElement, campaigns: readonly RuntimeWorkspaceCampaign[]): void {
  root.innerHTML = `<div class="view-scroll">
    <header class="view-heading"><div><p>KAMPANĚ</p><h1>Vaše kroniky</h1></div>
      <button type="button" class="primary-button" data-action="create-campaign">＋ Vytvořit kampaň</button></header>
    ${campaigns.length ? `<div class="campaign-list">${campaigns.map(campaignCard).join('')}</div>` : `<section class="empty-state">
      <span>◇</span><h2>Zatím nemáte žádnou kampaň</h2>
      <p>Vytvořte první kampaň a Chronicle připraví její pracovní prostor.</p>
      <button type="button" class="primary-button" data-action="create-campaign">Vytvořit kampaň</button>
    </section>`}
  </div>`;
}

function campaignCard(campaign: RuntimeWorkspaceCampaign): string {
  return `<article class="campaign-card">
    <div class="campaign-card-main"><p>${escapeHtml(campaign.rulesetId)} · ${escapeHtml(campaign.rulesetVersion)}</p>
      <h2>${escapeHtml(campaign.name)}</h2>
      <span>Aktivní postava: ${escapeHtml(campaign.activePlayerCharacter?.label ?? 'žádná')} · ${campaign.conversationCount} konverzací</span>
      <small>Aktualizováno ${escapeHtml(new Date(campaign.updatedAt).toLocaleString('cs-CZ'))}</small></div>
    <div class="campaign-actions">
      <button type="button" class="primary-button" data-action="open-campaign" data-campaign-id="${escapeHtml(campaign.id)}">Otevřít</button>
      <button type="button" data-action="rename-campaign" data-campaign-id="${escapeHtml(campaign.id)}">Přejmenovat</button>
      <button type="button" class="danger-link" data-action="archive-campaign" data-campaign-id="${escapeHtml(campaign.id)}">Archivovat</button>
    </div>
  </article>`;
}
