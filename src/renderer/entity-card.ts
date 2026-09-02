import type { EntityCardRequest, EntityCardView, EntitySummary } from '../shared/read-models';
import { entityReference, errorMessage, escapeHtml, humanize } from './html';

interface EntityCardActions {
  editCharacter?(characterId: string): void;
  editHomebrewDefinition?(definition: Extract<EntityCardView, { cardType: 'definition' }>): void;
}

export class EntityCardHost {
  private readonly stack: EntityCardRequest[] = [];
  private returnFocus: HTMLElement | null = null;
  private currentCard: EntityCardView | null = null;

  constructor(private readonly dialog: HTMLDialogElement, private readonly actions: EntityCardActions = {}) {
    document.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-entity-id]');
      if (!target) return;
      event.preventDefault();
      void this.open({
        id: target.dataset.entityId ?? '',
        kind: target.dataset.entityKind as EntityCardRequest['kind'],
        ...(target.dataset.characterContext
          ? { characterId: target.dataset.characterContext }
          : {}),
      }, target);
    });
    this.dialog.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-card-action]');
      if (!button) return;
      if (button.dataset.cardAction === 'close') this.dialog.close();
      if (button.dataset.cardAction === 'edit-character' && this.currentCard?.cardType === 'character') {
        const characterId = this.currentCard.id;
        this.dialog.close();
        this.actions.editCharacter?.(characterId);
      }
      if (button.dataset.cardAction === 'edit-homebrew' && this.currentCard?.cardType === 'definition' && this.currentCard.homebrew) {
        const definition = this.currentCard;
        this.dialog.close();
        this.actions.editHomebrewDefinition?.(definition);
      }
      if (button.dataset.cardAction === 'back' && this.stack.length > 1) {
        this.stack.pop();
        void this.load(this.stack.at(-1)!);
      }
    });
    this.dialog.addEventListener('close', () => {
      this.stack.length = 0;
      this.currentCard = null;
      this.returnFocus?.focus();
      this.returnFocus = null;
    });
  }

  private async open(request: EntityCardRequest, origin: HTMLElement): Promise<void> {
    if (!request.id) return;
    if (!this.dialog.open) {
      this.returnFocus = origin;
      this.dialog.showModal();
    }
    if (this.stack.at(-1)?.id !== request.id) this.stack.push(request);
    await this.load(request);
  }

  private async load(request: EntityCardRequest): Promise<void> {
    this.currentCard = null;
    this.dialog.setAttribute('aria-busy', 'true');
    this.dialog.innerHTML = cardShell('<div class="card-loading">Načítám kartu…</div>', this.stack.length > 1);
    try {
      const card = await window.chronicle.getEntityCard(request);
      this.currentCard = card;
      this.dialog.innerHTML = cardShell(renderCard(card), this.stack.length > 1);
      this.dialog.querySelector<HTMLElement>('[data-card-heading]')?.focus();
    } catch (error) {
      this.dialog.innerHTML = cardShell(`
        <div class="card-error" role="alert">
          Kartu se nepodařilo otevřít. ${escapeHtml(errorMessage(error))}
        </div>
      `, this.stack.length > 1);
    } finally {
      this.dialog.removeAttribute('aria-busy');
    }
  }
}

function cardShell(content: string, canGoBack: boolean): string {
  return `
    <div class="entity-card-shell">
      <header class="entity-card-toolbar">
        <button type="button" class="card-icon-button" data-card-action="back"
          ${canGoBack ? '' : 'disabled'} aria-label="Zpět">←</button>
        <span>ENTITY CARD</span>
        <button type="button" class="card-icon-button" data-card-action="close" aria-label="Zavřít">×</button>
      </header>
      <div class="entity-card-scroll">${content}</div>
    </div>
  `;
}

