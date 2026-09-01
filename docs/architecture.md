# Architecture — Chronicle Engine, Character Cockpit and Entity Cards

## Hranice procesu

- **Main process** vlastní okna, SQLite connection, bezpečné uložení API klíče, AI runtime a updater. Je jedinou vrstvou s přímým přístupem k disku a síti.
- **Preload bridge** publikuje úzké typované API. Renderer nedostává Node.js ani Electron API.
- **Renderer** vykresluje shell, Character Cockpit a Entity Cards výhradně ze serializovatelných read modelů.

`contextIsolation`, Chromium sandbox a vypnuté `nodeIntegration` jsou povinné bezpečnostní hranice.

## Persistovaná data

SQLite je lokální source of truth. Soubor je v `app.getPath('userData')/data/chronicle.db`, nikdy v instalačním adresáři. Zapnuté jsou foreign keys, WAL a busy timeout.

Schéma používá monotónní `PRAGMA user_version` a auditní tabulku `schema_migrations`. Migrace běží v `BEGIN IMMEDIATE` transakci. Aplikace odmítne otevřít databázi s novějším schématem, aby downgrade nepoškodil data. Před každým skutečným upgradem existující databáze vytvoří SQLite backup do `userData/backups`.

Schéma v3 rozšířilo storage o praktický Character model, v4 přidalo izolované UI preference a v5 Chronicle Engine, Conversations, Knowledge visibility, Turn Transactions a FTS5. Schéma v6 přidalo AI runtime a vztahové profily, v7 editovatelný doménový katalog. Schéma v8 doplňuje `rule_definition_relations`, verzované instalace rules packů, sanitizovaný `app_log_entries` a `tool_usage_json` u AI tahů. Databáze v1–v7 postupují stejným monotónním runnerem do v8 a před upgradem vždy vznikne konzistentní backup.

## Chronicle Engine boundary

`ChronicleEngineService` je deterministická vrstva mezi source-of-truth doménou a AI providerem. Sestavuje malý Hot `SceneContextView`, provádí explicitní bounded Warm/Cold dotazy a publikuje serializovatelný Chronicle Tool Catalog. Nepřijímá SQL, názvy tabulek, obecné property paths ani arbitrary patch. `AiTurnService` streamuje provider-neutral events; OpenAI adapter pouze překládá Responses API a nikdy nedostává commit tool.

```text
Player input → SceneContext → Chronicle tools → ProposedTurnTransaction
             → deterministic validation → approval policy → atomic commit
```

Aktivní Character, Conversation a Scene Location jsou explicitní v `campaign_runtime_state`. Pokud Scene Location není nastavená, jediný definovaný fallback je `activePlayerCharacter.currentLocationId`. Character Cockpit již nikdy nevybírá první vytvořenou postavu.

## Read model a IPC hranice

`ChronicleReadModelService` skládá jeden kompaktní `CharacterCockpitView` z Domain/Character services a RulesEngine. HP/AC/initiative/proficiency bonus, efektivní abilities a movement, resources, oddělené standardní a Pact slot pools, spells, features, inventory summary, defenses, proficiencies, effects a concentration tak vznikají v main procesu. Renderer hodnoty pouze zobrazuje a nekopíruje pravidlové výpočty.

Stejná vrstva řeší jedním dotazem `EntityCardView`. Obecná reference a Card Host proto používají stejný mechanismus pro Spell, Feature/Feat, Class/Subclass, Species/Background, Item, Location, Character, Condition/Effect a Action. Po otevření další reference se karta přidá na zásobník a návrat nevyžaduje znovu sestavovat data v rendereru.

Preload zveřejňuje pouze explicitní queries a commands. Není v něm SQL, obecné `updateField` ani EventDraft z rendereru. `ChronicleIpcService` validuje runtime payload, ověří vlastnictví Resource/Slot/Effect, vytvoří kanonický Event type a summary, zavolá transakční domain operation a vrátí nově načtený cockpit. Chyba se zaloguje v main procesu a renderer dostane bezpečnou zprávu bez interního stack trace.

### Current-state update flow

```text
Renderer intent → typed preload command → runtime validation → domain transaction
                → Event + current state + history → fresh CharacterCockpitView
```

Renderer nepoužívá optimistic persistent state. Během malé změny zablokuje pouze příslušný ovládací prvek; při chybě zobrazí lokální hlášku a ponechá/obnoví skutečný databázový stav.

### UI preferences

Pořadí sekcí, collapsed state a šířka pravého panelu jsou jediná UI data v nové v4 tabulce. Preferences patří dvojici Campaign + Character, validují úplnou permutaci podporovaných sekcí a nejsou součástí Event historie. Změna preference proto nemění svět ani pravidla kampaně.

### Renderer není source of truth

