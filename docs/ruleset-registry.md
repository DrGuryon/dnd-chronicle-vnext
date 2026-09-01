# Ruleset Registry

Milestone 8 odstraňuje validační podmínky pevně zapsané v IPC vrstvě. `RulesetRegistry` poskytuje typované deskriptory rulesetů a jejich verzí. Dialog nové kampaně načítá nabídku přímo z registru.

Vestavěné deskriptory:

- `dnd5e@2014` s balíkem `dnd5e-srd-5.1`;
- `dnd5e@2024` s balíkem `dnd5e-srd-5.2`.

Každá verze uvádí zobrazovaný název, ID a verzi katalogového balíku, zdroj a terminologii. Další ruleset lze zaregistrovat novým deskriptorem. Pokud má mít také výpočty, přidá samostatnou implementaci do `RulesEngineRegistry`; doménové schéma kvůli tomu není nutné měnit.

Kampaň dál ukládá dvojici `ruleset_id` + `ruleset_version`. Každý odkaz na definici se při změnové transakci kontroluje proti této dvojici a proti kampani u Homebrew obsahu.
