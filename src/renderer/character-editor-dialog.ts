import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';
import type {
  CharacterDraft,
  CharacterEditorView,
  RuleReconciliationSuggestion,
} from '../shared/editable-domain';
import type { RuleDefinition } from '../domain/character-models';
import { errorMessage, escapeHtml } from './html';

type EditorMode = 'quick' | 'advanced';

export class CharacterEditorDialog {
  private dirty = false;

  constructor(private readonly dialog: HTMLDialogElement) {}

  async open(
    campaign: RuntimeWorkspaceCampaign,
    characterId: string | null,
    mode: EditorMode,
  ): Promise<CharacterEditorView | null> {
    const [view, catalog, reconciliations] = await Promise.all([
      characterId ? window.chronicle.getCharacterEditor(characterId) : Promise.resolve(null),
      window.chronicle.searchRuleDefinitions({
        campaignId: campaign.id,
        rulesetId: campaign.rulesetId,
        rulesetVersion: campaign.rulesetVersion,
        definitionTypes: ['Species', 'Race', 'Lineage', 'Subrace', 'Background', 'Class', 'Subclass', 'Skill', 'Language', 'Feat', 'Feature', 'Spell'],
        includeBuiltIn: true,
        includeHomebrew: true,
        limit: 200,
      }),
      characterId
        ? window.chronicle.getRuleReconciliationSuggestions({ campaignId: campaign.id, characterId })
        : Promise.resolve([]),
    ]);
    if (characterId && !view) throw new Error('Postava už neexistuje.');
    if (this.dialog.open) this.dialog.close();
    this.dirty = false;
    this.dialog.classList.add('character-editor-dialog');
    this.dialog.innerHTML = shell(campaign, view, catalog.items, reconciliations, mode);
    this.dialog.showModal();

    return new Promise<CharacterEditorView | null>((resolve) => {
      let settled = false;
      let savedResult: CharacterEditorView | null = null;
      const finish = (value: CharacterEditorView | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const close = (): void => {
        if (this.dirty && !window.confirm('Zahodit neuložené změny postavy?')) return;
        this.dirty = false;
        this.dialog.close();
      };
      this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, { once: true });
      this.dialog.addEventListener('close', () => {
        this.dialog.classList.remove('character-editor-dialog');
        finish(savedResult);
      }, { once: true });
      this.dialog.querySelectorAll<HTMLElement>('[data-editor-cancel]').forEach((button) => button.addEventListener('click', close));
      const form = this.dialog.querySelector<HTMLFormElement>('form')!;
      form.addEventListener('input', () => { this.dirty = true; });
      form.addEventListener('change', () => { this.dirty = true; });
      this.dialog.querySelectorAll<HTMLButtonElement>('[data-reconcile-index]').forEach((button) => {
        button.addEventListener('click', async () => {
          const suggestion = reconciliations[Number(button.dataset.reconcileIndex)];
          if (!suggestion || !window.confirm(`Nahradit „${suggestion.oldDefinition.name}“ kanonickou definicí „${suggestion.suggestedDefinition.name}“?`)) return;
          button.disabled = true;
          try {
            await window.chronicle.applyRuleReconciliation(suggestion);
            button.closest('li')?.remove();
          } catch (error) {
            showError(form, errorMessage(error));
            button.disabled = false;
          }
        });
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector<HTMLButtonElement>('[data-editor-submit]')!;
        const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
        clearErrors(form);
        try {
          const draft = draftFromForm(campaign, view, catalog.items, form, mode);
          fieldset.disabled = true;
          submit.textContent = 'Ukládám…';
          const saved = await window.chronicle.saveCharacterDraft(draft);
          this.dirty = false;
          savedResult = saved.view;
          this.dialog.close();
        } catch (error) {
          showError(form, errorMessage(error));
          fieldset.disabled = false;
          submit.textContent = view ? 'Uložit změny' : 'Vytvořit postavu';
        }
      });
      requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[name="name"]')?.focus());
    });
  }
}

