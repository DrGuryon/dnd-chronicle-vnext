# Architecture — complete character domain

## Hranice procesu

- **Main process** vlastní okna, SQLite connection a updater. Je jedinou vrstvou s přímým přístupem k disku.
- **Preload bridge** publikuje úzké typované API. Renderer nedostává Node.js ani Electron API.
- **Renderer** vykresluje prázdný shell a stav instalace, databáze a updateru.

`contextIsolation`, Chromium sandbox a vypnuté `nodeIntegration` jsou povinné bezpečnostní hranice.

## Persistovaná data

SQLite je lokální source of truth. Soubor je v `app.getPath('userData')/data/chronicle.db`, nikdy v instalačním adresáři. Zapnuté jsou foreign keys, WAL a busy timeout.

Schéma používá monotónní `PRAGMA user_version` a auditní tabulku `schema_migrations`. Migrace běží v `BEGIN IMMEDIATE` transakci. Aplikace odmítne otevřít databázi s novějším schématem, aby downgrade nepoškodil data. Před každým skutečným upgradem existující databáze vytvoří SQLite backup do `userData/backups`.

Schéma v3 rozšiřuje storage a Milestone 2 domain foundation o praktický Character model. Databáze v1 postupuje přes v2 do v3 a databáze v2 přímo do v3; před upgradem vždy vznikne konzistentní backup. Čistá i existující databáze procházejí stejným monotónním migration runnerem.

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

`knowledge_records` odděluje subject od observera. `observer_entity_id = NULL` je připravené pro world truth, konkrétní observer pro znalost postavy. Záznam může nést textovou hodnotu nebo referenci, časový interval, confidence a source. Retrieval ani obecný Knowledge engine zatím nejsou součástí aplikace.

## Proč renderer nezapisuje SQL

UI nesmí skládat SQL ani měnit několik tabulek postupně. Budoucí preload příkazy budou volat `ChronicleDomainService` nebo `CharacterDomainService`, které vynutí invarianty a transakční hranici. Stejný tvar je připravený pro budoucí `TurnTransaction`: jeden příběhový krok může vytvořit Event a několik změn stavu buď celý, nebo vůbec.

## Update pipeline

`electron-builder` vytváří standardní per-user NSIS installer. GitHub release workflow při tagu sestaví installer, blockmap a `latest.yml`; `electron-updater` čte release konfiguraci vloženou do `app-update.yml`.

Updater je řízen main procesem a renderer dostává pouze stavové události. Před ukončením procesu se provede WAL checkpoint a uzavře SQLite connection. `quitAndInstall(false, true)` následně spustí NSIS update a znovu otevře aplikaci.

Produkční vydání musí být Authenticode podepsané. Build konfigurace zapne kontrolu podpisu, pokud je přítomen signing certifikát; lokální unsigned build používá SHA-512 integritu metadat, ale není určený k veřejné distribuci.

## Hranice tohoto milestone

Milestone poskytuje Character doménu a několik testovacích definitions, ne finální Character panel ani kompletní SRD katalog. Neobsahuje AI retrieval/tool calling, OpenAI orchestration, lokální LLM ani plný combat engine. Tyto vrstvy mají stavět na stabilní identitě, Definition referencích, Eventech a transakčních službách.
