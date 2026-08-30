# Chronicle Engine

Chronicle je source-of-truth engine. Budoucí AI bude jeho omezený klient, ne vlastník databáze.

## Context model

- **HOT** — `SceneContextView`: aktivní postava, explicitní nebo fallback lokace, účastníci scény, aktivní efekty, concentration, posledních 8 zpráv a poslední Event sequence. Neobsahuje celý character sheet, inventory, spellbook, relations ani historii.
- **WARM** — strukturované dotazy na vybrané Character sections, Item, Location, Definition, Relations a Knowledge.
- **COLD** — bounded relevant Events, starší Messages a FTS5 campaign search. Canonical tabulky zůstávají source of truth; FTS lze bezpečně znovu sestavit přes `rebuildSearchIndex()`.

Každý kolekční výstup používá `ContextBudget` (`maxResults`, `maxCharacters`, volitelný cursor) a vrací `truncated` + `nextCursor`. Výchozí limit je 10 výsledků / 12 000 znaků, tvrdý strop 100 výsledků / 100 000 znaků. Hot message window má výchozí velikost 8 a maximálně 20.

## Runtime, Conversations a Scene

`campaign_runtime_state` ukládá `activePlayerCharacterId`, `activeConversationId` a explicitní `activeSceneLocationId`. Všechny setter operations ověřují Campaign membership. Pokud není lokace scény nastavená, engine použije pouze `activePlayerCharacter.currentLocationId`.

Messages mají jednoznačnou rostoucí `sequence` v rámci Conversation. Text zprávy je historie a nikdy nepřebíjí structured current state. `sourceMessageId` na Eventu a `relatedEventId` na Message se propojí až uvnitř úspěšné Turn Transaction, takže nevzniká cyklická insert závislost.

## Tool catalog

| Tool name | Purpose | Required input | Output | Mutates state? | Default limits |
|---|---|---|---|---|---|
| `chronicle.get_scene_context` | Hot context scény | `campaignId` | `SceneContextView` | No | 8 recent messages |
| `chronicle.get_character_context` | Vybrané Character sections | `campaignId`, `characterId`, `sections` | `CharacterContextView` | No | 10 / 12k |
| `chronicle.get_item_context` | Item placement, relations, limited history/knowledge | `campaignId`, `itemId` | `ItemContextView` | No | 10 / 12k |
| `chronicle.get_location_context` | Hierarchie, contents a Events | `campaignId`, `locationId` | `LocationContextView` | No | 10 / 12k |
| `chronicle.get_location_contents` | Filtrovaný obsah lokace | `campaignId`, `locationId` | `LocationContentsView` | No | 10 / 12k |
| `chronicle.get_definition` | Rule Definition bez Character state | `definitionId` | `RuleDefinition` | No | single |
| `chronicle.get_relations` | Direction/type/active relation query | `campaignId`, `entityId` | bounded Relations | No | 10 / 12k |
| `chronicle.get_knowledge` | World nebo observer view | `campaignId`, `subjectEntityId` | bounded Knowledge | No | 10 / 12k |
| `chronicle.get_relevant_events` | Reverse-chronological filtered Events | `campaignId` | bounded Events | No | 10 / 12k |
| `chronicle.resolve_entity` | ID/name/alias resolution + scene bias | `campaignId`, `query` | matches + ambiguity | No | 100 candidates |
| `chronicle.search_campaign` | FTS Entity/Event/Message/Knowledge search | `campaignId`, `query` | summaries/snippets | No | 10 / 12k |

Tool definitions jsou prosté serializovatelné objekty s JSON-like `inputSchema`; executable closure zůstává pouze uvnitř main procesu. Runtime validace odmítne neplatné tvary bez stack trace. Tool call může přidat technický invocation log, ale nikdy world Event nebo state history.

## Knowledge visibility

- `world` — autoritativní world truth; dostupná pouze world dotazu.
- `public` — common/visible knowledge; dostupná world i každému observerovi.
- `observer` — vyžaduje konkrétní `observerEntityId`; dostupná pouze jemu.

`searchCampaign` používá stejný visibility filtr, takže observer nemůže vyhledáním obejít Knowledge retrieval. Observer i subject musí patřit do stejné Campaign.

## Entity resolution

Resolver používá exact ID, normalized Unicode name, global alias a observer alias. Deterministické základní score je 1.00 / 0.96 / 0.92 / 0.86. Ranking bias je v pořadí explicitní participant, scene location, active Character inventory a globální match. Stejné nejlepší score vrací `ambiguous: true`; engine náhodně nevybere jednu entitu.

## TurnTransaction

Jeden TurnTransaction vlastní jeden Event a jednu SQLite transaction boundary. `validateTurnTransaction` pouze čte. `applyTurnTransaction` uvnitř locku znovu ověří current state, přidělí unikátní Event sequence a buď commitne vše, nebo rollbackne vše.

Implementované TurnChange varianty:

| Type | Required IDs/data | Validation | State/history impact |
|---|---|---|---|
| `hp.delta` | Character, amount | Character + combat state, finite amount | clamped HP + state history |
| `temporaryHp.set` | Character, value | non-negative integer | temp HP + history |
| `resource.delta` | Character, Resource, amount | ownership, 0..maximum | Resource + history |
| `spellSlot.delta` | Character, Pool, amount | ownership, 0..maximum | pool + history |
| `character.move` | Character, optional Location | Campaign/type membership | current location + interval history |
| `item.transfer` | Item, typed placement | membership + container cycle | current placement + interval history |
| `effect.add` | target, name, duration | target/sources, optional concentration owner | Effect + concentration + history |
| `effect.end` | active Effect | active ownership | end Event + history |
| `concentration.end` | Character | Character membership | Effect/concentration + history |
| `inspiration.set` | Character, boolean | combat state | inspiration + history |
| `deathSave.record` | Character, success | counter below 3 | counter + history |
| `relation.add/end` | Entity IDs / active Relation | membership + active interval | relation interval |
| `knowledge.add/end` | subject, scope, value/reference | membership + visibility invariant | knowledge interval |

Transaction ID a canonical payload hash se uloží pouze po úspěchu. Stejné ID + stejný payload vrátí původní výsledek s `alreadyApplied: true`; stejné ID + jiný payload vrátí `TRANSACTION_ID_REUSED`. Rejected preflight nevytvoří Event, Message, history ani transaction row.

## Provider-neutral orchestration

`ChronicleOrchestrator` nabízí `buildTurnContext`, `executeTool`, `validateProposedTransaction` a `commitTransaction`. `ProposedTurnTransaction.reasoningSummary` je krátké bezpečné vysvětlení, ne chain-of-thought. Approval policy contract podporuje `automatic`, `review` a `manual`; výchozí foundation používá `review` a neimplikuje automatický commit.

Budoucí adapter může mapovat catalog na OpenAI function/tool calling, jiného providera nebo lokální harness. V této verzi není žádná síťová ani provider-specific závislost.
