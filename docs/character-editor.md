# Character Builder / Editor 2.0

Tvorba a úprava používají stejný editor a stejný `CharacterDraft`.

## Rychlá tvorba

Rychlý režim vyžaduje jméno, druh/rasu, povolání a úroveň. Druh, zázemí a povolání používají vyhledávatelné katalogové vstupy. Neznámý název se nepřevede na Homebrew automaticky; uživatel musí zaškrtnout odpovídající volbu.

## Rozšířený režim

Rozšířený editor pokrývá:

- identitu a typ postavy;
- druh, rod, zázemí, podtřídu a multiclass;
- šest vlastností;
- biografii, vzhled, osobnost, ideály, pouta a slabiny;
- zdatnosti a jazyky;
- featy/schopnosti;
- základ sesílání a kouzla;
- poznámky.

Formulář je skrolovatelný a použitelný při 800×600. Zavření změněného formuláře zobrazí varování. Tlačítko Uložit vytvoří jednu `DataChangeTransaction`; při zastaralé revizi vyžádá nové načtení místo tichého přepsání.

Editor zobrazuje také návrhy reconciliation. Každé spárování starého Homebrew odkazu s vestavěnou definicí má vlastní potvrzení a audit.

Editor lze otevřít z aktivní herní plochy i tlačítkem **Upravit postavu** přímo na Character Entity Card. Obě cesty pracují se stejným draftem, revizí a změnovou transakcí.
