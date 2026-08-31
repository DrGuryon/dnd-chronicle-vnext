# Application shell

Milestone 7 používá jediný renderer bez frameworkového routeru. Přepnutí view pouze mění aktivní panel; Electron window ani načtená kampaň se nereloadují.

## Views

- **Přehled** – onboarding pro prázdnou instalaci, pokračování v poslední kampani, stav databáze a updateru.
- **Kampaně** – seznam lokálních kampaní, vytvoření, otevření, přejmenování a bezpečná archivace.
- **Hrát** – kompaktní campaign bar, chat, composer a Character Cockpit.
- **Knihovna** – kategorie entit aktuální kampaně, filtrování a otevření existující Entity Card.
- **Nastavení** – globální API klíč a test spojení, nastavení AI pro kampaň, aktualizace, úložiště a informace o aplikaci.

Aktivní view, poslední kampaň a viditelnost Cockpitu jsou UI preference v `localStorage`. Nejsou součástí world state ani databázového schématu. Schéma zůstává v6.

## Výška a scrolling

Shell zabírá přesně celý viewport. `body` se neposouvá a grid má ve všech osách `min-height: 0` / `min-width: 0`.

- `workspace-main` omezuje hlavní sloupec na viewport a povoluje vertikální scroll.
- Běžné obrazovky scrollují ve vlastním `.view-scroll`.
- Play view drží campaign bar nahoře, chat používá `minmax(0, 1fr)` a composer zůstává dosažitelný dole.
- Sidebar má vlastní scrollovatelnou navigaci a samostatný footer.
- Character Cockpit má vlastní `.cockpit-scroll`; neposouvá chat ani sidebar.
- Form dialog omezuje výšku podle viewportu, scrolluje jen obsah formuláře a nechává footer s akcemi dostupný.

## Character Cockpit

Na široké obrazovce je Cockpit samostatný pravý sloupec. Lze jej skrýt, znovu zobrazit a měnit jeho šířku myší nebo šipkami na přístupném separatoru. Rozsah je 300–720 px a uložená šířka se načte s Character preferences.

Pod 1100 px se pravý sloupec automaticky uvolní pro chat. Tlačítko **Postava** otevře Cockpit jako drawer. Pod 1180 px se sidebar přepne na ikonový režim, ale popisky zůstávají přístupné čtečkám a přes `title`.

## Manuální screenshot checklist

Kontrolované rozměry:

| Viewport | Cockpit | Ověření |
|---|---|---|
| 2560×1440 | pravý panel | bez horizontálního overflow, samostatný scroll |
| 1920×1080 | pravý panel | chat a composer dosažitelné |
| 1600×900 | pravý panel | navigace i campaign bar bez ořezu |
| 1366×768 | pravý panel | composer, Cockpit a dolní obsah dostupné |
| 1280×720 | pravý panel | hlavní workspace zůstává použitelný |
| 1000×700 | skrytý + restore/drawer | uvolněná šířka pro hlavní view |
| 800×600 | skrytý + restore/drawer | kompaktní navigace, dialog s interním scrollem |

Při každé kontrole ověřit: žádný hlavní horizontální scrollbar, navigaci, chat, composer, samostatný Cockpit scroll, dostupný dialog footer a scroll až na poslední obsah. Rozměr 800×600 se kontroluje také při 150% device scale; 125% a 150% nesmí oříznout tlačítka ani dialog footer.

Pomocný `scripts/m7-ui-smoke.mjs` projde první spuštění přes skutečný zabalený renderer a změří uvedené viewporty přes lokální Chromium debug endpoint. Nepoužívá skutečný OpenAI klíč ani síťový AI call.
