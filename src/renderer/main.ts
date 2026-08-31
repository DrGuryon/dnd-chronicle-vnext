import './styles.css';
import type { BootstrapInfo, UpdateState } from '../shared/contracts';
import type { CampaignLibraryView, RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import { AiChatController } from './ai-chat';
import { AiSettingsController } from './ai-settings';
import { CharacterCockpitController } from './character-cockpit';
import { FormDialog } from './dialogs/form-dialog';
import { EntityCardHost } from './entity-card';
import { errorMessage, escapeHtml } from './html';
import { resolveStartupRoute, type AppView } from './router';
import { RendererUiStateStore, type PersistedUiState } from './ui-state';
import { renderCampaigns } from './views/campaigns';
import { renderLibrary } from './views/library';
import { renderOverview, updateHeading } from './views/overview';
import { renderPlayChrome } from './views/play';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Kořen aplikace nebyl nalezen.');

appRoot.innerHTML = `<div class="app-shell" data-app-shell>
  <aside class="sidebar" aria-label="Hlavní navigace">
    <div class="sidebar-scroll"><div class="brand-mark" aria-hidden="true">D20</div>
      <div class="brand-copy"><span>D&amp;D</span><strong>Chronicle</strong></div>
      <nav>${navButton('overview', '⌂', 'Přehled')}${navButton('campaigns', '◇', 'Kampaně')}
        ${navButton('play', '▶', 'Hrát')}${navButton('library', '⌁', 'Knihovna')}${navButton('settings', '⚙', 'Nastavení')}</nav>
    </div>
    <div class="sidebar-foot"><span class="status-dot"></span><span>Lokální režim</span></div>
  </aside>
  <main class="workspace-main">
    <section class="app-view" data-view-panel="overview"></section>
    <section class="app-view" data-view-panel="campaigns" hidden></section>
    <section class="app-view play-view" data-view-panel="play" hidden>
      <div data-play-chrome></div><section class="ai-chat" data-ai-chat aria-label="Chronicle Chat"></section>
    </section>
    <section class="app-view" data-view-panel="library" hidden></section>
    <section class="app-view" data-view-panel="settings" hidden></section>
  </main>
  <aside class="cockpit-panel" data-cockpit-panel aria-label="Character Cockpit">
    <div class="cockpit-resizer" data-cockpit-resizer role="separator" aria-label="Změnit šířku Character Cockpitu" aria-orientation="vertical" tabindex="0"></div>
    <button type="button" class="cockpit-hide" data-action="hide-cockpit" aria-label="Skrýt Character Cockpit">×</button>
    <div class="cockpit-content" data-cockpit></div>
  </aside>
  <button type="button" class="cockpit-restore" data-action="show-cockpit" aria-label="Zobrazit Character Cockpit">◫ Postava</button>
  <dialog class="entity-card-dialog" data-entity-card-dialog aria-label="Detail entity"></dialog>
  <dialog class="form-dialog" data-form-dialog aria-label="Formulář"></dialog>
  <div class="app-toast" data-app-toast role="status" hidden></div>
</div>`;

const shell = requireElement<HTMLElement>('[data-app-shell]');
const overviewRoot = requireElement<HTMLElement>('[data-view-panel="overview"]');
const campaignsRoot = requireElement<HTMLElement>('[data-view-panel="campaigns"]');
const playChromeRoot = requireElement<HTMLElement>('[data-play-chrome]');
const libraryRoot = requireElement<HTMLElement>('[data-view-panel="library"]');
const settingsRoot = requireElement<HTMLElement>('[data-view-panel="settings"]');
const cockpitPanel = requireElement<HTMLElement>('[data-cockpit-panel]');
const cockpitRestore = requireElement<HTMLButtonElement>('[data-action="show-cockpit"]');
const formDialog = new FormDialog(requireElement<HTMLDialogElement>('[data-form-dialog]'));
const uiStore = new RendererUiStateStore(window.localStorage);
let uiState: PersistedUiState = uiStore.load();
let info: BootstrapInfo;
let updateState: UpdateState;
let campaigns: RuntimeWorkspaceCampaign[] = [];
let activeCampaignId: string | null = null;
let activeView: AppView = 'overview';
let library: CampaignLibraryView | null = null;
let libraryQuery = '';
let cockpitDrawerOpen = false;

const cockpit = new CharacterCockpitController(
  requireElement<HTMLElement>('[data-cockpit]'),
  (view) => {
    if (view) shell.style.setProperty('--cockpit-width', `${view.preferences.panelWidth}px`);
    updateCockpitVisibility();
  },
  (title, description) => formDialog.confirm(title, description, 'Potvrdit'),
);
const aiChat = new AiChatController(requireElement<HTMLElement>('[data-ai-chat]'), {
  openSettings: () => void navigate('settings'),
  createCharacter: () => void createCharacter(),
  createConversation: () => void createConversation(),
});
const settings = new AiSettingsController(settingsRoot);
new EntityCardHost(requireElement<HTMLDialogElement>('[data-entity-card-dialog]'));

appRoot.addEventListener('click', (event) => void onClick(event));
appRoot.addEventListener('change', (event) => void onChange(event));
libraryRoot.addEventListener('input', (event) => onLibrarySearch(event));
window.addEventListener('resize', updateCockpitVisibility);
setupCockpitResize();
window.chronicle.onUpdateState((state) => {
  updateState = state;
  renderUpdateState(state);
});

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    [info, campaigns] = await Promise.all([
      window.chronicle.getBootstrap(),
      window.chronicle.listCampaigns(),
    ]);
    updateState = info.update;
    const route = resolveStartupRoute(campaigns, uiState.lastActiveCampaignId);
    activeCampaignId = route.campaignId;
    activeView = route.view;
    await renderAll();
  } catch (error) {
    showToast(`Aplikaci se nepodařilo načíst: ${errorMessage(error)}`, true);
  }
}

