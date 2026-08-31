import type {
  CharacterCockpitView,
  CharacterPanelSectionId,
  CockpitActionView,
  CockpitEffectView,
  CockpitResourceView,
  CockpitSpellSlotPoolView,
} from '../shared/read-models';
import { entityReference, errorMessage, escapeHtml, humanize, signed } from './html';

const sectionTitles: Record<CharacterPanelSectionId, string> = {
  actions: 'Akce',
  bonusActions: 'Bonusové akce',
  reactions: 'Reakce',
  features: 'Features',
  spells: 'Kouzla',
  spellSlots: 'Sesílací pozice',
  inventory: 'Inventář',
  defenses: 'Obrany',
  proficiencies: 'Proficiencies',
  languages: 'Jazyky',
  effects: 'Aktivní efekty',
  relationships: 'Vztahy',
  notes: 'Poznámky',
};

export class CharacterCockpitController {
  private view: CharacterCockpitView | null = null;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (event) => void this.onClick(event));
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-hp-delta], [data-temp-hp]')) {
        const command = (event.target as HTMLElement).matches('[data-hp-delta]') ? 'change-hp' : 'set-temp-hp';
        const button = root.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
        button?.click();
      }
    });
  }

  async load(characterId?: string): Promise<void> {
    this.root.innerHTML = loadingPanel();
    try {
      this.view = await window.chronicle.getCharacterCockpit(characterId);
      this.render();
    } catch (error) {
      this.renderFatal(error);
    }
  }

  private render(): void {
    if (!this.view) {
      this.root.style.removeProperty('--cockpit-width');
      this.root.innerHTML = emptyPanel();
      return;
    }
    const previousScroll = this.root.querySelector<HTMLElement>('.cockpit-scroll')?.scrollTop ?? 0;
    const view = this.view;
    this.root.style.setProperty('--cockpit-width', `${view.preferences.panelWidth}px`);
    this.root.innerHTML = `
      <div class="cockpit-layout">
        <header class="cockpit-identity">
          <div class="portrait-fallback" aria-hidden="true">${escapeHtml(view.identity.name.slice(0, 1))}</div>
          <div class="cockpit-name">
            <p>CHARACTER COCKPIT</p>
            <h2>${escapeHtml(view.identity.name)}</h2>
            <span>${escapeHtml(view.identity.classSummary || `Level ${view.identity.totalLevel}`)}</span>
            <div class="identity-links">
              ${view.identity.classes.map((characterClass) => entityReference(characterClass)).join('')}
              ${view.identity.species ? entityReference(view.identity.species) : ''}
              ${view.identity.background ? entityReference(view.identity.background) : ''}
              ${view.identity.currentLocation ? entityReference(view.identity.currentLocation) : ''}
            </div>
          </div>
          <button type="button" class="inspiration-button ${view.combat.inspiration ? 'is-active' : ''}"
            data-command="set-inspiration" aria-pressed="${view.combat.inspiration}"
            title="${view.combat.inspiration ? 'Použít inspiraci' : 'Udělit inspiraci'}">✦</button>
        </header>

        <section class="cockpit-vitals" aria-label="Bojové hodnoty">
          <div class="hp-block">
            <span>HP</span>
            <strong>${view.combat.hp.current} <i>/ ${view.combat.hp.maximum}</i></strong>
            ${view.combat.hp.temporary ? `<small>+${view.combat.hp.temporary} temp</small>` : ''}
          </div>
          ${stat('AC', String(view.combat.armorClass))}
          ${stat('INIT', signed(view.combat.initiative))}
          ${stat('PB', signed(view.combat.proficiencyBonus))}
          ${stat('SPEED', view.primaryMovement ? `${view.primaryMovement.distance} ${view.primaryMovement.unit}` : '—')}
        </section>

        <section class="quick-controls" aria-label="Rychlé úpravy">
          <label>Změna HP <input type="number" value="-1" step="1" data-hp-delta></label>
          <button type="button" data-command="change-hp">Použít</button>
          <label>Temp HP <input type="number" value="${view.combat.hp.temporary}" min="0" step="1" data-temp-hp></label>
          <button type="button" data-command="set-temp-hp">Nastavit</button>
        </section>

        <section class="ability-strip" aria-label="Vlastnosti">
          ${view.abilities.map((ability) => `
            <div title="${escapeHtml(humanize(ability.id))}: ${ability.score}">
              <span>${ability.abbreviation}</span><strong>${signed(ability.modifier)}</strong><small>${ability.score}</small>
            </div>
          `).join('')}
        </section>

        ${view.resources.length ? `
          <section class="core-resources" aria-label="Zdroje postavy">
            ${view.resources.map(resource).join('')}
          </section>
        ` : ''}

        ${(view.combat.hp.current === 0
          || view.combat.deathSaves.successes > 0
          || view.combat.deathSaves.failures > 0) ? `
          <section class="death-saves" aria-label="Death saves">
            <span>Death saves</span>
            <strong class="success">✓ ${view.combat.deathSaves.successes}</strong>
            <button type="button" data-command="death-success"
              ${view.combat.deathSaves.successes >= 3 ? 'disabled' : ''}>＋ úspěch</button>
            <strong class="failure">× ${view.combat.deathSaves.failures}</strong>
            <button type="button" data-command="death-failure"
              ${view.combat.deathSaves.failures >= 3 ? 'disabled' : ''}>＋ neúspěch</button>
          </section>
        ` : ''}

        ${view.concentration ? `
          <section class="concentration-banner">
            <span>◉ Soustředění</span>
            ${entityReference(view.concentration.card, 'concentration-reference')}
            <button type="button" data-command="end-concentration">Ukončit</button>
          </section>
        ` : ''}

        <div class="cockpit-error" role="alert" data-cockpit-error hidden></div>
        <div class="cockpit-scroll">
          ${view.preferences.sectionOrder.map((sectionId, index) => (
            this.renderSection(sectionId, index)
          )).join('')}
          <section class="rest-controls" aria-label="Odpočinek">
            <button type="button" data-command="short-rest">Krátký odpočinek</button>
            <button type="button" data-command="long-rest">Dlouhý odpočinek</button>
          </section>
          <section class="panel-settings" aria-label="Nastavení panelu">
            <span>Šířka panelu</span>
            <button type="button" data-command="resize" data-delta="-30" aria-label="Zúžit panel">−</button>
            <strong>${view.preferences.panelWidth}px</strong>
            <button type="button" data-command="resize" data-delta="30" aria-label="Rozšířit panel">＋</button>
          </section>
        </div>
      </div>
    `;
    const scroll = this.root.querySelector<HTMLElement>('.cockpit-scroll');
    if (scroll) scroll.scrollTop = previousScroll;
  }

  private renderSection(sectionId: CharacterPanelSectionId, index: number): string {
    if (!this.view) return '';
    const collapsed = this.view.preferences.collapsedSections.includes(sectionId);
    return `
      <section class="cockpit-section ${collapsed ? 'is-collapsed' : ''}" data-section="${sectionId}">
        <header>
          <button type="button" class="section-toggle" data-command="toggle-section"
            data-section-id="${sectionId}" aria-expanded="${!collapsed}">
            <span>${collapsed ? '›' : '⌄'}</span>${escapeHtml(sectionTitles[sectionId])}
          </button>
          <span class="section-order-controls">
            <button type="button" data-command="move-section" data-section-id="${sectionId}"
              data-delta="-1" ${index === 0 ? 'disabled' : ''} aria-label="Posunout nahoru">↑</button>
            <button type="button" data-command="move-section" data-section-id="${sectionId}"
              data-delta="1" ${index === this.view.preferences.sectionOrder.length - 1 ? 'disabled' : ''}
              aria-label="Posunout dolů">↓</button>
          </span>
        </header>
        ${collapsed ? '' : `<div class="section-content">${this.sectionContent(sectionId)}</div>`}
      </section>
    `;
  }

  private sectionContent(sectionId: CharacterPanelSectionId): string {
    if (!this.view) return '';
    switch (sectionId) {
      case 'actions': return actions(this.view.actions.filter((action) => action.actionType === 'action'));
      case 'bonusActions': return actions(this.view.actions.filter((action) => action.actionType === 'bonusAction'));
      case 'reactions': return actions(this.view.actions.filter((action) => action.actionType === 'reaction'));
      case 'features': return listOrEmpty(this.view.features.map((feature) => `
        <div class="reference-row">
          ${entityReference(feature.card)}
          ${feature.homebrew ? '<span class="mini-badge">HB</span>' : ''}
        </div>
      `));
      case 'spells': return listOrEmpty(this.view.spellcasting.spells.map((spell) => `
        <div class="reference-row spell-row">
          ${entityReference(spell.definition)}
          <span>${spell.level === 0 ? 'Cantrip' : `L${spell.level}`}</span>
          ${spell.prepared || spell.alwaysPrepared ? '<i title="Připravené">●</i>' : ''}
          ${spell.ritual ? '<i title="Rituál">R</i>' : ''}
          ${spell.concentration ? '<i title="Soustředění">C</i>' : ''}
        </div>
      `));
      case 'spellSlots': return listOrEmpty(this.view.spellcasting.slotPools.map(spellSlot));
      case 'inventory': return listOrEmpty(this.view.inventory.map((item) => `
        <div class="reference-row inventory-row">${entityReference(item.card)}<span>×${item.quantity}</span></div>
      `));
      case 'defenses': return listOrEmpty(this.view.defenses.map((defense) => `
        <div class="reference-row"><span class="defense-type">${escapeHtml(defense.defenseType)}</span>
          ${entityReference(defense.target)}</div>
      `));
      case 'proficiencies': return listOrEmpty(this.view.proficiencies.map((proficiency) => `
        <div class="plain-row"><span>${escapeHtml(proficiency.label)}</span>
          <small>${escapeHtml(proficiency.level)} · ${escapeHtml(proficiency.sourceLabel)}</small></div>
      `));
      case 'languages': return listOrEmpty(this.view.languages.map((language) => `
        <div class="plain-row"><span>${escapeHtml(language.label)}</span>
          <small>${escapeHtml(language.sourceLabel)}</small></div>
      `));
      case 'effects': return listOrEmpty(this.view.effects.map(effect));
      case 'relationships': return listOrEmpty(this.view.relationships.map((relationship) => {
        const otherId = relationship.sourceEntityId === this.view!.characterId
          ? relationship.targetEntityId
          : relationship.sourceEntityId;
        const otherName = relationship.sourceEntityId === this.view!.characterId
          ? relationship.targetName
          : relationship.sourceName;
        const otherType = relationship.sourceEntityId === this.view!.characterId
          ? relationship.targetEntityType
          : relationship.sourceEntityType;
        return `<div class="relationship-row">
          ${entityReference({ id: otherId, kind: otherType, label: otherName, subtitle: relationship.relationType, contextCharacterId: this.view!.characterId })}
          <p>${escapeHtml(relationship.currentSummary)}</p>
        </div>`;
      }));
      case 'notes': return notes(this.view.notes);
    }
  }

  private async onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-command]');
    if (!button || !this.view) return;
    const characterId = this.view.characterId;
    switch (button.dataset.command) {
      case 'change-hp': {
        const amount = this.numericInput('[data-hp-delta]');
        if (amount === null) return;
        await this.command(button, () => window.chronicle.changeHitPoints({ characterId, amount }));
        return;
      }
      case 'set-temp-hp': {
        const value = this.numericInput('[data-temp-hp]');
        if (value === null) return;
        await this.command(button, () => window.chronicle.setTemporaryHitPoints({ characterId, value }));
        return;
      }
      case 'set-inspiration':
        await this.command(button, () => window.chronicle.setInspiration({
          characterId,
          value: !this.view!.combat.inspiration,
        }));
        return;
      case 'spend-resource':
      case 'restore-resource': {
        const resourceId = button.dataset.resourceId ?? '';
        const operation = button.dataset.command === 'spend-resource'
          ? window.chronicle.spendResource({ characterId, resourceId, amount: 1 })
          : window.chronicle.restoreResource({ characterId, resourceId, amount: 1 });
        await this.command(button, () => operation);
        return;
      }
      case 'spend-slot':
      case 'restore-slot': {
        const poolId = button.dataset.poolId ?? '';
        const operation = button.dataset.command === 'spend-slot'
          ? window.chronicle.spendSpellSlot({ characterId, poolId })
          : window.chronicle.restoreSpellSlot({ characterId, poolId });
        await this.command(button, () => operation);
        return;
      }
      case 'end-concentration':
        await this.command(button, () => window.chronicle.endConcentration({ characterId }));
        return;
      case 'end-effect':
      case 'remove-condition': {
        const effectId = button.dataset.effectId ?? '';
        const operation = button.dataset.command === 'remove-condition'
          ? window.chronicle.removeCondition({ characterId, effectId })
          : window.chronicle.endEffect({ characterId, effectId });
        await this.command(button, () => operation);
        return;
      }
      case 'death-success':
      case 'death-failure':
        await this.command(button, () => window.chronicle.recordDeathSave({
          characterId,
          success: button.dataset.command === 'death-success',
        }));
        return;
      case 'short-rest':
      case 'long-rest': {
        const isLong = button.dataset.command === 'long-rest';
        if (!window.confirm(`${isLong ? 'Dlouhý' : 'Krátký'} odpočinek obnoví příslušné zdroje. Pokračovat?`)) return;
        await this.command(button, () => isLong
          ? window.chronicle.takeLongRest({ characterId })
          : window.chronicle.takeShortRest({ characterId }));
        return;
      }
      case 'toggle-section': {
        const sectionId = button.dataset.sectionId as CharacterPanelSectionId;
        const collapsed = new Set(this.view.preferences.collapsedSections);
        if (collapsed.has(sectionId)) collapsed.delete(sectionId); else collapsed.add(sectionId);
        await this.savePreferences(button, this.view.preferences.sectionOrder, [...collapsed], this.view.preferences.panelWidth);
        return;
      }
      case 'move-section': {
        const sectionId = button.dataset.sectionId as CharacterPanelSectionId;
        const order = [...this.view.preferences.sectionOrder];
        const from = order.indexOf(sectionId);
        const to = from + Number(button.dataset.delta);
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        await this.savePreferences(button, order, this.view.preferences.collapsedSections, this.view.preferences.panelWidth);
        return;
      }
      case 'resize': {
        const panelWidth = Math.min(720, Math.max(300, this.view.preferences.panelWidth + Number(button.dataset.delta)));
        await this.savePreferences(
          button,
          this.view.preferences.sectionOrder,
          this.view.preferences.collapsedSections,
          panelWidth,
        );
      }
    }
  }

  private async savePreferences(
    button: HTMLButtonElement,
    sectionOrder: readonly CharacterPanelSectionId[],
    collapsedSections: readonly CharacterPanelSectionId[],
    panelWidth: number,
  ): Promise<void> {
    if (!this.view) return;
    const { campaignId, characterId } = this.view;
    await this.command(button, () => window.chronicle.saveCharacterPanelPreferences({
      campaignId,
      characterId,
      sectionOrder,
      collapsedSections,
      panelWidth,
    }));
  }

  private async command(
    button: HTMLButtonElement,
    operation: () => Promise<CharacterCockpitView>,
  ): Promise<void> {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    this.hideError();
    try {
      this.view = await operation();
      this.render();
    } catch (error) {
      this.showError(errorMessage(error));
      try {
        this.view = await window.chronicle.getCharacterCockpit(this.view?.characterId);
      } catch {
        // The current DB state remains unknown; keep the visible values and error in place.
      }
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  private numericInput(selector: string): number | null {
    const input = this.root.querySelector<HTMLInputElement>(selector);
    const value = input?.valueAsNumber;
    if (value === undefined || !Number.isFinite(value)) {
      this.showError('Zadejte platné číslo.');
      input?.focus();
      return null;
    }
    return value;
  }

  private hideError(): void {
    const error = this.root.querySelector<HTMLElement>('[data-cockpit-error]');
    if (error) error.hidden = true;
  }

  private showError(message: string): void {
    const error = this.root.querySelector<HTMLElement>('[data-cockpit-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  private renderFatal(error: unknown): void {
    this.root.innerHTML = `
      <div class="cockpit-empty" role="alert">
        <strong>Panel se nepodařilo načíst</strong>
        <p>${escapeHtml(errorMessage(error))}</p>
        <button type="button" data-retry-cockpit>Zkusit znovu</button>
      </div>
    `;
    this.root.querySelector('[data-retry-cockpit]')?.addEventListener('click', () => void this.load());
  }
}

function loadingPanel(): string {
  return `
    <div class="cockpit-loading" aria-label="Načítám Character Cockpit">
      <span></span><span></span><span></span><span></span>
    </div>
  `;
}

function emptyPanel(): string {
  return `
    <div class="cockpit-empty">
      <span class="empty-d20">20</span>
      <strong>Character Cockpit</strong>
      <p>Jakmile bude v kampani postava, její aktuální stav se objeví tady.</p>
    </div>
  `;
}

function stat(label: string, value: string): string {
  return `<div class="vital-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function actions(values: CockpitActionView[]): string {
  return listOrEmpty(values.map((action) => `
    <div class="action-row">
      ${entityReference(action.card)}
      <div class="action-numbers">
        ${action.attackBonus ? `<b>${escapeHtml(action.attackBonus)}</b>` : ''}
        ${action.range ? `<span>${escapeHtml(action.range)}</span>` : ''}
        ${action.damage ? `<span>${escapeHtml(action.damage)}</span>` : ''}
        ${action.resourceCost ? `<small>${escapeHtml(action.resourceCost)}</small>` : ''}
      </div>
    </div>
  `));
}

function resource(resource: CockpitResourceView): string {
  const value = resource.display === 'pips'
    ? `<span class="pips" aria-label="${resource.current} z ${resource.maximum}">${Array.from(
      { length: resource.maximum },
      (_, index) => `<i class="${index < resource.current ? 'is-filled' : ''}"></i>`,
    ).join('')}</span>`
    : `<strong>${resource.current} / ${resource.maximum}${resource.display === 'dice' && resource.dieSize ? ` d${resource.dieSize}` : ''}</strong>`;
  return `
    <div class="resource-row">
      <div>${resource.source ? entityReference(resource.source) : `<span>${escapeHtml(resource.name)}</span>`}
        <small>${escapeHtml(resource.name)} · ${escapeHtml(resource.resetRule)}</small></div>
      ${value}
      <span class="stepper">
        <button type="button" data-command="spend-resource" data-resource-id="${escapeHtml(resource.id)}"
          ${resource.current === 0 ? 'disabled' : ''} aria-label="Spotřebovat ${escapeHtml(resource.name)}">−</button>
        <button type="button" data-command="restore-resource" data-resource-id="${escapeHtml(resource.id)}"
          ${resource.current === resource.maximum ? 'disabled' : ''} aria-label="Obnovit ${escapeHtml(resource.name)}">＋</button>
      </span>
    </div>
  `;
}

function spellSlot(pool: CockpitSpellSlotPoolView): string {
  const pact = pool.poolType.toLowerCase().includes('pact');
  return `
    <div class="resource-row ${pact ? 'is-pact' : ''}">
      <div><span>${pact ? 'Pact Magic' : `${pool.slotLevel}. úroveň`}</span>
        <small>${escapeHtml(pool.sourceLabel ?? pool.poolType)} · ${escapeHtml(pool.resetRule)}</small></div>
      <span class="pips" aria-label="${pool.current} z ${pool.maximum}">${Array.from(
        { length: pool.maximum },
        (_, index) => `<i class="${index < pool.current ? 'is-filled' : ''}"></i>`,
      ).join('')}</span>
      <span class="stepper">
        <button type="button" data-command="spend-slot" data-pool-id="${escapeHtml(pool.id)}"
          ${pool.current === 0 ? 'disabled' : ''} aria-label="Spotřebovat sesílací pozici">−</button>
        <button type="button" data-command="restore-slot" data-pool-id="${escapeHtml(pool.id)}"
          ${pool.current === pool.maximum ? 'disabled' : ''} aria-label="Obnovit sesílací pozici">＋</button>
      </span>
    </div>
  `;
}

function effect(value: CockpitEffectView): string {
  return `
    <div class="effect-row ${value.concentration ? 'is-concentration' : ''}">
      ${entityReference(value.card)}
      <small>${escapeHtml(value.durationLabel)}</small>
      <button type="button" data-command="${value.condition ? 'remove-condition' : 'end-effect'}"
        data-effect-id="${escapeHtml(value.id)}">Ukončit</button>
    </div>
  `;
}

function notes(value: CharacterCockpitView['notes']): string {
  const entries: Array<[string, string | number | null]> = [
    ['Věk', value.age],
    ['Přesvědčení', value.alignment],
    ['Vzhled', value.appearance],
    ['Životopis', value.biography],
    ['Povahové rysy', value.personalityTraits],
    ['Ideály', value.ideals],
    ['Pouta', value.bonds],
    ['Slabiny', value.flaws],
    ['Poznámky', value.notes],
  ];
  return listOrEmpty(entries.filter(([, item]) => item !== null && item !== '').map(([label, item]) => `
    <div class="note-row"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(item)}</p></div>
  `));
}

function listOrEmpty(rows: string[]): string {
  return rows.length ? rows.join('') : '<p class="section-empty">Zatím nic.</p>';
}
