# D&Dpedie

D&Dpedie je globální read-only katalog otevřených pravidel. Nepotřebuje aktivní kampaň a zobrazuje pouze definice z právě aktivních vestavěných rules packů. Homebrew do ní nevstupuje; zůstává přísně svázané se svojí kampaní.

## Datový tok

Renderer přistupuje ke katalogu výhradně přes úzké IPC kontrakty `searchDndpedia` a `getDndpediaEntry`. Main proces provádí stránkované SQL dotazy nad SQLite FTS5, skládá facety z aktivních dat a detail převádí do typovaného read modelu. Název i kanonické ID otevírají stejný resolver detailu. Tento resolver používají také Entity Cards a AI nástroje pro vestavěné definice.

Výsledky podporují hledání lokalizovaného názvu a textu, aliasů, kanonického ID, řazení, filtr pravidlové verze, typu a zdroje a stabilní stránkování. Vyhledávací pole je během asynchronního načítání výsledků stabilní, takže psaní ani pauza neodebírají fokus. UI nezobrazuje raw JSON ani interní ID; ta zůstávají vyhrazená budoucímu vývojářskému režimu. Strukturované záznamy renderuje jako typované facts, popis a významové sekce.

## Jazyky

Jazyk rozhraní a preferované jazyky D&Dpedie jsou dvě samostatná globální nastavení uložená v databázi aplikace. Rozhraní podporuje češtinu a angličtinu. Registry D&Dpedie nabízí češtinu, angličtinu, němčinu, španělštinu, francouzštinu a italštinu; distribuovaný otevřený obsah je nyní dostupný v anglickém originálu a české adaptaci. Výchozí pořadí obsahu je čeština, potom angličtina.

Detail vybírá požadovaný jazyk samostatně pro právě otevřenou kartu. Není-li dostupný, použije anglický originál a fallback viditelně označí. Tato volba nemění globální nastavení. České texty jsou vlastní terminologická adaptace otevřených SRD dat; aplikace neimportuje cizí neoficiální překlady.

## Rules Pack schema 3

Pack schema 3 rozšiřuje stabilní definice o verzovaný dokument a jeho lokalizace:

- krátký a úplný popis;
- typovaný obsah podle druhu definice;
- významové sekce a text pro hledání;
- přesnou referenci zdroje;
- úplnost záznamu, verzi obsahového schématu a atribuci jazykové adaptace.

Balíček se před aktivací kontroluje jako celek: identita, SHA-256, typovaný obsah, reference i vztahy. Definice, dokumenty, vztahy, aktivní verze a FTS index se přepnou v jediné databázové transakci. Nevalidní aktualizace se vrátí zpět a předchozí verze zůstane aktivní. FTS je odvozený index a při startu se bezpečně znovu vytvoří z aktivních zdrojových záznamů.

## Schéma databáze

Migrace v9 přidává striktní tabulku `rule_definition_documents`, rozšířené typy vztahů a virtuální tabulku `dndpedia_fts`. Migrace v10 přidává lokalizovaný název, krátký popis a atribuci adaptace a ukládá samostatné globální jazykové preference. Před migrací existující databáze vznikne konzistentní backup. Migrace i start databáze končí kontrolou cizích klíčů; chyba zabrání dokončení migrace.

## Přístupnost a chybové stavy

Seznam používá sémantickou tabulku, popsané ovládací prvky, živou oblast pro počet výsledků a plně klávesnicový detail v nativním dialogu. Zavření vrací fokus na prvek, který detail otevřel. Rozložení facts přechází ze čtyř sloupců na dva a následně na jeden. Samostatné stavy pokrývají načítání, prázdný katalog, nulový výsledek, chybu, opakování i odkaz do nastavení balíčků. Horní lišta D&Dpedie dovoluje výslovně zkontrolovat aktualizace aktivních zdrojů a průběh i výsledek oznámí bez ztráty rozepsaného dotazu.

## Obsah a licence

Distribuované balíčky `dnd5e-srd-5.1` a `dnd5e-srd-5.2.1` verze 3.0.0 obsahují 215 platných verzovaných záznamů z otevřených SRD pod CC BY 4.0, vždy s anglickým dokumentem a českou adaptací. Kombinace pravidlové verze a definice, které v příslušném SRD neexistují, se nevytvářejí. Každý detail ukazuje ruleset, verzi packu, jazyk, licenci, atribuci a zdroj. Projekt do katalogu nepřidává proprietární popisy.

Obsah se deterministicky generuje skriptem `scripts/import-open-srd-content.mjs` z připnutých revizí strojově čitelného převodu 5e-bits a markdown převodu SRD 5.2.1; výsledky se kontrolují proti oficiálním CC BY PDF. Do repozitáře se ukládá vygenerovaný asset, nikoli pracovní kopie vstupních repozitářů nebo PDF. Česká varianta je vlastní stručná adaptace stejného strukturovaného faktového modelu a mechanicky významných pasáží; nepřebírá fanouškovské překlady. Anglický originál zůstává vždy samostatným dokumentem.

Z původního sjednoceného návrhu katalogu byly jako nepravdivé kombinace odfiltrovány:

- SRD 5.1 (2014): zázemí Criminal, Sage a Soldier; výkony Skilled a Tough;
- SRD 5.2.1 (2024): druhy Half-Elf a Half-Orc; rody Hill Dwarf, High Elf a Lightfoot Halfling; výbava Rope, Hempen; výkon Tough.

Výsledkem je 108 definic pro SRD 5.1 a 107 definic pro SRD 5.2.1. Přidání chybějící kombinace vyžaduje doložit ji odpovídajícím otevřeným zdrojem, nikoli kopírovat mechaniku z jiné verze pravidel.