function shell(
  campaign: RuntimeWorkspaceCampaign,
  view: CharacterEditorView | null,
  definitions: readonly RuleDefinition[],
  reconciliations: readonly RuleReconciliationSuggestion[],
  mode: EditorMode,
): string {
  const bio = view?.biography ?? emptyBiography();
  const origin = view?.origin ?? { speciesId: null, lineageId: null, backgroundId: null };
  const advanced = mode === 'advanced';
  return `<form class="character-editor-shell">
    <header><div><p>${view ? 'CHARACTER EDITOR 2.0' : 'CHARACTER BUILDER 2.0'}</p>
      <h2>${view ? `Upravit ${escapeHtml(view.character.name)}` : 'Nová hráčská postava'}</h2>
      <span>${escapeHtml(campaign.name)} · ${escapeHtml(campaign.rulesetId)} ${escapeHtml(campaign.rulesetVersion)}</span></div>
      <button type="button" data-editor-cancel aria-label="Zavřít">×</button></header>
    <fieldset><div class="character-editor-scroll">
      ${reconciliationSection(reconciliations)}
      <section class="editor-section"><h3>Identita</h3><div class="editor-grid">
        ${field('name', 'Jméno', view?.character.name ?? '', true)}
        ${field('fullName', 'Celé jméno', view?.character.fullName ?? '')}
        ${selectField('characterType', 'Typ', view?.character.characterType ?? 'PC', [['PC', 'Hráčská postava'], ['NPC', 'NPC']])}
      </div>${advanced ? textarea('description', 'Krátký popis', view?.character.description ?? '') : ''}</section>
      <section class="editor-section"><h3>Původ a povolání</h3><div class="editor-grid">
        ${definitionField('species', 'Druh / rasa', definitionName(origin.speciesId, definitions), definitions, ['Species', 'Race'])}
        ${advanced ? definitionField('lineage', 'Rod / poddruh', definitionName(origin.lineageId, definitions), definitions, ['Lineage', 'Subrace']) : ''}
        ${definitionField('background', 'Zázemí', definitionName(origin.backgroundId, definitions), definitions, ['Background'])}
      </div>
      ${advanced
        ? textarea('classes', 'Povolání a multiclass (jeden řádek: Povolání | úroveň | Podtřída)', classLines(view, definitions))
        : `<div class="editor-grid">${definitionField('className', 'Povolání', definitionName(view?.classes[0]?.classId ?? null, definitions), definitions, ['Class'], true)}${numberField('level', 'Úroveň', view?.classes[0]?.level ?? 1, 1, 20)}</div>`}
      <label class="editor-checkbox"><input type="checkbox" name="allowHomebrew"> <span>Neznámé názvy vytvořit jako Homebrew této kampaně</span></label>
      <p class="editor-hint">Začněte psát do pole a vyberte položku katalogu. Homebrew vznikne jen s výslovně zaškrtnutou volbou.</p></section>
      ${advanced ? advancedSections(view, bio, definitions) : ''}
      <p class="dialog-error" data-editor-error role="alert" hidden></p>
    </div><footer><span>Změny se uloží atomicky a nevytvoří příběhovou událost.</span>
      <div><button type="button" data-editor-cancel>Zrušit</button>
      <button type="submit" class="primary-button" data-editor-submit>${view ? 'Uložit změny' : 'Vytvořit postavu'}</button></div></footer></fieldset>
  </form>`;
}

