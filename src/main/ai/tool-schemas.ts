import type { ChronicleToolDescriptor } from '../../shared/chronicle-engine';
import { ChronicleEngineError } from '../engine/service';

type JsonSchema = Readonly<Record<string, unknown>>;

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['integer', 'null'] } as const;
const nullableStringArray = { type: ['array', 'null'], items: string } as const;
const budget = object({ maxResults: nullableNumber, maxCharacters: nullableNumber, cursor: nullableString });

const toolSchemas: Readonly<Record<string, JsonSchema>> = {
  'chronicle.get_scene_context': object({ campaignId: string }),
  'chronicle.get_character_context': object({
    campaignId: string,
    characterId: string,
    sections: { type: 'array', minItems: 1, items: { type: 'string', enum: [
      'identity', 'biography', 'combat', 'resources', 'actions', 'features',
      'spellcasting', 'inventory', 'relations', 'relationships', 'knowledge',
    ] } },
    observerEntityId: nullableString,
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_item_context': object({
    campaignId: string, itemId: string, observerEntityId: nullableString,
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_location_context': object({
    campaignId: string, locationId: string, budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_location_contents': object({
    campaignId: string,
    locationId: string,
    include: { type: ['array', 'null'], items: { type: 'string', enum: ['characters', 'creatures', 'items', 'childLocations'] } },
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_definition': object({ definitionId: string }),
  'chronicle.get_relations': object({
    campaignId: string,
    entityId: string,
    relationTypes: nullableStringArray,
    activeOnly: { type: 'boolean' },
    direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_actor_relationships': object({
    campaignId: string,
    actorId: string,
    observerEntityId: nullableString,
    includeHistory: { type: 'boolean' },
    maxResults: nullableNumber,
    maxCharacters: nullableNumber,
  }),
  'chronicle.get_knowledge': object({
    campaignId: string,
    subjectEntityId: string,
    observerEntityId: nullableString,
    knowledgeTypes: nullableStringArray,
    includeHistorical: { type: 'boolean' },
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.get_relevant_events': object({
    campaignId: string,
    entityIds: nullableStringArray,
    locationId: nullableString,
    eventTypes: nullableStringArray,
    beforeSequence: nullableNumber,
    afterSequence: nullableNumber,
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
  'chronicle.resolve_entity': object({
    campaignId: string,
    query: string,
    observerEntityId: nullableString,
    entityTypes: nullableStringArray,
    sceneOnly: { type: 'boolean' },
  }),
  'chronicle.search_campaign': object({
    campaignId: string,
    query: string,
    observerEntityId: nullableString,
    budget: { anyOf: [budget, { type: 'null' }] },
  }),
};

export function strictToolDescriptor(descriptor: ChronicleToolDescriptor): ChronicleToolDescriptor {
  return { ...descriptor, inputSchema: toolSchemas[descriptor.name] ?? descriptor.inputSchema };
}

export function validateOpenAiStrictToolSchema(
  toolName: string,
  schema: Readonly<Record<string, unknown>>,
): void {
  validateSchemaNode(toolName, schema, '$', true);
}

export function proposalToolDescriptor(): ChronicleToolDescriptor {
  return {
    name: 'chronicle.propose_turn_transaction',
    description: 'Validate a proposed atomic world-state transaction. This never commits or mutates campaign state.',
    inputSchema: object({
      event: object({ eventType: string, summary: string, locationId: nullableString }),
      changes: { type: 'array', maxItems: 24, items: { anyOf: turnChangeSchemas() } },
      reasoningSummary: nullableString,
    }),
    mutatesState: false,
    defaultLimits: { maxResults: 24, maxCharacters: 30_000 },
  };
}

function turnChangeSchemas(): JsonSchema[] {
  const characterAmount = (type: string, extra: Record<string, JsonSchema>) => object({ type: constant(type), characterId: string, ...extra });
  return [
    characterAmount('hp.delta', { amount: { type: 'number' } }),
    characterAmount('temporaryHp.set', { value: { type: 'integer', minimum: 0 } }),
    characterAmount('resource.delta', { resourceId: string, amount: { type: 'integer' } }),
    characterAmount('spellSlot.delta', { poolId: string, amount: { type: 'integer' } }),
    characterAmount('character.move', { locationId: nullableString }),
    object({ type: constant('item.transfer'), itemId: string, placement: placementSchema() }),
    object({
      type: constant('effect.add'), effectId: nullableString, targetEntityId: string,
      definitionId: nullableString, sourceEntityId: nullableString, sourceFeatureId: nullableString,
      sourceSpellId: nullableString, name: string, durationType: string,
      durationValue: { type: ['number', 'null'] }, remainingDuration: { type: ['number', 'null'] },
      concentration: { type: 'boolean' }, modifiers: {
        type: ['array', 'null'],
        items: object({ key: string, value: { type: 'number' } }),
      },
      metadata: { type: 'null' },
    }),
    object({ type: constant('effect.end'), effectId: string }),
    characterAmount('concentration.end', {}),
    characterAmount('inspiration.set', { value: { type: 'boolean' } }),
    characterAmount('deathSave.record', { success: { type: 'boolean' } }),
    object({
      type: constant('relation.add'), relationId: nullableString, sourceEntityId: string,
      targetEntityId: string, relationType: string, metadata: { type: 'null' },
    }),
    object({ type: constant('relation.end'), relationId: string }),
    object({
      type: constant('actorRelationship.upsert'), relationshipId: nullableString,
      relationId: nullableString, sourceEntityId: string, targetEntityId: string,
      relationType: string, visibilityScope: { type: 'string', enum: ['world', 'public', 'observer'] },
      observerEntityId: nullableString, currentSummary: string, historySummary: nullableString,
      referencedEventIds: nullableStringArray, referenceCurrentEvent: { type: 'boolean' },
    }),
    object({
      type: constant('knowledge.add'), knowledgeId: nullableString, subjectEntityId: string,
      observerEntityId: nullableString, visibilityScope: { type: 'string', enum: ['world', 'public', 'observer'] },
      knowledgeType: string, value: nullableString, referenceEntityId: nullableString,
      confidence: { type: ['number', 'null'] }, source: nullableString,
    }),
    object({ type: constant('knowledge.end'), knowledgeId: string }),
  ];
}

function placementSchema(): JsonSchema {
  return { anyOf: [
    object({ kind: constant('location'), locationId: string }),
    object({ kind: constant('character'), characterId: string }),
    object({ kind: constant('creature'), creatureId: string }),
    object({ kind: constant('container'), containerItemId: string }),
    object({ kind: constant('unknown') }),
  ] };
}

function constant(value: string): JsonSchema { return { type: 'string', const: value }; }

function object(properties: Readonly<Record<string, JsonSchema>>): JsonSchema {
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

const unsupportedKeywords = new Set([
  'oneOf', 'allOf', 'not', 'dependentRequired', 'dependentSchemas', 'if', 'then', 'else',
  'patternProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'minContains',
  'maxContains', 'uniqueItems', 'prefixItems', 'additionalItems', 'minProperties', 'maxProperties',
  'minLength', 'maxLength', 'contentEncoding', 'contentMediaType', 'default', 'examples',
]);

function validateSchemaNode(toolName: string, value: unknown, path: string, root: boolean): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSchema(toolName, path, 'schema musí být objekt');
  }
  const node = value as Record<string, unknown>;
  for (const keyword of Object.keys(node)) {
    if (unsupportedKeywords.has(keyword)) invalidSchema(toolName, `${path}.${keyword}`, `nepodporované klíčové slovo ${keyword}`);
  }
  if (root && ('anyOf' in node || node.type !== 'object')) {
    invalidSchema(toolName, path, 'kořen strict schema musí být object bez anyOf');
  }

  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('object')) validateObjectNode(toolName, node, path);
  if (types.includes('array')) {
    if (!('items' in node)) invalidSchema(toolName, `${path}.items`, 'array musí definovat items');
    validateSchemaNode(toolName, node.items, `${path}.items`, false);
  }
  if ('anyOf' in node) {
    if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) {
      invalidSchema(toolName, `${path}.anyOf`, 'anyOf musí obsahovat alespoň jednu variantu');
    }
    node.anyOf.forEach((variant, index) => validateSchemaNode(toolName, variant, `${path}.anyOf[${index}]`, false));
  }
  if ('$defs' in node) {
    if (!node.$defs || typeof node.$defs !== 'object' || Array.isArray(node.$defs)) {
      invalidSchema(toolName, `${path}.$defs`, '$defs musí být objekt');
    }
    for (const [name, definition] of Object.entries(node.$defs as Record<string, unknown>)) {
      validateSchemaNode(toolName, definition, `${path}.$defs.${name}`, false);
    }
  }
}

function validateObjectNode(toolName: string, node: Record<string, unknown>, path: string): void {
  if (node.additionalProperties !== false) {
    invalidSchema(toolName, `${path}.additionalProperties`, 'object musí mít additionalProperties: false');
  }
  if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
    invalidSchema(toolName, `${path}.properties`, 'object musí definovat properties');
  }
  const properties = node.properties as Record<string, unknown>;
  if (!Array.isArray(node.required)) invalidSchema(toolName, `${path}.required`, 'object musí definovat required');
  if ((node.required as unknown[]).some((item) => typeof item !== 'string')) {
    invalidSchema(toolName, `${path}.required`, 'required smí obsahovat pouze názvy vlastností');
  }
  const required = new Set(node.required as string[]);
  if (required.size !== (node.required as string[]).length) {
    invalidSchema(toolName, `${path}.required`, 'required nesmí obsahovat duplicity');
  }
  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name)) invalidSchema(toolName, `${path}.required`, `vlastnost ${name} musí být required; volitelnost vyjádřete přes null`);
    validateSchemaNode(toolName, property, `${path}.properties.${name}`, false);
  }
  for (const name of required) {
    if (!(name in properties)) invalidSchema(toolName, `${path}.required`, `required odkazuje na neexistující vlastnost ${name}`);
  }
}

function invalidSchema(toolName: string, path: string, reason: string): never {
  throw new ChronicleEngineError(
    'OPENAI_TOOL_SCHEMA_INVALID',
    `Neplatné schema nástroje ${toolName}: ${reason} (${path}).`,
    { toolName, path, reason },
  );
}
