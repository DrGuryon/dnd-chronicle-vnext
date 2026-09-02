# D&Dpedie

D&Dpedie je globální read-only katalog otevřených pravidel. Nepotřebuje aktivní kampaň a zobrazuje pouze definice z právě aktivních vestavěných rules packů. Homebrew do ní nevstupuje; zůstává přísně svázané se svojí kampaní.

## Datový tok

Renderer přistupuje ke katalogu výhradně přes úzké IPC kontrakty `searchDndpedia` a `getDndpediaEntry`. Main proces provádí stránkované SQL dotazy nad SQLite FTS5, skládá facety z aktivních dat a detail převádí do typovaného read modelu. Název i kanonické ID otevírají stejný resolver detailu. Tento resolver používají také Entity Cards a AI nástroje pro vestavěné definice.

Výsledky podporují hledání názvu, aliasů, kanonického ID a indexovaného textu, řazení, filtr pravidlové verze, typu a zdroje a stabilní stránkování. UI nezobrazuje raw JSON. Úplné záznamy renderuje jako typované facts, popis a významové sekce; starší neúplné záznamy jsou výslovně označené a aplikace jim žádný obsah nedoplňuje.

## Rules Pack schema 3

Pack schema 3 rozšiřuje stabilní definice o verzovaný dokument:

- krátký a úplný popis;
- typovaný obsah podle druhu definice;
- významové sekce a text pro hledání;
- přesnou referenci zdroje;
- úplnost záznamu a verzi obsahového schématu.

Balíček se před aktivací kontroluje jako celek: identita, SHA-256, typovaný obsah, reference i vztahy. Definice, dokumenty, vztahy, aktivní verze a FTS index se přepnou v jediné databázové transakci. Nevalidní aktualizace se vrátí zpět a předchozí verze zůstane aktivní. FTS je odvozený index a při startu se bezpečně znovu vytvoří z aktivních zdrojových záznamů.

## Schéma databáze

Migrace v9 přidává striktní tabulku `rule_definition_documents`, rozšířené typy vztahů a virtuální tabulku `dndpedia_fts`. Před migrací existující databáze vznikne konzistentní backup. Migrace i start databáze končí kontrolou cizích klíčů; chyba zabrání dokončení migrace.

## Přístupnost a chybové stavy

Seznam používá sémantickou tabulku, popsané ovládací prvky, živou oblast pro počet výsledků a plně klávesnicový detail v nativním dialogu. Zavření vrací fokus na prvek, který detail otevřel. Rozložení facts přechází ze čtyř sloupců na dva a následně na jeden. Samostatné stavy pokrývají načítání, prázdný katalog, nulový výsledek, chybu, opakování i odkaz do nastavení balíčků.

## Obsah a licence

Distribuované balíčky `dnd5e-srd-5.1` a `dnd5e-srd-5.2.1` obsahují otevřená data SRD pod CC BY 4.0. Každý detail ukazuje ruleset, verzi packu, jazyk, licenci, atribuci a zdroj. Projekt do katalogu nepřidává proprietární popisy.
