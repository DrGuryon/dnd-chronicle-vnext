# AI runtime

## Bezpečnostní hranice

- API klíč zadává uživatel v aplikaci. Main process ho šifruje pomocí Electron `safeStorage` do `userData/secrets`; renderer dostává pouze stav a poslední čtyři znaky.
- Pokud `safeStorage` není dostupné, klíč se použije jen pro aktuální session. Plaintext fallback soubor neexistuje.
- Klíč, provider response ani chain-of-thought nejsou součástí campaign SQLite databáze, logu, návrhu ani IPC odpovědi.
- OpenAI Responses požadavky používají `store: false`. Lokální `conversation_messages` jsou jediná kanonická historie chatu.

## Tok tahu

```text
user Message (local) → small SceneContext + recent local Messages
                     → OpenAI Responses stream
                     → cached/batched Chronicle tools (max 12 rounds / 40 calls)
                     → non-mutating proposal validation
                     → final assistant Message (local)
                     → review/manual approval OR automatic local commit
```

Model nedostává SQL, generický patch ani commit tool. `chronicle.propose_turn_transaction` pouze normalizuje nová ID a volá deterministický validator. Neplatný návrh může model v dalším tool kole opravit; po finálním textu se použije jen poslední platný.

## Nastavení a audit

Každá Campaign má provider, model (výchozí `gpt-5.6-sol`), reasoning effort, verbosity, max output tokens, approval policy a vlastní instrukce. `ai_turn_runs` ukládá stav, prompt version, model, časy, provider response ID, dostupné token counts a agregovaný souhrn použití nástrojů. Cena se nehardcoduje, protože se může měnit.

Pro modely GPT-5.6 aplikace nabízí `none`, `low`, `medium`, `high` a `xhigh`. Starší uložená hodnota `minimal` se při použití GPT-5.6 bezpečně interpretuje jako `low`; databázové schéma se kvůli tomu nemění. Test připojení neposílá modelově specifický reasoning effort.

## Testování

CI nepoužívá skutečný API klíč ani placené volání. `FakeAiProvider` pokrývá stream/proposal/approval flow a OpenAI adapter má simulované Responses streamy včetně strict tools, multi-tool replay, usage a mapování chyb. Skutečné připojení spouští pouze uživatel tlačítkem **Otestovat připojení** po zadání vlastního klíče.