async function renderAll(): Promise<void> {
  const campaign = activeCampaign();
  if (!campaign && activeCampaignId) activeCampaignId = null;
  renderNavigation();
  renderOverview(overviewRoot, campaigns, info, updateState);
  renderCampaigns(campaignsRoot, campaigns);
  renderPlayChrome(playChromeRoot, campaigns, campaign);
  await aiChat.load(campaign);
  await cockpit.load(campaign?.runtime.activePlayerCharacterId ?? undefined);
  if (activeView === 'library') await loadLibrary();
  else renderLibrary(libraryRoot, campaigns, campaign, library, libraryQuery);
  if (activeView === 'settings') await settings.load(campaigns, activeCampaignId, info, updateState);
  updateCockpitVisibility();
  persistUiState();
}

async function refreshCampaigns(preferredId: string | null = activeCampaignId): Promise<void> {
  campaigns = await window.chronicle.listCampaigns();
  activeCampaignId = campaigns.some((item) => item.id === preferredId) ? preferredId : campaigns[0]?.id ?? null;
  library = null;
  await renderAll();
}

async function navigate(view: AppView): Promise<void> {
  activeView = view;
  if (view === 'play' && !activeCampaignId && campaigns.length) activeCampaignId = campaigns[0].id;
  renderNavigation();
  if (view === 'library') await loadLibrary();
  if (view === 'settings') await settings.load(campaigns, activeCampaignId, info, updateState);
  updateCockpitVisibility();
  persistUiState();
}

function renderNavigation(): void {
  document.querySelectorAll<HTMLElement>('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== activeView;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-nav-view]').forEach((button) => {
    const selected = button.dataset.navView === activeView;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
    if (button.dataset.navView === 'play') button.hidden = campaigns.length === 0;
  });
}

async function onClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLButtonElement>('[data-nav-view]');
  if (nav) return navigate(nav.dataset.navView as AppView);
  const button = target.closest<HTMLButtonElement>('[data-action], [data-update-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'create-campaign') return createCampaign();
  if (action === 'open-campaign') return openCampaign(button.dataset.campaignId ?? '');
  if (action === 'rename-campaign') return renameCampaign(button.dataset.campaignId ?? '');
  if (action === 'archive-campaign') return archiveCampaign(button.dataset.campaignId ?? '');
  if (action === 'create-character') return createCharacter();
  if (action === 'edit-character') return editCharacter();
  if (action === 'create-conversation') return createConversation();
  if (action === 'rename-conversation') return renameConversation();
  if (action === 'open-settings') return navigate('settings');
  if (action === 'toggle-cockpit') return toggleCockpit();
  if (action === 'hide-cockpit') return hideCockpit();
  if (action === 'show-cockpit') return showCockpit();
  if (button.matches('[data-update-action]')) return runUpdateAction(button);
}