function advancedSections(
  view: CharacterEditorView | null,
  bio: CharacterDraft['biography'] | CharacterEditorView['biography'],
  definitions: readonly RuleDefinition[],
): string {
  return `<section class="editor-section"><h3>Vlastnosti</h3><div class="ability-grid">
    ${abilities(view).map(([id, label, score]) => numberField(`ability_${id}`, label, score, 1, 30)).join('')}
  </div></section>
  <section class="editor-section"><h3>Biografie a vzhled</h3><div class="editor-grid">
    ${numberField('age', 'Věk', bio.age ?? '', 0, 10000)}${field('birthDate', 'Datum narození', bio.birthDate ?? '')}
    ${field('genderId', 'Gender', bio.genderId ?? '')}${field('alignment', 'Přesvědčení', bio.alignment ?? '')}
    ${field('height', 'Výška', bio.height ?? '')}${field('weight', 'Váha', bio.weight ?? '')}
    ${field('eyes', 'Oči', bio.eyes ?? '')}${field('hair', 'Vlasy', bio.hair ?? '')}${field('skin', 'Pleť', bio.skin ?? '')}
  </div>${textarea('appearance', 'Vzhled', bio.appearance ?? '')}${textarea('biography', 'Životopis', bio.biography ?? '')}</section>
  <section class="editor-section"><h3>Osobnost</h3><div class="editor-grid editor-grid-textareas">
    ${textarea('personalityTraits', 'Rysy osobnosti', bio.personalityTraits ?? '')}${textarea('ideals', 'Ideály', bio.ideals ?? '')}
    ${textarea('bonds', 'Pouta', bio.bonds ?? '')}${textarea('flaws', 'Slabiny', bio.flaws ?? '')}
  </div></section>
  <section class="editor-section"><h3>Zdatnosti a jazyky</h3>
    ${textarea('skills', 'Dovednosti (oddělené čárkou)', proficiencyNames(view, definitions, false))}
    ${textarea('languages', 'Jazyky (oddělené čárkou)', proficiencyNames(view, definitions, true))}</section>
  <section class="editor-section"><h3>Schopnosti, kouzlení a poznámky</h3>
    ${textarea('features', 'Featy / schopnosti (oddělené čárkou)', featureNames(view, definitions))}
    <div class="editor-grid">${selectField('spellAbility', 'Sesílací vlastnost', view?.spellcastingSources[0]?.spellcastingAbilityId ?? 'intelligence', [
      ['intelligence', 'Inteligence'], ['wisdom', 'Moudrost'], ['charisma', 'Charisma'],
    ])}</div>
    ${textarea('spells', 'Kouzla (oddělená čárkou)', spellNames(view, definitions))}
    ${textarea('notes', 'Poznámky', bio.notes ?? '')}</section>`;
}

function reconciliationSection(suggestions: readonly RuleReconciliationSuggestion[]): string {
  if (!suggestions.length) return '';
  return `<section class="editor-reconciliation"><h3>Nalezené kanonické shody</h3>
    <p>Staré Homebrew odkazy zůstávají beze změny, dokud je výslovně nepotvrdíte.</p><ul>
    ${suggestions.map((item, index) => `<li><span><strong>${escapeHtml(item.oldDefinition.name)}</strong>
      → ${escapeHtml(item.suggestedDefinition.name)} <small>${escapeHtml(item.category)}</small></span>
      <button type="button" data-reconcile-index="${index}">Spárovat</button></li>`).join('')}</ul></section>`;
}

