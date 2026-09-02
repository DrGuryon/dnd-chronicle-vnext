# D&D Chronicle vNext

Windows aplikace s použitelným campaign workflow, lokální SQLite databází, Chronicle Engine, streamovaným AI vypravěčem přes OpenAI Responses API, interaktivním Character Cockpitem, NSIS instalátorem a integrovaným updaterem.

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

Schéma v9 odděluje pravidlové Definition, konkrétní Instance, současný State a historický Event. Přidává globální fulltextovou D&Dpedii s typovanými dokumenty, vztahy mezi pravidlovými definicemi, samostatně aktualizovatelné rules packy, omezený sanitizovaný aplikační log a telemetrii AI nástrojů. Character Builder/Editor 2.0 a idempotentní `DataChangeTransaction` dál sjednocují ruční i AI úpravy profilu. Administrativní audit je oddělený od událostí fikčního světa.

Renderer SQL ani API klíč přímo nepoužívá. Chronicle Engine sestavuje malý Hot SceneContext, nabízí bounded Warm/Cold retrieval a atomicky validuje strukturované změny. OpenAI adapter používá oficiální SDK a Responses API s `store: false`, paralelizuje pouze nezávislá čtení, používá turnovou cache a bezpečný rozpočet 12 kol / 40 volání. Běžné testy používají Fake provider a síť nevolají. Nové vrstvy popisují [`docs/dndpedia.md`](docs/dndpedia.md), [`docs/rules-content-catalog.md`](docs/rules-content-catalog.md), [`docs/character-editor.md`](docs/character-editor.md), [`docs/ai-orchestration.md`](docs/ai-orchestration.md) a [`docs/app-log.md`](docs/app-log.md).

## Nastavení AI

API klíč se zadává až v aplikaci přes **Nastavení AI**. Main proces ho uloží přes Electron `safeStorage` mimo databázi kampaně. Pokud systémové šifrování není dostupné, klíč zůstane jen v paměti do ukončení aplikace; nezašifrovaný soubor se nevytvoří. Výchozí model je `gpt-5.6-sol` a lze změnit reasoning, podrobnost, tokenový limit, pokyny kampaně i režim schválení `review / automatic / manual`.

## Aktualizace

Lokální build úmyslně nemá natvrdo zadaný cizí release server. Release workflow při tagu `v*` doplní aktuální GitHub repository do `app-update.yml`, sestaví NSIS installer, `latest.yml` i blockmap a publikuje je do GitHub Releases. Instalovaná aplikace pak:

1. automaticky zkontroluje novou verzi,
2. zobrazí stav a průběh,
3. stáhne update,
4. nabídne instalaci,
5. bezpečně uzavře databázi a po instalaci aplikaci znovu spustí.

Pro produkční distribuci nastavte repozitářové secrets `WIN_CSC_LINK` a `WIN_CSC_KEY_PASSWORD`. Bez certifikátu je lokální prototyp funkční, ale Windows může zobrazit SmartScreen varování a build nepoužívá Authenticode ověření identity vydavatele.

Balíčky otevřených pravidel se aktualizují odděleně od aplikace v **Nastavení → Balíčky pravidel**. Stažený JSON se před aktivací kontroluje podle schématu, referencí a SHA-256; při chybě nebo nedostupné síti zůstane aktivní poslední ověřená kopie. Aplikace funguje i zcela offline. Každý pack zobrazuje licenci, atribuci a odkaz na zdroj; součástí projektu není proprietární obsah mimo uvedené otevřené SRD zdroje.

## Release

1. Zvyšte `version` v `package.json`.
2. Commitněte změnu.
3. Vytvořte odpovídající tag, např. `v0.9.0`.
4. Pushněte tag. GitHub Actions provede testy, build a publikaci.

Nikdy nemíchejte installer a `latest.yml` z různých buildů; updater ověřuje SHA-512 metadata.
