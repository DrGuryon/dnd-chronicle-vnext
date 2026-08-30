# D&D Chronicle vNext

Funkční základ nové Windows aplikace: Electron shell, lokální SQLite databáze s verzovaným doménovým modelem, Chronicle Engine, interaktivní Character Cockpit, NSIS installer a integrovaný updater.

## Rychlý start

Požadavky: Windows a Node.js 24.

```powershell
npm ci
npm run verify
npm start
```

Instalátor vytvoříte příkazem:

```powershell
npm run dist:win
```

Výstup je v `release/D&D-Chronicle-vNext-Setup-<version>.exe`.

## Data

Databáze není součástí instalace. Za běhu se vytvoří v Electron `userData` adresáři:

```text
%APPDATA%\D&D Chronicle vNext\data\chronicle.db
```

Přeinstalace ani odinstalace aplikace tento adresář nemaže. Před každou budoucí migrací již existující databáze se do `backups/` vytvoří konzistentní SQLite backup.

Schéma v5 odděluje pravidlové Definition, konkrétní Instance, současný State a historický Event. Vedle Campaign, Entity, Location a Character foundation ukládá explicitní runtime scény, konverzace, observer-aware Knowledge, entity/event reference a idempotentní Turn Transactions. V4 preference pravého panelu zůstávají izolované od světa kampaně.

Renderer SQL přímo nepoužívá. Z main procesu dostává hotové read modely a používá explicitní typované commands. Chronicle Engine navíc sestavuje malý Hot SceneContext, nabízí bounded Warm/Cold retrieval a atomicky validuje strukturované změny jednoho tahu. Nepřipojuje žádný AI model ani OpenAI SDK. Podrobnosti jsou v [`docs/architecture.md`](docs/architecture.md) a [`docs/chronicle-engine.md`](docs/chronicle-engine.md).

## Aktualizace

Lokální build úmyslně nemá natvrdo zadaný cizí release server. Release workflow při tagu `v*` doplní aktuální GitHub repository do `app-update.yml`, sestaví NSIS installer, `latest.yml` i blockmap a publikuje je do GitHub Releases. Instalovaná aplikace pak:

1. automaticky zkontroluje novou verzi,
2. zobrazí stav a průběh,
3. stáhne update,
4. nabídne instalaci,
5. bezpečně uzavře databázi a po instalaci aplikaci znovu spustí.

Pro produkční distribuci nastavte repozitářové secrets `WIN_CSC_LINK` a `WIN_CSC_KEY_PASSWORD`. Bez certifikátu je lokální prototyp funkční, ale Windows může zobrazit SmartScreen varování a build nepoužívá Authenticode ověření identity vydavatele.

## Release

1. Zvyšte `version` v `package.json`.
2. Commitněte změnu.
3. Vytvořte odpovídající tag, např. `v0.5.0`.
4. Pushněte tag. GitHub Actions provede testy, build a publikaci.

Nikdy nemíchejte installer a `latest.yml` z různých buildů; updater ověřuje SHA-512 metadata.