function draftFromForm(
  campaign: RuntimeWorkspaceCampaign,
  view: CharacterEditorView | null,
  definitions: readonly RuleDefinition[],
  form: HTMLFormElement,
  mode: EditorMode,
): CharacterDraft {
  const values = new FormData(form);
  const text = (name: string): string => String(values.get(name) ?? '').trim();
  const nullable = (name: string): string | null => text(name) || null;
  const name = text('name');
  if (!name) throw new Error('Zadejte jméno postavy.');
  const allowHomebrew = values.has('allowHomebrew');
  const homebrewDefinitions: NonNullable<CharacterDraft['homebrewDefinitions']>[number][] = [];
  const resolve = (value: string, types: readonly string[], required = false): string | null => {
    if (!value.trim()) {
      if (required) throw new Error(`Vyberte položku typu ${types.join(' / ')}.`);
      return null;
    }
    const normalized = normalize(value);
    const match = definitions.find((definition) => (
      types.includes(definition.definitionType)
      && [definition.name, ...definition.aliases, definition.id].some((candidate) => normalize(candidate) === normalized)
    ));
    if (match) return match.id;
    if (!allowHomebrew) throw new Error(`„${value}“ není v katalogu. Vyberte nalezenou položku nebo povolte Homebrew.`);
    const id = createId('def');
    homebrewDefinitions.push({ id, definitionType: types[0]!, name: value.trim(), description: '', aliases: [] });
    return id;
  };
  const classes = mode === 'quick'
    ? [{
      id: view?.classes[0]?.id ?? createId('class'),
      classId: resolve(text('className'), ['Class'], true)!,
      subclassId: null,
      level: integer(text('level'), 1, 20, 'Úroveň'),
    }]
    : parseLines(text('classes')).map((line, index) => {
      const [className, rawLevel, subclassName] = line.split('|').map((part) => part.trim());
      return {
        id: view?.classes[index]?.id ?? createId('class'),
        classId: resolve(className ?? '', ['Class'], true)!,
        subclassId: resolve(subclassName ?? '', ['Subclass']),
        level: integer(rawLevel ?? '1', 1, 20, `Úroveň na řádku ${index + 1}`),
      };
    });
  if (!classes.length) throw new Error('Postava musí mít alespoň jedno povolání.');
  const bio = view?.biography ?? { characterId: '', ...emptyBiography() };
  const abilitiesDraft = abilities(view).map(([abilityId, , score]) => ({
    abilityId,
    baseScore: mode === 'advanced' ? integer(text(`ability_${abilityId}`), 1, 30, abilityId) : score,
    permanentModifier: view?.abilities.find((item) => item.abilityId === abilityId)?.permanentModifier ?? 0,
    overrideScore: view?.abilities.find((item) => item.abilityId === abilityId)?.overrideScore ?? null,
  }));
  const proficiencies = mode === 'advanced'
    ? [
      ...list(text('skills')).map((value, index) => {
        const target = resolve(value, ['Skill', 'Proficiency']);
        return {
          id: view?.proficiencies.filter((item) => item.category !== 'language')[index]?.id ?? createId('proficiency'),
          category: 'skill' as const,
          targetDefinitionId: target,
          customTarget: target ? null : value,
          level: 'proficient' as const,
        };
      }),
      ...list(text('languages')).map((value, index) => {
        const target = resolve(value, ['Language']);
        return {
          id: view?.proficiencies.filter((item) => item.category === 'language')[index]?.id ?? createId('proficiency'),
          category: 'language' as const,
          targetDefinitionId: target,
          customTarget: target ? null : value,
          level: 'proficient' as const,
        };
      }),
    ] : view?.proficiencies.map(stripProficiency) ?? [];
  const features = mode === 'advanced'
    ? list(text('features')).map((value, index) => {
      const definitionId = resolve(value, ['Feat', 'Feature']);
      return {
        id: view?.features[index]?.id ?? createId('feature'),
        definitionId,
        customName: definitionId ? null : value,
        customDescription: view?.features[index]?.customDescription ?? null,
      };
    }) : view?.features.map(stripFeature) ?? [];
  const spellValues = mode === 'advanced' ? list(text('spells')) : [];
  const spellcastingSources = mode === 'advanced' && spellValues.length
    ? [{
      id: view?.spellcastingSources[0]?.id ?? createId('spellsource'),
      sourceType: 'class',
      sourceId: classes[0]!.classId,
      spellcastingAbilityId: text('spellAbility') as 'intelligence' | 'wisdom' | 'charisma',
      mechanism: 'prepared',
    }]
    : view?.spellcastingSources.map(stripSpellSource) ?? [];
  const spells = mode === 'advanced'
    ? spellValues.map((value, index) => ({
      id: view?.spells[index]?.id ?? createId('spell'),
      spellId: resolve(value, ['Spell'], true)!,
      spellcastingSourceId: spellcastingSources[0]!.id,
      known: true,
      prepared: view?.spells[index]?.prepared ?? false,
      alwaysPrepared: view?.spells[index]?.alwaysPrepared ?? false,
      ritualAvailable: view?.spells[index]?.ritualAvailable ?? false,
      customNotes: view?.spells[index]?.customNotes ?? null,
    })) : view?.spells.map(stripSpell) ?? [];
  return {
    campaignId: campaign.id,
    ...(view ? { characterId: view.character.id, baseRevision: view.revision } : {}),
    name,
    fullName: nullable('fullName'),
    description: mode === 'advanced' ? text('description') : view?.character.description ?? '',
    characterType: text('characterType') === 'NPC' ? 'NPC' : 'PC',
    biography: mode === 'advanced' ? {
      age: nullable('age') === null ? null : integer(text('age'), 0, 10000, 'Věk'),
      birthDate: nullable('birthDate'), sexId: bio.sexId, genderId: nullable('genderId'),
      sexualOrientationId: bio.sexualOrientationId, alignment: nullable('alignment'),
      faithDefinitionId: bio.faithDefinitionId, appearance: nullable('appearance'),
      biography: nullable('biography'), height: nullable('height'), weight: nullable('weight'),
      eyes: nullable('eyes'), hair: nullable('hair'), skin: nullable('skin'),
      personalityTraits: nullable('personalityTraits'), ideals: nullable('ideals'),
      bonds: nullable('bonds'), flaws: nullable('flaws'), notes: nullable('notes'),
    } : stripBiography(bio),
    origin: {
      speciesId: resolve(text('species'), ['Species', 'Race']),
      lineageId: mode === 'advanced' ? resolve(text('lineage'), ['Lineage', 'Subrace']) : view?.origin.lineageId ?? null,
      backgroundId: resolve(text('background'), ['Background']),
    },
    classes,
    abilities: abilitiesDraft,
    proficiencies,
    features,
    spellcastingSources,
    spells,
    homebrewDefinitions,
  };
}