Renderer drží pouze právě zobrazený read model a zásobník otevřených karet. Odvozené hodnoty, vlastnictví resource, platnost resetu a Event summary vznikají v main/doménové vrstvě. Reload panelu tak vždy rekonstruuje stejný stav z SQLite a aktivních Effectů.

## Definition, Instance, State, Event

- **Definition** je znovupoužitelná pravidlová definice nezávislá na konkrétní postavě. `rule_definitions` drží stabilní ID, typ, ruleset/verzi, textový původ a volitelná strukturovaná metadata. Core, 2014, 2024 i homebrew obsah používají stejné schéma.
- **Instance** je konkrétní entita kampaně se stabilním string ID. Sdílená identita je v `entities`, typová data v `locations`, `characters`, `creatures` a `items`.
- **State** je rychle dostupný současný stav, například `characters.current_location_id` nebo právě jeden řádek v `item_current_placements`.
- **Event** je neměnný historický bod. Každá kampaň má jednoznačnou rostoucí `sequence`, takže pořadí nezávisí na tom, zda svět používá reálný kalendář.

Doménové TypeScript typy jsou v `src/domain` a neznají SQLite. Main-process service/repository vrstvy v `src/main/domain` a `src/main/character` mapují čistý model na relační schéma, ověřují hranice kampaní a provádějí transakce.

## Definition reference model a Character composition

Character nekopíruje Species, Background, Class, Subclass, Feat, Spell ani Condition. Ukládá jejich stabilní definition ID a pouze data specifická pro postavu: biography, origin choices/overrides, multiclass progression, ability score state a získané prvky. Nullable biography pole zachovávají rozdíl mezi neznámou hodnotou a vyplněným údajem.

`character_classes` dovoluje více class řádků a `totalLevel` vzniká součtem jejich úrovní. Ability score se skládá z base score, permanentního modifieru nebo override a aktivních Effect modifierů. Rozlišuje tedy „Strength +2“ od „Strength becomes 19“ bez přepisování zdrojových definic.

Proficiency je obecný záznam pro saves, skills, weapons, armor, shields, tools, languages i custom cíl. Nese level (`none`, `half`, `proficient`, `expertise`) a povinnou source referenci. Výsledný bonus se počítá z ability modifieru a RulesEngine.

## Feature, Resource a Action

- **Feature** je získaná schopnost s volitelnou Definition, source, availability, choices a custom textem. Divine Smite, Pact of the Blade, War Caster i homebrew Oath používají stejné tabulky.
- **Resource** je současný číselný pool libovolné Entity. Reset určuje data (`shortRest`, `longRest`, `shortOrLongRest`, `dawn`, `manual`, `custom`), takže Channel Divinity, Lay on Hands, class dice i magic-item charges nepotřebují vlastní sloupce.
- **Action** popisuje způsob aktivace a strukturovanou mechaniku: attack/range/target, damage components, saving throw, effect references a resource costs. Není plným combat enginem.

Konkrétní class ability nejsou hardcoded, protože jejich počet, wording i pravidla se mezi 2014, 2024 a homebrew mění. Skládání Definition + Feature + Resource + Action dovoluje přidat nový obsah bez migrace databáze.

## Combat, spellcasting a Effects

Combat current state drží HP, temporary HP, AC vstupy/override, initiative modifier, death saves a inspiration. Hit Dice jsou samostatné pooly, takže multiclass může současně používat například d10 a d8. Movement, senses a defenses jsou kolekce se source referencemi; nejsou zploštěné do jednoho speed nebo jednoho textového pole.

`SpellcastingSource` odděluje Paladin Spellcasting od Warlock Pact Magic a definuje ability, mechanismus a lokální attack/DC modifiers. `CharacterSpell` pouze odkazuje na Spell Definition a příslušný source. Standardní, pact i custom sloty jsou samostatné `SpellSlotPool` záznamy s vlastním levelem a resetem.

`active_effects` je společná foundation pro buffy, debuffy i Conditions. Effect nese začátek/konec v Eventech, duration, concentration a strukturované modifiers. `character_concentration` ukazuje právě jeden aktivní Effect; zahájení nové koncentrace atomicky ukončí předchozí Effect a přepne referenci.

## Current state, historie a RulesEngine

Rychle čtený současný stav zůstává v normalizovaných current-state tabulkách. Významné operace jako změna HP, spotřeba/obnova Resource nebo slotu, rest reset, Effect/Condition, concentration, Hit Die a death save vloží Event, změní stav a přidají cílený `state_change_history` řádek v jedné transakci. Celý Character se po každém kroku nesnapshotuje.

Ruleset-specific odvozené hodnoty nejsou univerzální pravda Chronicle service. `RulesEngineRegistry` volí implementaci podle `Campaign.rulesetId` a `rulesetVersion`; dnd5e 2014 a 2024 implementují ability modifier, proficiency bonus/contribution, initiative a spell attack/save DC. Vlastní systém může zaregistrovat další engine bez změny storage modelu.

