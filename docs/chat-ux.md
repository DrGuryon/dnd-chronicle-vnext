# Chat UX

Zprávy hráče jsou zarovnané vpravo, odpovědi Chronicle vlevo. Bublina používá šířku podle obsahu nejvýše 75 % prostoru, běžný text se zalamuje a code/pre bloky mají vlastní horizontální scroll.

Composer začíná na jednom řádku a automaticky roste nejvýše na osm řádků. Enter odešle právě jednou, Shift+Enter vloží nový řádek. `KeyboardEvent.isComposing`, lokální composition state a keyCode 229 chrání IME vstup před předčasným odesláním. Během aktivního tahu lze tah zastavit a textové pole je znovu dostupné po completed, failed i cancelled události.

Character Editor používá vlastní `AbortController` pro každé otevření. Všechny cesty zavření provádějí jednotný cleanup a vracejí fokus, takže editor nepřenáší Escape, submit ani input listenery do composeru. Globální toast oznamuje chyby a výsledek použití/zamítnutí návrhu; detail návrhu zůstává přímo v chatu.
