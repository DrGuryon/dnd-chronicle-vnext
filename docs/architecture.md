# Architecture — domain model foundation

## Hranice procesu

- **Main process** vlastní okna, SQLite connection a updater. Je jedinou vrstvou s přímým přístupem k disku.
- **Preload bridge** publikuje úzké typované API. Renderer nedostává Node.js ani Electron API.
- **Renderer** vykresluje prázdný shell a stav instalace, databáze a updateru.

`contextIsolation`, Chromium sandbox a vypnuté `nodeIntegration` jsou povinné bezpečnostní hranice.

## Persistovaná data

SQLite je lokální source of truth. Soubor je v `app.getPath('userData')/data/chronicle.db`, nikdy v instalačním adresáři. Zapnuté jsou foreign keys, WAL a busy timeout.

Schéma používá monotónní `PRAGMA user_version` a auditní tabulku `schema_migrations`. Migrace běží v `BEGIN IMMEDIATE` transakci. Aplikace odmítne otevřít databázi s novějším schématem, aby downgrade nepoškodil data. Před každým skutečným upgradem existující databáze vytvoří SQLite backup do `userData/backups`.

Schéma v2 rozšiřuje původní bezpečný storage základ o doménový model. Stávající databáze v1 dostane před migrací konzistentní backup; čistá i existující databáze procházejí stejným monotónním migration runnerem.

## Definition, Instance, State, Event

- **Definition** je znovupoužitelná pravidlová definice nezávislá na konkrétní kampani. `item_definitions` je zatím pouze minimální referenční základ pro budoucí ruleset data.
- **Instance** je konkrétní entita kampaně se stabilním string ID. Sdílená identita je v `entities`, typová data v `locations`, `characters`, `creatures` a `items`.
- **State** je rychle dostupný současný stav, například `characters.current_location_id` nebo právě jeden řádek v `item_current_placements`.
- **Event** je neměnný historický bod. Každá kampaň má jednoznačnou rostoucí `sequence`, takže pořadí nezávisí na tom, zda svět používá reálný kalendář.

Doménové TypeScript typy jsou v `src/domain` a neznají SQLite. Main-process service/repository vrstva v `src/main/domain` mapuje čistý model na relační schéma, ověřuje hranice kampaní a provádí transakce.

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

UI nesmí skládat SQL ani měnit několik tabulek postupně. Budoucí preload příkazy budou volat `ChronicleDomainService`, který vynutí invarianty a transakční hranici. Stejný tvar je připravený pro budoucí `TurnTransaction`: jeden příběhový krok může vytvořit Event a několik změn stavu buď celý, nebo vůbec.

## Update pipeline

`electron-builder` vytváří standardní per-user NSIS installer. GitHub release workflow při tagu sestaví installer, blockmap a `latest.yml`; `electron-updater` čte release konfiguraci vloženou do `app-update.yml`.

Updater je řízen main procesem a renderer dostává pouze stavové události. Před ukončením procesu se provede WAL checkpoint a uzavře SQLite connection. `quitAndInstall(false, true)` následně spustí NSIS update a znovu otevře aplikaci.

Produkční vydání musí být Authenticode podepsané. Build konfigurace zapne kontrolu podpisu, pokud je přítomen signing certifikát; lokální unsigned build používá SHA-512 integritu metadat, ale není určený k veřejné distribuci.

## Hranice tohoto milestone

Schéma záměrně neobsahuje kompletní D&D 5E character sheet, spell katalog, monster stat block, AI retrieval ani import starého formátu. Tyto vrstvy mají stavět na stabilní identitě, Eventech a transakčních službách místo rozšiřování jednoho univerzálního JSON dokumentu.

