# Rules Content Catalog

Katalog je globální, nikoli kopírovaný do jednotlivých kampaní. Vestavěné položky používají stabilní kanonická ID, například `def_dnd5e_2024_species_dwarf`, a nesou:

- kategorii, ruleset a verzi;
- kanonický identifikátor;
- název a lokalizační aliasy;
- zdroj, licenci, `packId` a `packVersion`;
- příznaky Built-in / Homebrew.

Balík obsahuje otevřená data pro druhy/rasy, rody, povolání, základ podtříd, zázemí, dovednosti, jazyky, typy zranění, stavy a menší otevřenou sadu featů a kouzel. Neobsahuje proprietární publikovaný obsah ani jeho popisy. Zdrojová metadata odkazují na SRD 5.1 nebo SRD 5.2 pod CC BY 4.0.

Seed používá `INSERT OR IGNORE`, takže opakované otevření databáze nevytváří duplicity. Databázové triggery blokují úpravu a smazání vestavěných definic. Homebrew definice jsou naproti tomu svázané s kampaní, vzniknou jen výslovnou uživatelskou volbou a jejich název, popis i aliasy lze upravit z Entity Card. Taková úprava prochází stejnou validací a administrativním auditem jako editace postavy.

`RulesCatalogService.search` podporuje ruleset, verzi, kategorii, text, zdroj obsahu a omezený počet výsledků. Stejný dotaz používají editory i read-only AI nástroj `chronicle.search_rule_definitions`.

Staré bootstrap Homebrew položky migrace nemění. Reconciliation vyhledá shodu názvu nebo aliasu a nabídne ji uživateli. Teprve potvrzená změna přepíše konkrétní odkaz a zapíše audit.
