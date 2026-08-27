import './styles.css';
import type { BootstrapInfo, UpdateState } from '../shared/contracts';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('Kořen aplikace nebyl nalezen.');
}

appRoot.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" aria-label="Hlavní navigace">
      <div class="brand-mark" aria-hidden="true">D20</div>
      <div class="brand-copy">
        <span>D&amp;D</span>
        <strong>Chronicle</strong>
      </div>
      <nav>
        <button class="nav-item is-active" type="button">
          <span class="nav-icon">⌂</span>
          Přehled
        </button>
        <button class="nav-item" type="button" disabled>
          <span class="nav-icon">◇</span>
          Kampaně
        </button>
        <button class="nav-item" type="button" disabled>
          <span class="nav-icon">⌁</span>
          Knihovna
        </button>
      </nav>
      <div class="sidebar-foot">
        <span class="status-dot"></span>
        Lokální režim
      </div>
    </aside>

    <main>
      <header class="topbar">
        <div>
          <p class="eyebrow">NOVÝ ZAČÁTEK</p>
          <h1>D&amp;D Chronicle <span>vNext</span></h1>
        </div>
        <div class="version-pill">verze <span data-app-version>…</span></div>
      </header>

      <section class="hero">
        <div class="hero-copy">
          <p class="hero-kicker">Základ je připraven</p>
          <h2>Vaše příběhy mají konečně pevný domov.</h2>
          <p>
            Prázdná Chronicle běží nad lokální, verzovanou databází. Aplikace a vaše
            kampaně jsou oddělené, takže další aktualizace mohou přijít bez ZIPového cirkusu.
          </p>
          <button class="primary-button" type="button" disabled>
            <span>＋</span> Nová kampaň
            <small>v příštím milníku</small>
          </button>
        </div>
        <div class="sigil" aria-hidden="true">
          <div class="sigil-ring"><span>20</span></div>
        </div>
      </section>

      <section class="system-grid" aria-label="Stav systému">
        <article class="system-card">
          <div class="card-icon database-icon">▤</div>
          <div>
            <p class="card-label">LOKÁLNÍ DATA</p>
            <h3>Databáze je připravená</h3>
            <p><span data-campaign-count>0</span> kampaní · schéma v<span data-schema-version>…</span></p>
            <p class="path" data-database-path title="">Načítám umístění…</p>
          </div>
          <span class="checkmark" aria-label="V pořádku">✓</span>
        </article>

        <article class="system-card update-card">
          <div class="card-icon update-icon">↻</div>
          <div class="grow">
            <p class="card-label">AKTUALIZACE</p>
            <h3 data-update-heading>Připravuji updater…</h3>
            <p data-update-message>Načítám stav release kanálu.</p>
            <div class="progress-track" data-progress-track hidden>
              <div class="progress-bar" data-progress-bar></div>
            </div>
          </div>
          <button class="secondary-button" type="button" data-update-action>Kontrola</button>
        </article>

        <article class="system-card compact-card">
          <div class="card-icon shield-icon">◆</div>
          <div>
            <p class="card-label">ODDĚLENÁ DATA</p>
            <h3>Bezpečné aktualizace</h3>
            <p>Instalace ani update nesahají na kampaně.</p>
          </div>
        </article>
      </section>

      <footer>
        <span>Chronicle Engine · foundation milestone</span>
        <span class="footer-ready"><i></i> systém připraven</span>
      </footer>
    </main>
  </div>
`;

const updateButton = requireElement<HTMLButtonElement>('[data-update-action]');
let latestUpdateState: UpdateState;

void loadBootstrap();
window.chronicle.onUpdateState(renderUpdateState);

updateButton.addEventListener('click', async () => {
  if (latestUpdateState?.status === 'downloaded') {
    updateButton.disabled = true;
    updateButton.textContent = 'Restartuji…';
    await window.chronicle.installUpdate();
    return;
  }

  updateButton.disabled = true;
  await window.chronicle.checkForUpdates();
});

async function loadBootstrap(): Promise<void> {
  try {
    const info = await window.chronicle.getBootstrap();
    renderBootstrap(info);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderUpdateState({ status: 'error', message: `Aplikaci se nepodařilo načíst: ${message}` });
  }
}

function renderBootstrap(info: BootstrapInfo): void {
  setText('[data-app-version]', info.appVersion);
  setText('[data-schema-version]', String(info.storage.schemaVersion));
  setText('[data-campaign-count]', String(info.storage.campaignCount));
  const pathElement = requireElement<HTMLElement>('[data-database-path]');
  pathElement.textContent = info.storage.databasePath;
  pathElement.title = info.storage.databasePath;
  renderUpdateState(info.update);
}

function renderUpdateState(state: UpdateState): void {
  latestUpdateState = state;
  const heading: Record<UpdateState['status'], string> = {
    'not-configured': 'Release kanál čeká na repozitář',
    idle: 'Automatické aktualizace jsou zapnuté',
    checking: 'Kontroluji novou verzi',
    available: `Nalezena verze ${state.availableVersion ?? ''}`,
    downloading: 'Stahuji aktualizaci',
    downloaded: 'Aktualizace je připravená',
    'up-to-date': 'Aplikace je aktuální',
    error: 'Kontrola se nezdařila',
  };

  setText('[data-update-heading]', heading[state.status]);
  setText('[data-update-message]', state.message);

  const progressTrack = requireElement<HTMLElement>('[data-progress-track]');
  const progressBar = requireElement<HTMLElement>('[data-progress-bar]');
  const hasProgress = state.status === 'downloading' || state.status === 'downloaded';
  progressTrack.hidden = !hasProgress;
  progressBar.style.width = `${Math.min(100, Math.max(0, state.percent ?? 0))}%`;

  updateButton.disabled = ['checking', 'available', 'downloading', 'not-configured'].includes(state.status);
  updateButton.textContent = state.status === 'downloaded' ? 'Nainstalovat' : 'Kontrola';
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Chybí prvek ${selector}`);
  }
  return element;
}