## Entity identity a vztahy

Název nikdy není identifikátor. Nová ID používají prefixy jako `campaign_`, `char_`, `item_`, `loc_` a `event_`; přejmenování proto nerozbije reference. `entities` drží společná pole, ale databázová dědičnost se nevynucuje.

`entity_relations` je obecný časově omezený graf. `relation_type` je otevřený string a metadata je jediná záměrně rozšiřitelná JSON část tohoto modelu. Alias má vlastní identitu, volitelného pozorovatele a interval `from_event_id` / `to_event_id`.

`relationship_profiles` nad stejnou kanonickou relation oddělují `world`, `public` a konkrétní `observer` pohled. Observer-specific profil má přednost před public; world profil se observerovi nikdy nevrací. `actorRelationship.upsert` je součást stejné Turn Transaction jako vzniklý Event a může na tento Event atomicky odkázat.

## Location hierarchy

`locations.parent_location_id` tvoří neomezený strom. Služba `getLocationPath` prochází rodiče a zároveň detekuje případný cyklus, například:

```text
Ravenford / Tržní čtvrť / Zadní ulička
```

Character a Creature ukládají pouze svou aktuální lokaci. Změna lokace Characteru proběhne v jedné `BEGIN IMMEDIATE` transakci společně s Eventem a aktualizací `entity_location_history`.

## Effective item location

Předmět má právě jeden současný placement: location, character, creature, container item nebo unknown. Cizí klíče a databázový `CHECK` zakazují kombinace více placementů. Lokace se záměrně neduplikuje, když předmět někdo nese nebo je v kontejneru.

Resolver sleduje řetězec například:

```text
Item → container item → Character → current Location
```

Při každém kroku udržuje množinu navštívených item ID. Cyklus tedy odmítne jak transfer service před zápisem, tak resolver při čtení případných externě poškozených dat.

## Current state versus history

`item_current_placements` slouží pro rychlé čtení. `item_placement_history` uchovává intervaly vymezené Eventy; převod předmětu atomicky uzavře předchozí řádek, otevře nový, změní current state a vloží Event. Lze tak doložit, že meč nejprve ležel v uličce a od konkrétního Eventu ho nese Arqos.

`knowledge_records` odděluje subject od observera a explicitní `visibility_scope` rozlišuje `world`, `public` a `observer`. World dotaz vrací world truth + public knowledge. Observer dotaz vrací pouze public knowledge a záznamy daného observera; world secret ani vzpomínky jiné postavy do něj neprojdou. Záznam může nést textovou hodnotu nebo referenci, časový interval, confidence a source.

## Proč renderer nezapisuje SQL

UI nesmí skládat SQL ani měnit několik tabulek postupně. Preload příkazy volají explicitní služby. `TurnTransactionService` před prvním zápisem ověří všechny reference a current-state invarianty, uvnitř jediného `BEGIN IMMEDIATE` je zkontroluje znovu a potom zapíše jeden Event, všechny změny, state history, reference a auditní transaction row. Chyba rollbackne celý příběhový krok.

## Update pipeline

`electron-builder` vytváří standardní per-user NSIS installer. GitHub release workflow při tagu sestaví installer, blockmap a `latest.yml`; `electron-updater` čte release konfiguraci vloženou do `app-update.yml`.

Updater je řízen main procesem a renderer dostává pouze stavové události. Před ukončením procesu se provede WAL checkpoint a uzavře SQLite connection. `quitAndInstall(false, true)` následně spustí NSIS update a znovu otevře aplikaci.

Rules pack updater je samostatný. Pack JSON se ukládá do `userData/rules-packs/<packId>/<version>/pack.json`; aktivace metadat a normalizovaných definic proběhne v jedné databázové transakci až po validaci hash, schématu, unikátních ID a všech vztahových referencí. Poškozený aktivní soubor se při startu nahradí vestavěnou ověřenou kopií a událost se zapíše do aplikačního logu.

Produkční vydání musí být Authenticode podepsané. Build konfigurace zapne kontrolu podpisu, pokud je přítomen signing certifikát; lokální unsigned build používá SHA-512 integritu metadat, ale není určený k veřejné distribuci.

## AI boundary

Oficiální OpenAI SDK je uzavřené v `OpenAiProvider`; zbytek aplikace zná jen `AiProvider` a streamované události. Odpovědi používají `store: false`, lokální Messages jsou kanonická historie a provider response ani chain-of-thought se neukládají. API key je přes Electron `safeStorage` mimo DB a preload vystavuje pouze maskovaný stav. Podrobný tok je v [`ai-runtime.md`](ai-runtime.md).
