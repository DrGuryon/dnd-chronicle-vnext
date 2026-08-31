import type { BootstrapInfo, UpdateState } from '../../shared/contracts';
import type { RuntimeWorkspaceCampaign } from '../../shared/chronicle-engine';
import { escapeHtml } from '../html';

export function renderOverview(
  root: HTMLElement,
  campaigns: readonly RuntimeWorkspaceCampaign[],
  info: BootstrapInfo,
  update: UpdateState,
): void {
  const recent = campaigns[0] ?? null;
  root.innerHTML = `<div class="view-scroll compact-dashboard">
    <header class="view-heading"><div><p>PŘEHLED</p><h1>D&amp;D Chronicle</h1></div>
      <span class="version-pill">verze ${escapeHtml(info.appVersion)}</span></header>
    ${campaigns.length === 0 ? `<section class="welcome-card">
      <span class="welcome-d20">20</span><div><p>VÍTEJTE V D&amp;D CHRONICLE</p>
      <h2>Začněte první kampaň</h2>
      <p>Nemáte žádnou kampaň. Vytvoření zabere jen chvíli a nevyžaduje seed data ani vývojářské nástroje.</p>
      <button type="button" class="primary-button" data-action="create-campaign">＋ Vytvořit první kampaň</button></div>
    </section>` : `<section class="continue-card">
      <div><p>POKRAČOVAT</p><h2>${escapeHtml(recent!.name)}</h2>
      <span>${escapeHtml(recent!.rulesetId)} · ${escapeHtml(recent!.rulesetVersion)}</span></div>
      <button type="button" class="primary-button" data-action="open-campaign" data-campaign-id="${escapeHtml(recent!.id)}">Otevřít</button>
    </section>`}
    <section class="dashboard-grid">
      <article class="info-card"><p>KAMPANĚ</p><strong>${campaigns.length}</strong><span>aktivních lokálních kampaní</span></article>
      <article class="info-card"><p>DATABÁZE</p><strong>v${info.storage.schemaVersion}</strong><span title="${escapeHtml(info.storage.databasePath)}">Lokální a verzovaná</span></article>
      <article class="info-card"><p>REŽIM</p><strong>Offline-first</strong><span>Vaše kampaně zůstávají lokální</span></article>
    </section>
    ${updateCard(update)}
  </div>`;
}

export function updateCard(update: UpdateState): string {
  const progress = Math.min(100, Math.max(0, update.percent ?? 0));
  const busy = ['checking', 'available', 'downloading', 'not-configured'].includes(update.status);
  return `<section class="update-panel" data-update-card>
    <div class="card-icon update-icon">↻</div><div class="grow">
      <p>AKTUALIZACE</p><h2 data-update-heading>${escapeHtml(updateHeading(update))}</h2>
      <span data-update-message>${escapeHtml(update.message)}</span>
      <div class="progress-track" data-progress-track ${update.status === 'downloading' || update.status === 'downloaded' ? '' : 'hidden'}>
        <div class="progress-bar" data-progress-bar style="width:${progress}%"></div></div>
    </div><button type="button" class="secondary-button" data-update-action ${busy ? 'disabled' : ''}>${update.status === 'downloaded' ? 'Nainstalovat' : 'Zkontrolovat'}</button>
  </section>`;
}

export function updateHeading(state: UpdateState): string {
  return ({
    'not-configured': 'Release kanál není nakonfigurovaný', idle: 'Automatické aktualizace jsou zapnuté',
    checking: 'Kontroluji novou verzi', available: `Nalezena verze ${state.availableVersion ?? ''}`,
    downloading: 'Stahuji aktualizaci', downloaded: 'Aktualizace je připravená',
    'up-to-date': 'Aplikace je aktuální', error: 'Kontrola se nezdařila',
  } satisfies Record<UpdateState['status'], string>)[state.status];
}
