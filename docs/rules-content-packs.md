# Rules Content Packs 3.0

Rules content má vlastní verzi nezávislou na aplikaci. Distribuované packy jsou `dnd5e-srd-5.1` a `dnd5e-srd-5.2.1`; oba obsahují pouze otevřený SRD obsah pod CC BY 4.0 a v manifestu nesou atribuci Wizards of the Coast LLC, source URL a update URL.

Pipeline `npm run generate:rules-packs` převádí normalizovaný katalog na verzované `pack.json` a `latest.json`. `npm run check:rules-packs` kontroluje reprodukovatelnost výstupu, unikátní ID a neosiřelé vztahy. Manifest přidává schema version a SHA-256 payloadu. Schema 3 vedle definic a vztahů ukládá anglický dokument a jeho lokalizace, typovaný obsah, významové sekce, indexovaný text, úplnost, přesnou referenci zdroje a případnou atribuci adaptace. Starší schema 1 zůstává čitelné jako částečný záznam bez domýšleného obsahu.

Main proces ukládá pack do `userData/rules-packs`, ověří velikost, důvěryhodný HTTPS update host, JSON schema version, identitu/verzi, hash, definice, lokalizované typované dokumenty a vztahy. Teprve potom v jediné DB transakci aktivuje metadata, normalizovaná katalogová data a odvozený vícejazyčný FTS index. Verze je neměnná; změněný obsah musí zvýšit version. Vzdálená aktualizace nesmí aktivní pack snížit na starší verzi. Pád validace nebo zápisu nechá předchozí verzi aktivní. Poškozený soubor se při startu obnoví z vestavěné ověřené kopie a fulltextový index se z aktivních dat znovu sestaví.

Kampaň ukládá pouze stabilní definition references a Homebrew obsah, nikoli kopii celého packu. Update na novou pack version proto zachová odkazy existujících postav. Aplikace i katalog fungují offline; síť se použije jen při výslovné kontrole aktualizace.