async function onChange(event: Event): Promise<void> {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('select[data-action]');
  if (!select) return;
  select.disabled = true;
  try {
    if (select.dataset.action === 'switch-campaign') return openCampaign(select.value);
    const campaign = activeCampaign();
    if (!campaign) return;
    if (select.dataset.action === 'switch-character') {
      await window.chronicle.setActivePlayerCharacter({ campaignId: campaign.id, entityId: select.value || null });
      return refreshCampaigns(campaign.id);
    }
    if (select.dataset.action === 'switch-conversation') {
      await window.chronicle.setActiveConversation({ campaignId: campaign.id, entityId: select.value || null });
      return refreshCampaigns(campaign.id);
    }
    if (select.dataset.action === 'library-campaign') {
      activeCampaignId = select.value;
      library = null;
      await loadLibrary();
      persistUiState();
    }
  } catch (error) {
    showToast(errorMessage(error), true);
    select.disabled = false;
  }
}

async function createCampaign(): Promise<void> {
  const created = await formDialog.open({
    title: 'Nová kampaň',
    description: 'Chronicle vytvoří prázdný lokální pracovní prostor bez seed dat.',
    submitLabel: 'Vytvořit kampaň',
    fields: [
      { name: 'name', label: 'Název kampaně', required: true, maxlength: 120, placeholder: 'Ravenford' },
      { name: 'rulesetId', label: 'Ruleset', type: 'select', value: 'dnd5e', options: [{ value: 'dnd5e', label: 'D&D 5E' }] },
      { name: 'rulesetVersion', label: 'Verze pravidel', type: 'select', value: '2024', options: [{ value: '2024', label: '2024' }, { value: '2014', label: '2014' }] },
    ],
    validate: (values) => values.name.trim() ? {} : { name: 'Zadejte název kampaně.' },
    submit: (values) => window.chronicle.createCampaign({
      name: values.name,
      rulesetId: 'dnd5e',
      rulesetVersion: values.rulesetVersion as '2014' | '2024',
    }),
  });
  if (!created) return;
  activeCampaignId = created.id;
  activeView = 'play';
  uiState.cockpitVisible = true;
  await refreshCampaigns(created.id);
}

async function openCampaign(campaignId: string): Promise<void> {
  if (!campaigns.some((item) => item.id === campaignId)) return;
  activeCampaignId = campaignId;
  activeView = 'play';
  cockpitDrawerOpen = false;
  await refreshCampaigns(campaignId);
}

async function renameCampaign(campaignId: string): Promise<void> {
  const campaign = campaigns.find((item) => item.id === campaignId);
  if (!campaign) return;
  const renamed = await formDialog.open({
    title: 'Přejmenovat kampaň', submitLabel: 'Uložit',
    fields: [{ name: 'name', label: 'Název kampaně', value: campaign.name, required: true, maxlength: 120 }],
    validate: (values) => values.name.trim() ? {} : { name: 'Zadejte název kampaně.' },
    submit: (values) => window.chronicle.renameCampaign({ campaignId, name: values.name }),
  });
  if (renamed) await refreshCampaigns(activeCampaignId);
}

async function archiveCampaign(campaignId: string): Promise<void> {
  const campaign = campaigns.find((item) => item.id === campaignId);
  if (!campaign) return;
  const confirmed = await formDialog.confirm(
    `Archivovat kampaň „${campaign.name}“?`,
    'Kampaň zmizí z pracovního seznamu. Její lokální data se fyzicky nemažou.',
    'Archivovat',
  );
  if (!confirmed) return;
  await window.chronicle.archiveCampaign(campaignId);
  if (activeCampaignId === campaignId) activeCampaignId = null;
  activeView = 'campaigns';
  await refreshCampaigns(null);
}