function field(name: string, label: string, value: string | number | null, required = false): string {
  return `<label class="form-field"><span>${escapeHtml(label)}${required ? ' *' : ''}</span>
    <input name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}"${required ? ' required' : ''}></label>`;
}

function numberField(name: string, label: string, value: string | number, min: number, max: number): string {
  return `<label class="form-field"><span>${escapeHtml(label)}</span><input type="number" name="${escapeHtml(name)}"
    value="${escapeHtml(value)}" min="${min}" max="${max}"></label>`;
}

function textarea(name: string, label: string, value: string): string {
  return `<label class="form-field"><span>${escapeHtml(label)}</span><textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea></label>`;
}

function selectField(name: string, label: string, value: string, options: readonly (readonly [string, string])[]): string {
  return `<label class="form-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">
    ${options.map(([id, optionLabel]) => `<option value="${escapeHtml(id)}"${id === value ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}
    </select></label>`;
}

function definitionField(
  name: string,
  label: string,
  value: string,
  definitions: readonly RuleDefinition[],
  types: readonly string[],
  required = false,
): string {
  const listId = `catalog-${name}`;
  return `<label class="form-field definition-picker"><span>${escapeHtml(label)}${required ? ' *' : ''}</span>
    <input type="search" name="${escapeHtml(name)}" value="${escapeHtml(value)}" list="${listId}" autocomplete="off"${required ? ' required' : ''}>
    <datalist id="${listId}">${definitions.filter((item) => types.includes(item.definitionType)).map((item) => (
      `<option value="${escapeHtml(item.name)}">${escapeHtml(item.aliases[0] ?? item.source)}</option>`
    )).join('')}</datalist></label>`;
}

function definitionName(id: string | null | undefined, definitions: readonly RuleDefinition[]): string {
  return id ? definitions.find((item) => item.id === id)?.name ?? id : '';
}

function classLines(view: CharacterEditorView | null, definitions: readonly RuleDefinition[]): string {
  return view?.classes.map((item) => [
    definitionName(item.classId, definitions),
    item.level,
    definitionName(item.subclassId, definitions),
  ].filter((value) => value !== '').join(' | ')).join('\n') ?? '';
}

function proficiencyNames(view: CharacterEditorView | null, definitions: readonly RuleDefinition[], languages: boolean): string {
  return view?.proficiencies.filter((item) => (item.category === 'language') === languages)
    .map((item) => definitionName(item.targetDefinitionId, definitions) || item.customTarget || '')
    .filter(Boolean).join(', ') ?? '';
}

function featureNames(view: CharacterEditorView | null, definitions: readonly RuleDefinition[]): string {
  return view?.features.map((item) => definitionName(item.definitionId, definitions) || item.customName || '').filter(Boolean).join(', ') ?? '';
}

function spellNames(view: CharacterEditorView | null, definitions: readonly RuleDefinition[]): string {
  return view?.spells.map((item) => definitionName(item.spellId, definitions)).filter(Boolean).join(', ') ?? '';
}

function abilities(view: CharacterEditorView | null): Array<[CharacterDraft['abilities'][number]['abilityId'], string, number]> {
  const labels = { strength: 'Síla', dexterity: 'Obratnost', constitution: 'Odolnost', intelligence: 'Inteligence', wisdom: 'Moudrost', charisma: 'Charisma' } as const;
  return Object.entries(labels).map(([abilityId, label]) => [
    abilityId as keyof typeof labels,
    label,
    view?.abilities.find((item) => item.abilityId === abilityId)?.baseScore ?? 10,
  ]);
}

function emptyBiography(): CharacterDraft['biography'] {
  return {
    age: null, birthDate: null, sexId: null, genderId: null, sexualOrientationId: null,
    alignment: null, faithDefinitionId: null, appearance: null, biography: null,
    height: null, weight: null, eyes: null, hair: null, skin: null,
    personalityTraits: null, ideals: null, bonds: null, flaws: null, notes: null,
  };
}

function stripBiography(value: CharacterEditorView['biography'] | (ReturnType<typeof emptyBiography> & { characterId?: string })): CharacterDraft['biography'] {
  const { characterId: _characterId, ...biography } = value as CharacterEditorView['biography'];
  return biography;
}

function stripProficiency(value: CharacterEditorView['proficiencies'][number]): CharacterDraft['proficiencies'][number] {
  const { characterId: _characterId, sourceType: _sourceType, sourceId: _sourceId, metadata: _metadata, ...item } = value;
  return item;
}

function stripFeature(value: CharacterEditorView['features'][number]): CharacterDraft['features'][number] {
  const { characterId: _characterId, sourceType: _sourceType, sourceId: _sourceId,
    acquiredEventId: _eventId, enabled: _enabled, choices: _choices, metadata: _metadata, ...item } = value;
  return item;
}

function stripSpellSource(value: CharacterEditorView['spellcastingSources'][number]): CharacterDraft['spellcastingSources'][number] {
  const { characterId: _characterId, attackModifier: _attack, dcModifier: _dc, metadata: _metadata, ...item } = value;
  return item;
}

function stripSpell(value: CharacterEditorView['spells'][number]): CharacterDraft['spells'][number] {
  const { characterId: _characterId, acquiredEventId: _eventId, ...item } = value;
  return item;
}

function list(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function parseLines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function integer(value: string, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} musí být celé číslo ${minimum}–${maximum}.`);
  }
  return parsed;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('cs-CZ');
}

function showError(form: HTMLFormElement, message: string): void {
  const element = form.querySelector<HTMLElement>('[data-editor-error]')!;
  element.textContent = message;
  element.hidden = false;
  element.scrollIntoView({ block: 'nearest' });
}

function clearErrors(form: HTMLFormElement): void {
  const element = form.querySelector<HTMLElement>('[data-editor-error]')!;
  element.hidden = true;
  element.textContent = '';
}
