import type { CampaignLibraryView, RuntimeWorkspaceCampaign } from '../../shared/chronicle-engine';
import { escapeHtml } from '../html';

export function renderLibrary(
  root: HTMLElement,
  campaigns: readonly RuntimeWorkspaceCampaign[],
  campaign: RuntimeWorkspaceCampaign | null,
  library: CampaignLibraryView | null,
  query = '',
): void {
  if (!campaign) {
    root.innerHTML = `<div class="view-scroll"><header class="view-heading"><div><p>KNIHOVNA</p><h1>Entity kampaně</h1></div></header>
      <section class="empty-state"><span>⌁</span><h2>Vyberte nebo vytvořte kampaň</h2>
      <button type="button" class="primary-button" data-action="create-campaign">Vytvořit kampaň</button></section></div>`;
    return;
  }
  const normalized = query.trim().toLocaleLowerCase('cs-CZ');
  root.innerHTML = `<div class="view-scroll">
    <header class="view-heading"><div><p>KNIHOVNA</p><h1>${escapeHtml(campaign.name)}</h1></div>
      <label class="campaign-picker">Kampaň<select data-action="library-campaign">${campaigns.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === campaign.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label></header>
    <label class="library-search"><span>Hledat v knihovně</span><input type="search" data-library-search value="${escapeHtml(query)}" placeholder="Postava, tvor, předmět, lokace…"></label>
    <div class="library-groups">${(library?.categories ?? []).map((category) => {
      const items = category.items.filter((item) => !normalized || `${item.label} ${item.subtitle ?? ''}`.toLocaleLowerCase('cs-CZ').includes(normalized));
      return `<section class="library-group"><header><h2>${escapeHtml(category.label)}</h2><span>${items.length}</span></header>
        ${items.length ? `<div>${items.map((item) => `<button type="button" class="library-row" data-entity-id="${escapeHtml(item.id)}" data-entity-kind="${escapeHtml(item.kind)}">
          <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.subtitle ?? item.kind)}</small></span><i>Otevřít →</i></button>`).join('')}</div>` : '<p class="category-empty">V této kategorii zatím nic není.</p>'}
      </section>`;
    }).join('')}</div>
  </div>`;
}