function renderCard(card: EntityCardView): string {
  const badges: string[] = [card.kind];
  if ('homebrew' in card && card.homebrew) badges.push('Homebrew');
  const facts = cardFacts(card);
  const related = collectReferences(card);
  return `
    <article class="entity-card">
      <p class="card-kind">${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</p>
      <h2 tabindex="-1" data-card-heading>${escapeHtml(card.name)}</h2>
      ${cardActions(card)}
      ${card.description
        ? `<p class="card-description">${escapeHtml(card.description)}</p>`
        : '<p class="card-description is-muted">Bez popisu.</p>'}
      ${facts.length ? `
        <dl class="card-facts">
          ${facts.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
          `).join('')}
        </dl>
      ` : ''}
      ${renderDndpediaContent(card)}
      ${renderCharacterState(card)}
      ${renderLinkedState(card)}
      ${renderRelationships(card)}
      ${related.length ? `
        <section class="card-related">
          <h3>Související</h3>
          <div>${related.map((reference) => entityReference(reference)).join('')}</div>
        </section>
      ` : ''}
    </article>
  `;
}

function cardActions(card: EntityCardView): string {
  if (card.cardType === 'character') {
    return '<p class="card-edit-actions"><button type="button" data-card-action="edit-character">Upravit postavu</button></p>';
  }
  if (card.cardType === 'definition' && card.homebrew) {
    return '<p class="card-edit-actions"><button type="button" data-card-action="edit-homebrew">Upravit Homebrew</button></p>';
  }
  return '';
}

function cardFacts(card: EntityCardView): Array<[string, string]> {
  switch (card.cardType) {
    case 'definition':
      if (card.dndpedia) return [
        ['Canonical ID', card.dndpedia.canonicalId],
        ...card.dndpedia.content.facts.map((item) => [item.label, item.value] as [string, string]),
      ];
      return [
        ['Zdroj', card.source],
        ['Původ', card.origin],
        ...recordFacts(card.metadata ?? {}),
      ];
    case 'feature':
      return [['Zdroj', card.sourceLabel], ['Stav', card.enabled ? 'Aktivní' : 'Neaktivní']];
    case 'item':
      return [
        ['Množství', String(card.quantity)],
        ['Umístění', card.placementLabel],
        ...(card.aliases.length ? [['Alias', card.aliases.join(', ')] as [string, string]] : []),
      ];
    case 'location':
      return [['Typ', card.locationType], ['Cesta', card.fullPath]];
    case 'character':
      return [
        ['Typ', card.characterType],
        ...(card.fullName ? [['Celé jméno', card.fullName] as [string, string]] : []),
        ...(card.relationshipSummary.length
          ? [['Vztahy', card.relationshipSummary.join(' · ')] as [string, string]]
          : []),
      ];
    case 'creature':
      return [
        ['Stav', card.currentLifeStateId.replace('life_state_', '')],
        ...(card.relationshipSummary.length
          ? [['Vztahy', card.relationshipSummary.join(' · ')] as [string, string]]
          : []),
      ];
    case 'effect':
      return [
        ['Stav', card.active ? 'Aktivní' : 'Ukončený'],
        ['Trvání', card.durationLabel],
        ['Soustředění', card.concentration ? 'Ano' : 'Ne'],
      ];
    case 'action':
      return [['Typ akce', humanize(card.actionType)], ...recordFacts(card.mechanics)];
    case 'event':
      return [
        ['Typ události', humanize(card.eventType)],
        ['Pořadí', String(card.sequence)],
        ...(card.sourceMessageId ? [['Zdrojová zpráva', card.sourceMessageId] as [string, string]] : []),
      ];
  }
}

function renderCharacterState(card: EntityCardView): string {
  if (card.cardType !== 'definition' || !card.characterState) return '';
  return `
    <section class="card-related">
      <h3>Pro tuto postavu</h3>
      <dl class="card-facts compact">
        ${recordFacts(card.characterState).map(([label, value]) => `
          <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
        `).join('')}
      </dl>
    </section>
  `;
}

function renderLinkedState(card: EntityCardView): string {
  if (card.cardType !== 'definition' && card.cardType !== 'feature') return '';
  const resources = card.linkedResources;
  const actions = card.linkedActions;
  if (!resources.length && !actions.length) return '';
  return `
    <section class="card-related">
      <h3>Navázaný stav</h3>
      ${resources.map((resource) => `
        <p>${escapeHtml(resource.name)} <strong>${resource.current} / ${resource.maximum}</strong></p>
      `).join('')}
      ${actions.map((action) => entityReference(action.card)).join('')}
    </section>
  `;
}

function renderDndpediaContent(card: EntityCardView): string {
  if (card.cardType !== 'definition' || !card.dndpedia) return '';
  const detail = card.dndpedia;
  return `
    ${detail.fullDescription ? `<section class="card-related"><h3>Úplný popis</h3><p>${escapeHtml(detail.fullDescription)}</p></section>` : ''}
    ${detail.content.sections.map((section) => `<section class="card-related"><h3>${escapeHtml(section.title)}</h3>
      ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('')}
    <section class="card-related card-source-block"><h3>Zdroj</h3>
      <p>${escapeHtml(detail.source.packDisplayName)} · pack ${escapeHtml(detail.source.packVersion)}</p>
      <small>${escapeHtml(detail.source.locale)} · ${escapeHtml(detail.source.license)}</small>
    </section>
  `;
}

function renderRelationships(card: EntityCardView): string {
  if (card.cardType !== 'character' && card.cardType !== 'creature') return '';
  if (!card.relationships.length) return '';
  return `<section class="card-related relationship-details">
    <h3>Vztahy</h3>
    ${card.relationships.map((relationship) => {
      const otherIsSource = relationship.targetEntityId === card.id;
      const other: EntitySummary = {
        id: otherIsSource ? relationship.sourceEntityId : relationship.targetEntityId,
        kind: otherIsSource ? relationship.sourceEntityType : relationship.targetEntityType,
        label: otherIsSource ? relationship.sourceName : relationship.targetName,
        subtitle: relationship.relationType,
      };
      return `<article>
        ${entityReference(other)}
        <p>${escapeHtml(relationship.currentSummary)}</p>
        ${relationship.historySummary ? `<small>${escapeHtml(relationship.historySummary)}</small>` : ''}
        <div class="relationship-events">${relationship.eventReferences.map((reference) => entityReference({
          id: reference.eventId,
          kind: 'Event',
          label: `#${reference.eventSequence}`,
          subtitle: reference.summary,
        })).join('')}</div>
      </article>`;
    }).join('')}
  </section>`;
}

function collectReferences(card: EntityCardView): EntitySummary[] {
  const values = [...card.references];
  if (card.cardType === 'definition' && card.dndpedia) {
    values.push(...card.dndpedia.relatedDefinitions.map((reference) => ({
      id: reference.definitionId,
      kind: reference.definitionType as EntitySummary['kind'],
      label: reference.name,
      subtitle: reference.relationDisplayName,
    })));
  }
  if (card.cardType === 'item' && card.effectiveLocation) values.push(card.effectiveLocation);
  if (card.cardType === 'location') values.push(...card.children);
  if (card.cardType === 'event' && card.location) values.push(card.location);
  if (card.cardType === 'character' || card.cardType === 'creature') {
    if (card.cardType === 'character' && card.species) values.push(card.species);
    if (card.currentLocation) values.push(card.currentLocation);
    for (const relationship of card.relationships) {
      const otherIsSource = relationship.targetEntityId === card.id;
      values.push({
        id: otherIsSource ? relationship.sourceEntityId : relationship.targetEntityId,
        kind: otherIsSource ? relationship.sourceEntityType : relationship.targetEntityType,
        label: otherIsSource ? relationship.sourceName : relationship.targetName,
        subtitle: relationship.relationType,
      });
    }
  }
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function recordFacts(value: Readonly<Record<string, unknown>>): Array<[string, string]> {
  return Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .slice(0, 12)
    .map(([key, item]) => [humanize(key), displayValue(item)]);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ano' : 'Ne';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => displayValue(item)).join(', ');
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${humanize(key)}: ${displayValue(item)}`)
    .join(' · ');
}
