# Rules Content Packs 2.0

Rules content má vlastní verzi nezávislou na aplikaci. Distribuované packy jsou `dnd5e-srd-5.1` a `dnd5e-srd-5.2.1`; oba obsahují pouze otevřený SRD obsah pod CC BY 4.0 a v manifestu nesou atribuci Wizards of the Coast LLC, source URL a update URL.

Pipeline `npm run generate:rules-packs` převádí normalizovaný katalog na verzované `pack.json` a `latest.json`. `npm run check:rules-packs` kontroluje reprodukovatelnost výstupu, unikátní ID a neosiřelé vztahy. Manifest přidává schema version a SHA-256 payloadu.

Main proces ukládá pack do `userData/rules-packs`, ověří velikost, důvěryhodný HTTPS update host, JSON schema version, identitu/verzi, hash, definice a vztahy. Teprve potom v jediné DB transakci aktivuje metadata a normalizovaná katalogová data. Verze je neměnná; změněný obsah musí zvýšit version. Pád validace nebo zápisu nechá předchozí verzi aktivní. Poškozený soubor se při startu obnoví z vestavěné ověřené kopie.

Kampaň ukládá pouze stabilní definition references a Homebrew obsah, nikoli kopii celého packu. Update na novou pack version proto zachová odkazy existujících postav. Aplikace i katalog fungují offline; síť se použije jen při výslovné kontrole aktualizace.