async function createCharacter(): Promise<void> {
  const campaign = activeCampaign();
  if (!campaign) return createCampaign();
  const created = await formDialog.open({
    title: 'Nová hráčská postava',
    description: 'Pro první hru stačí identita a základ. Zbytek doplníte později.',
    submitLabel: 'Vytvořit postavu',
    fields: [
      { name: 'name', label: 'Jméno', section: '1 · Identita', required: true, maxlength: 120, placeholder: 'Arqos' },
      { name: 'fullName', label: 'Celé jméno', maxlength: 160 },
      { name: 'species', label: 'Druh', section: '2 · Základy', maxlength: 120, placeholder: 'Člověk' },
      { name: 'background', label: 'Zázemí', maxlength: 120 },
      { name: 'className', label: 'Povolání', maxlength: 120, placeholder: 'Bojovník' },
      { name: 'level', label: 'Úroveň', type: 'number', value: 1, min: 1, max: 20, required: true },
    ],
    validate: (values) => values.name.trim() ? {} : { name: 'Zadejte jméno postavy.' },
    submit: (values) => window.chronicle.createCharacter({
      campaignId: campaign.id,
      name: values.name,
      fullName: values.fullName || null,
      species: values.species || null,
      background: values.background || null,
      className: values.className || null,
      level: Number(values.level),
    }),
  });
  if (created) {
    uiState.cockpitVisible = true;
    await refreshCampaigns(campaign.id);
  }
}

async function editCharacter(): Promise<void> {
  const campaign = activeCampaign();
  const characterId = campaign?.runtime.activePlayerCharacterId;
  if (!campaign || !characterId) return;
  const character = (await window.chronicle.listCampaignCharacters(campaign.id))
    .find((item) => item.id === characterId);
  if (!character) return;
  const updated = await formDialog.open({
    title: 'Upravit identitu postavy', submitLabel: 'Uložit',
    fields: [
      { name: 'name', label: 'Jméno', value: character.name, required: true, maxlength: 120 },
      { name: 'fullName', label: 'Celé jméno', value: character.fullName, maxlength: 160 },
    ],
    validate: (values) => values.name.trim() ? {} : { name: 'Zadejte jméno postavy.' },
    submit: (values) => window.chronicle.updateCharacterBasics({ characterId, name: values.name, fullName: values.fullName || null }),
  });
  if (updated) await refreshCampaigns(campaign.id);
}

async function createConversation(): Promise<void> {
  const campaign = activeCampaign();
  if (!campaign) return createCampaign();
  const conversation = await formDialog.open({
    title: 'Nová konverzace',
    description: 'Konverzace představuje jednu scénu nebo souvislý úsek hry.',
    submitLabel: 'Otevřít konverzaci',
    fields: [{ name: 'title', label: 'Název (volitelný)', value: campaign.conversations.length ? 'Nová scéna' : 'Začátek', maxlength: 120 }],
    submit: (values) => window.chronicle.createConversation({ campaignId: campaign.id, title: values.title.trim() || null }),
  });
  if (conversation) await refreshCampaigns(campaign.id);
}

async function renameConversation(): Promise<void> {
  const campaign = activeCampaign();
  const conversation = campaign?.conversations.find((item) => item.id === campaign.runtime.activeConversationId);
  if (!campaign || !conversation) return;
  const renamed = await formDialog.open({
    title: 'Přejmenovat konverzaci', submitLabel: 'Uložit',
    fields: [{ name: 'title', label: 'Název (volitelný)', value: conversation.title, maxlength: 120 }],
    submit: (values) => window.chronicle.renameConversation({ conversationId: conversation.id, title: values.title.trim() || null }),
  });
  if (renamed) await refreshCampaigns(campaign.id);
}

async function loadLibrary(): Promise<void> {
  const campaign = activeCampaign();
  library = campaign ? await window.chronicle.getCampaignLibrary(campaign.id) : null;
  renderLibrary(libraryRoot, campaigns, campaign, library, libraryQuery);
}

function onLibrarySearch(event: Event): void {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-library-search]');
  if (!input) return;
  libraryQuery = input.value;
  renderLibrary(libraryRoot, campaigns, activeCampaign(), library, libraryQuery);
  const replacement = libraryRoot.querySelector<HTMLInputElement>('[data-library-search]');
  replacement?.focus();
  replacement?.setSelectionRange(libraryQuery.length, libraryQuery.length);
}

async function runUpdateAction(button: HTMLButtonElement): Promise<void> {
  if (updateState.status === 'downloaded') {
    button.disabled = true;
    button.textContent = 'Restartuji…';
    await window.chronicle.installUpdate();
    return;
  }
  button.disabled = true;
  await window.chronicle.checkForUpdates();
}

