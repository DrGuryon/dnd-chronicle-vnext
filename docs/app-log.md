# Aplikační log a oznámení

`AppLogService` je main-process služba nad tabulkou `app_log_entries`. Udržuje nejvýše 10 000 záznamů a automaticky odstraní záznamy starší než 90 dní. Kategorie jsou application, AI, updater, rules pack a data; každá položka má závažnost, čas, event code, bezpečnou zprávu, volitelnou kampaň a omezené strukturované detaily.

Před zápisem se odstraňují pole označující API klíče, authorization, credentials, hesla, secrets, tokeny, cookies, chain-of-thought, reasoning content nebo raw provider request. Textové hodnoty mají délkové limity a řetězce vypadající jako OpenAI klíče se nahrazují `[REDACTED]`. Log nikdy není důvodem ukládat provider request/response nebo neveřejné reasoning traces.

View **Log** načítá záznamy stránkovaně a serverově filtruje podle závažnosti, kategorie, kampaně a textu. Vymazání vyžaduje potvrzení. Export JSON/TXT prochází stejnými již sanitizovanými daty a uživatel vždy vybírá cílový soubor.

AI runtime zapisuje dokončení, čekání na review, chybu a schválení/zamítnutí návrhu. App updater a rules pack updater zapisují důležité změny stavu, úspěch, selhání i obnovu poškozeného packu. Renderer navíc používá nepersistentní globální toasty pro okamžitou zpětnou vazbu.
