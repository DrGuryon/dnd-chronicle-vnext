import type { RuntimeWorkspaceCampaign } from '../../shared/chronicle-engine';
import { escapeHtml } from '../html';
import { playPrerequisite } from '../router';

export function renderPlayChrome(
  root: HTMLElement,
  campaigns: readonly RuntimeWorkspaceCampaign[],
  campaign: RuntimeWorkspaceCampaign | null,
): void {
  if (!campaign) {
    root.innerHTML = `<section class="play-empty empty-state"><span>◇</span><h2>Nejdřív vytvořte kampaň</h2>
      <p>Pracovní prostor se otevře hned po vytvoření.</p>
      <button type="button" class="primary-button" data-action="create-campaign">Vytvořit kampaň</button></section>`;
    return;
  }
  const prerequisite = playPrerequisite(campaign);
  root.innerHTML = `<header class="campaign-bar">
    <label><span>Kampaň</span><select data-action="switch-campaign">${campaigns.map((item) => option(item.id, item.name, item.id === campaign.id)).join('')}</select></label>
    <div class="campaign-title"><p>AKTIVNÍ KAMPAŇ</p><h1>${escapeHtml(campaign.name)}</h1><span>${escapeHtml(campaign.rulesetId)} ${escapeHtml(campaign.rulesetVersion)}</span></div>
    <label><span>Postava</span><select data-action="switch-character">
      ${option('', 'Žádná aktivní postava', !campaign.runtime.activePlayerCharacterId)}
      ${campaign.characters.map((item) => option(item.id, item.label, item.id === campaign.runtime.activePlayerCharacterId)).join('')}</select></label>
    <label><span>Konverzace</span><select data-action="switch-conversation">
      ${option('', 'Žádná otevřená scéna', !campaign.runtime.activeConversationId)}
      ${campaign.conversations.map((item) => option(item.id, item.title ?? 'Konverzace bez názvu', item.id === campaign.runtime.activeConversationId)).join('')}</select></label>
    <div class="campaign-bar-actions">
      <button type="button" data-action="create-character">＋ Postava</button>
      <button type="button" data-action="create-conversation">＋ Konverzace</button>
      <button type="button" data-action="toggle-cockpit" aria-label="Skrýt nebo zobrazit Character Cockpit">◫ Cockpit</button>
    </div>
  </header>
  ${prerequisite === 'character' ? `<section class="prerequisite-banner"><div><strong>Nejdřív vytvořte hráčskou postavu.</strong><span>Postava zpřístupní Cockpit a první tah.</span></div><button type="button" data-action="create-character">Vytvořit postavu</button></section>` : ''}
  ${prerequisite === 'conversation' ? `<section class="prerequisite-banner"><div><strong>Vytvořte první konverzaci.</strong><span>Konverzace uchovává zprávy vaší scény.</span></div><button type="button" data-action="create-conversation">Nová konverzace</button></section>` : ''}
  <div class="play-secondary-actions">
    ${campaign.runtime.activePlayerCharacterId ? '<button type="button" data-action="edit-character">Upravit postavu</button>' : ''}
    <button type="button" data-action="create-character-advanced">Rozšířená tvorba postavy</button>
    ${campaign.runtime.activeConversationId ? '<button type="button" data-action="rename-conversation">Přejmenovat konverzaci</button>' : ''}
    <button type="button" data-action="open-settings">Nastavení AI</button>
  </div>`;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}
