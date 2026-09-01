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

Každé otevření vytváří vlastní abortovatelnou session posluchačů. Zavření přes křížek, Zrušit, Escape i úspěšné uložení prochází jedním cleanupem, obnoví fokus a nezanechá staré handlery; opakované otevření proto nemění chování composeru ani zbytku shellu.

Rod/poddruh je závislý picker filtrovaný podle vybraného druhu/rasy. Podtřída se při uložení validuje proti příslušnému povolání. Stejná pravidla platí pro vestavěné i Homebrew definice a backend odmítne ručně podstrčenou neplatnou kombinaci.

Editor zobrazuje také návrhy reconciliation. Každé spárování starého Homebrew odkazu s vestavěnou definicí má vlastní potvrzení a audit.

Editor lze otevřít z aktivní herní plochy i tlačítkem **Upravit postavu** přímo na Character Entity Card. Obě cesty pracují se stejným draftem, revizí a změnovou transakcí.
