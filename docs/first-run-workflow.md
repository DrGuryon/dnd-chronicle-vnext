# First-run workflow

Čistá instalace nepotřebuje seed data ani vývojářské nástroje. Databáze v6 se vytvoří automaticky a uživatel je veden po jediné cestě:

```text
Přehled
→ Nová kampaň
→ hráčská postava
→ konverzace
→ Nastavení AI
→ první tah
```

## 1. Kampaň

Tlačítko **Vytvořit první kampaň** otevře běžný form dialog. Povinný je název; výchozí ruleset je `dnd5e` a verze `2024`, volitelně lze zvolit `2014`.

Create jde přes typed IPC a domain/service vrstvu. Main proces použije standardní ID factory, vytvoří `CampaignRuntimeState`, nastaví pracovní kampaň a renderer otevře Play view. Přejmenování používá stejný reusable dialog. Archivace je soft-delete s potvrzením a fyzická data nemaže.

## 2. První postava

Kampaň bez PC ukáže vysvětlení a CTA **Vytvořit postavu**. MVP dialog vyžaduje pouze jméno; celé jméno, druh, zázemí a povolání jsou volitelné, úroveň má výchozí hodnotu 1.

Domain service vytvoří validní PC s bezpečnými počátečními hodnotami (atributy 10, HP 10, AC 10, rychlost 30 ft a úroveň 1). První PC se automaticky nastaví jako aktivní a Character Cockpit se ihned načte. Základní identitu lze později upravit.

## 3. První konverzace

Kampaň bez otevřené scény ukáže CTA **Nová konverzace**. Název je volitelný a první dialog nabízí `Začátek`. Po vytvoření se konverzace uloží, nastaví jako aktivní a chat ji začne používat. Běžný workflow nepoužívá `window.prompt()` ani `window.confirm()`.

## 4. AI Settings

Globální **Nastavení** je dostupné i bez kampaně nebo konverzace. API klíč se nikdy nedodává s aplikací; zadává ho výhradně uživatel v Settings. Lze jej nahradit, odstranit a otestovat spojení i bez aktivní konverzace.

Model, reasoning, verbosity, limit výstupu, approval policy a campaign instructions patří konkrétní kampani. Bez vybrané kampaně Settings zobrazí vysvětlení místo nefunkčních ovládacích prvků.

Pokud chybí klíč, postava nebo konverzace, Chat ukáže přesný důvod a odpovídající CTA. Composer není mrtvý bez vysvětlení.

## 5. Restart a obnovení

Renderer ukládá `lastActiveCampaignId`, poslední view a viditelnost Cockpitu jako lokální UI preference. Po restartu:

- bez kampaní se otevře onboarding Přehledu,
- existující poslední kampaň se otevře v Play,
- runtime obnoví aktivní PC a konverzaci,
- zprávy zůstanou v SQLite,
- Cockpit respektuje uloženou viditelnost, šířku a section preferences.

Neplatné nebo archivované poslední ID se bezpečně zahodí a aplikace zvolí existující kampaň nebo Přehled.

## Automatizovaná acceptance

`tests/workspace-m7.test.ts` ověřuje fresh DB, Ravenford → Arqos → Začátek, Fake AI tah, persistenci zpráv, restart a bezpečnou archivaci. `tests/renderer-state-m7.test.ts` ověřuje routing, UI preference a zákaz nativních prompt/confirm dialogů.

Pro zabalenou aplikaci lze při lokálně zapnutém CDP endpointu spustit:

```powershell
node scripts/m7-ui-smoke.mjs
```

Smoke průchod ovládá skutečný renderer, navštíví Settings, Library, Campaigns i Play a kontroluje podporované rozměry bez skutečného OpenAI požadavku.
