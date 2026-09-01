# AI Tool Efficiency

Každý AI tah vytváří izolovanou read cache. Klíčem je název nástroje a stabilně seřazený JSON argumentů; pět shodných čtení proto znamená jedno spuštění databázového dotazu a čtyři cache hits. U Character contextu může dříve načtená nadmnožina sekcí obsloužit pozdější užší požadavek.

Kompozitní nástroje snižují režii:

- `chronicle.search_rule_definitions_batch` spojí až 20 katalogových hledání;
- `chronicle.get_entities_context` načte až 20 známých entit;
- `chronicle.get_character_edit_context` vrátí editovatelný profil, revizi a použité definice.

Tool descriptor má `kind: read | proposal` a `cacheable`. OpenAI Responses API může v jednom kole vrátit paralelní calls; adapter souběžně provede pouze kolo složené z read tools. Jakékoli kolo obsahující proposal zůstává sekvenční, aby bylo deterministické pořadí validovaných návrhů.

Výchozí rozpočet je 12 tool rounds / 40 tool calls. Při 75 % model dostane měkký pokyn seskupit zbývající čtení. Při tvrdém stropu se další nástroje neprovedou a model vytvoří finální odpověď z již načtených dat. Agregovaný `ToolUsageSummary` se uloží do `ai_turn_runs`, bez raw requestů a neveřejného reasoning obsahu.
