# Editable Chronicle Domain

Trvalé profilové a kanonické údaje se mění přes jedinou vrstvu `DataChangeService`. Ruční editor i AI návrh používají stejný diskriminovaný typ `DataChange` a stejnou validaci.

## Transakce

`DataChangeTransaction` obsahuje stabilní ID, kampaň, původ (`manual`, `ai`, `system`), čitelný souhrn, seznam typovaných operací, očekávané revize entit a volitelné odkazy na AI běh a zprávu.

Podporované primitivy Milestone 8 zahrnují:

- vytvoření postavy a úpravu identity, biografie, původu a poznámek;
- přidání, změnu a odebrání povolání;
- hodnoty vlastností;
- zdatnosti a jazyky;
- featy/schopnosti;
- zdroje sesílání a kouzla;
- vytvoření kampaňového Homebrew pojmu;
- potvrzené přesměrování starého odkazu na kanonickou definici.

Neexistuje operace typu „update any field“, obecný JSON patch ani SQL nástroj.

## Garance

- `BEGIN IMMEDIATE` zajistí all-or-nothing zápis.
- Odkazy se kontrolují proti kampani, rulesetu, typu definice a vlastníkovi řádku.
- Stejné ID se stejným payloadem je idempotentní; jiné použití stejného ID je konflikt.
- `entities.revision` chrání editor před přepsáním souběžné změny.
- Audit ukládá transakci, původ, souhrn, dotčené entity a before/after položky.
- Administrativní změna nevytváří `Event`. Příběhové změny dál patří do `TurnTransaction`.

Schéma databáze je v7. Migrace zachovává všechny cesty ze starších verzí a před změnou existující databáze vytváří zálohu.
