# AI Orchestration: svět vs. profil

Core prompt od Milestone 8 rozlišuje dva záměry:

- změna probíhajícího fikčního světa používá `chronicle.propose_turn_transaction`;
- výslovně požadovaná úprava profilu nebo kanonického setupu používá `chronicle.propose_data_changes`.

Oba nástroje jsou z pohledu provideru non-mutating. Pouze sestaví a validují návrh. AI nemá commit ani SQL nástroj. Trvalý zápis nastane až podle režimu schválení kampaně; výchozí `review` zobrazí lidsky čitelný seznam změn s tlačítky Použít a Zamítnout.

Jednotlivé read-only dotazy doplňují kompozitní nástroje `chronicle.search_rule_definitions_batch` (max. 20 dotazů), `chronicle.get_entities_context` (max. 20 entit) a `chronicle.get_character_edit_context`. Deskriptory explicitně rozlišují `read` a `proposal` a uvádějí, zda lze výsledek bezpečně cachovat.

Návrh dat používá stejný `DataChangeService` jako ruční editor, takže má totožnou kontrolu kampaně, rulesetu, typů, revize, atomicity a idempotence. Zamítnutí stav nemění. Použití obnoví read modely běžným novým načtením UI a zapíše pouze administrativní audit, nikoli událost světa.

OpenAI adapter dál používá Responses API, `store: false`, striktní provider-kompatibilní JSON Schema a bezpečné mapování názvů function tools. `gpt-5.6-sol` nabízí reasoning `none`, `low`, `medium`, `high`, `xhigh` a `max`; historická hodnota `minimal` se normalizuje na `low`.

## Rozpočet a cache jednoho tahu

- shodný read se během tahu provede jen jednou; klíčem je název nástroje a kanonický JSON argumentů;
- širší již načtený Character context může obsloužit požadavek na podmnožinu sekcí;
- nezávislé read calls z jednoho kola běží paralelně, proposal calls vždy sekvenčně;
- při 75 % rozpočtu dostane model pokyn dávkovat a dokončit práci;
- výchozí pevný strop je 12 kol / 40 volání. Po jeho dosažení adapter nevyhodí technickou chybu, zakáže další nástroje a vyžádá stručnou finální odpověď.

`ai_turn_runs.tool_usage_json` ukládá `totalCalls`, `totalRounds`, počty podle nástroje, cache hits, odvrácené duplicity a příznak dosažení maxima. Neukládá raw provider request ani neveřejné reasoning traces.
