# Rules Content Catalog

Katalog je globální, nikoli kopírovaný do jednotlivých kampaní. Vestavěné položky používají stabilní kanonická ID, například `def_dnd5e_2024_species_dwarf`, a nesou:

- kategorii, ruleset a verzi;
- kanonický identifikátor;
- název a lokalizační aliasy;
- zdroj, licenci, `packId` a `packVersion`;
- příznaky Built-in / Homebrew.

Balíky obsahují otevřená data pro druhy/rasy, rody, povolání, základ podtříd, zázemí, dovednosti, jazyky, typy zranění, stavy a menší otevřenou sadu featů a kouzel. Neobsahují proprietární publikovaný obsah ani jeho popisy. Zdrojová metadata odkazují na SRD 5.1 a SRD 5.2.1 pod CC BY 4.0.

Seed používá `INSERT OR IGNORE`, takže opakované otevření databáze nevytváří duplicity. Databázové triggery blokují úpravu a smazání vestavěných definic. Homebrew definice jsou naproti tomu svázané s kampaní, vzniknou jen výslovnou uživatelskou volbou a jejich název, popis i aliasy lze upravit z Entity Card. Taková úprava prochází stejnou validací a administrativním auditem jako editace postavy.

`RulesCatalogService.search` podporuje ruleset, verzi, kategorii, text, zdroj obsahu a omezený počet výsledků. Stejný dotaz používají editory i read-only AI nástroj `chronicle.search_rule_definitions`.

## Rules Packs 2.0

`rule_definition_relations` propojuje definice typy `belongsToSpecies`, `belongsToRace`, `belongsToClass`, `requiresDefinition`, `compatibleWith` a `incompatibleWith`. Editor filtruje rod podle druhu a backend stejný vztah znovu ověří. Homebrew rod nebo podtřída ukládá explicitní parent relation.

Normalizovaný katalog v `src/rules/builtin-catalog.ts` generuje příkaz `npm run generate:rules-packs` do verzovaných JSON souborů v `rules-packs/`. `npm run check:rules-packs` v CI ověřuje, že vygenerované soubory odpovídají zdroji, ID jsou unikátní a vztahy nemají osiřelé reference.

Manifest každého packu uvádí schema version, ruleset, pack/version, licenci, atribuci, source/update URL, datum publikace a SHA-256 obsahu. Aplikace ukládá packy mimo kampaňovou DB, funguje s nimi offline a vzdálenou verzi aktivuje atomicky až po úplné validaci. Neúspěch nechá původní verzi aktivní.

Staré bootstrap Homebrew položky migrace nemění. Reconciliation vyhledá shodu názvu nebo aliasu a nabídne ji uživateli. Teprve potvrzená změna přepíše konkrétní odkaz a zapíše audit.