function renderUpdateState(state: UpdateState): void {
  renderOverview(overviewRoot, campaigns, info, state);
  document.querySelectorAll<HTMLElement>('[data-update-heading]').forEach((element) => { element.textContent = updateHeading(state); });
  document.querySelectorAll<HTMLElement>('[data-update-message]').forEach((element) => { element.textContent = state.message; });
  document.querySelectorAll<HTMLElement>('[data-progress-track]').forEach((element) => { element.hidden = state.status !== 'downloading' && state.status !== 'downloaded'; });
  document.querySelectorAll<HTMLElement>('[data-progress-bar]').forEach((element) => { element.style.width = `${Math.min(100, Math.max(0, state.percent ?? 0))}%`; });
  document.querySelectorAll<HTMLButtonElement>('[data-update-action]').forEach((button) => {
    button.disabled = ['checking', 'available', 'downloading', 'not-configured'].includes(state.status);
    button.textContent = state.status === 'downloaded' ? 'Nainstalovat' : 'Zkontrolovat';
  });
  if (activeView === 'settings') void settings.load(campaigns, activeCampaignId, info, state);
}

function toggleCockpit(): void {
  if (isNarrow()) {
    cockpitDrawerOpen = !cockpitDrawerOpen;
  } else {
    uiState.cockpitVisible = !uiState.cockpitVisible;
  }
  updateCockpitVisibility();
  persistUiState();
}

function hideCockpit(): void {
  uiState.cockpitVisible = false;
  cockpitDrawerOpen = false;
  updateCockpitVisibility();
  persistUiState();
}

function showCockpit(): void {
  uiState.cockpitVisible = true;
  cockpitDrawerOpen = isNarrow();
  updateCockpitVisibility();
  persistUiState();
}

function updateCockpitVisibility(): void {
  const hasCharacter = Boolean(activeCampaign()?.runtime.activePlayerCharacterId);
  const play = activeView === 'play';
  const drawer = isNarrow() && cockpitDrawerOpen && hasCharacter && play;
  const visible = !isNarrow() && uiState.cockpitVisible && hasCharacter && play;
  cockpitPanel.classList.toggle('is-visible', visible);
  cockpitPanel.classList.toggle('is-drawer-open', drawer);
  cockpitRestore.hidden = !hasCharacter || !play || visible || drawer;
  shell.classList.toggle('has-cockpit', visible);
  shell.classList.toggle('has-cockpit-drawer', drawer);
}

function setupCockpitResize(): void {
  const resizer = requireElement<HTMLElement>('[data-cockpit-resizer]');
  let active = false;
  let width = 410;
  const resize = (clientX: number): void => {
    const maximum = Math.min(720, Math.max(300, window.innerWidth - 520));
    width = Math.min(maximum, Math.max(300, window.innerWidth - clientX));
    shell.style.setProperty('--cockpit-width', `${width}px`);
    resizer.setAttribute('aria-valuenow', String(Math.round(width)));
  };
  resizer.addEventListener('pointerdown', (event) => {
    if (isNarrow()) return;
    active = true;
    resizer.setPointerCapture(event.pointerId);
    resize(event.clientX);
  });
  resizer.addEventListener('pointermove', (event) => { if (active) resize(event.clientX); });
  resizer.addEventListener('pointerup', async (event) => {
    if (!active) return;
    active = false;
    resizer.releasePointerCapture(event.pointerId);
    try { await cockpit.setPanelWidth(width); } catch (error) { showToast(errorMessage(error), true); }
  });
  resizer.addEventListener('keydown', async (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = Number.parseInt(getComputedStyle(shell).getPropertyValue('--cockpit-width'), 10) || 410;
    width = current + (event.key === 'ArrowLeft' ? 20 : -20);
    resize(window.innerWidth - width);
    try { await cockpit.setPanelWidth(width); } catch (error) { showToast(errorMessage(error), true); }
  });
}

function activeCampaign(): RuntimeWorkspaceCampaign | null {
  return campaigns.find((item) => item.id === activeCampaignId) ?? null;
}

function persistUiState(): void {
  uiState.lastActiveCampaignId = activeCampaignId;
  uiState.lastView = activeView;
  uiStore.save(uiState);
}

function isNarrow(): boolean { return window.matchMedia('(max-width: 1100px)').matches; }

function showToast(message: string, error = false): void {
  const toast = requireElement<HTMLElement>('[data-app-toast]');
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle('is-error', error);
  window.setTimeout(() => { toast.hidden = true; }, 6000);
}

function navButton(view: AppView, icon: string, label: string): string {
  return `<button class="nav-item" type="button" data-nav-view="${view}" title="${escapeHtml(label)}"><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${escapeHtml(label)}</span></button>`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Chybí prvek ${selector}`);
  return element;
}
