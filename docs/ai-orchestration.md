# AI Orchestration: svět vs. profil

Core prompt od Milestone 8 rozlišuje dva záměry:

- změna probíhajícího fikčního světa používá `chronicle.propose_turn_transaction`;
- výslovně požadovaná úprava profilu nebo kanonického setupu používá `chronicle.propose_data_changes`.

Oba nástroje jsou z pohledu provideru non-mutating. Pouze sestaví a validují návrh. AI nemá commit ani SQL nástroj. Trvalý zápis nastane až podle režimu schválení kampaně; výchozí `review` zobrazí lidsky čitelný seznam změn s tlačítky Použít a Zamítnout.

`chronicle.search_rule_definitions` je omezený read-only katalogový dotaz. Prompt vyžaduje jeho použití před návrhem kanonického odkazu a zakazuje vymýšlení existujících ID.

Návrh dat používá stejný `DataChangeService` jako ruční editor, takže má totožnou kontrolu kampaně, rulesetu, typů, revize, atomicity a idempotence. Zamítnutí stav nemění. Použití obnoví read modely běžným novým načtením UI a zapíše pouze administrativní audit, nikoli událost světa.

OpenAI adapter dál používá Responses API, `store: false`, striktní provider-kompatibilní JSON Schema a bezpečné mapování názvů function tools. `gpt-5.6-sol` nabízí reasoning `none`, `low`, `medium`, `high`, `xhigh` a `max`; historická hodnota `minimal` se normalizuje na `low`.
