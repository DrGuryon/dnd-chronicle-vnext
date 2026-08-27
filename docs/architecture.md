# Architecture — foundation milestone

## Hranice procesu

- **Main process** vlastní okna, SQLite connection a updater. Je jedinou vrstvou s přímým přístupem k disku.
- **Preload bridge** publikuje úzké typované API. Renderer nedostává Node.js ani Electron API.
- **Renderer** vykresluje prázdný shell a stav instalace, databáze a updateru.

`contextIsolation`, Chromium sandbox a vypnuté `nodeIntegration` jsou povinné bezpečnostní hranice.

## Persistovaná data

SQLite je lokální source of truth. Soubor je v `app.getPath('userData')/data/chronicle.db`, nikdy v instalačním adresáři. Zapnuté jsou foreign keys, WAL a busy timeout.

Schéma používá monotónní `PRAGMA user_version` a auditní tabulku `schema_migrations`. Migrace běží v `BEGIN IMMEDIATE` transakci. Aplikace odmítne otevřít databázi s novějším schématem, aby downgrade nepoškodil data. Před každým skutečným upgradem existující databáze vytvoří SQLite backup do `userData/backups`.

První schéma obsahuje jen aplikační metadata a základní tabulku kampaní. Entity model zůstává záměrně mimo tento milník.

## Update pipeline

`electron-builder` vytváří standardní per-user NSIS installer. GitHub release workflow při tagu sestaví installer, blockmap a `latest.yml`; `electron-updater` čte release konfiguraci vloženou do `app-update.yml`.

Updater je řízen main procesem a renderer dostává pouze stavové události. Před ukončením procesu se provede WAL checkpoint a uzavře SQLite connection. `quitAndInstall(false, true)` následně spustí NSIS update a znovu otevře aplikaci.

Produkční vydání musí být Authenticode podepsané. Build konfigurace zapne kontrolu podpisu, pokud je přítomen signing certifikát; lokální unsigned build používá SHA-512 integritu metadat, ale není určený k veřejné distribuci.

## Další milník

Další práce může přidat import starého formátu a plný entity/event/state/relation model bez změny instalačního základu nebo umístění dat.
