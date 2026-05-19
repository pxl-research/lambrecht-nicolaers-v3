## Bevestigde diagnose

- Zonder filter: alle rijen terug, kolom `ConversationId` zichtbaar met juiste UUID's.
- Met filter `ConversationId eq '<uuid>'`: `value: []`.

Dit is een bekend gedrag van de Excel Online (Business)-connector: het **tabelschema dat de connector cachet** beschouwt de kolom `ConversationId` niet als een filterbare String. Meestal omdat:
- De kolom werd toegevoegd nadat de tabel al bestond, of
- Het kolomtype is gewijzigd nadat er al data in stond, of
- Er bestaan/bestonden duplicaat-headers waardoor het schema inconsistent is.

Gevolg: filter levert nooit een match → Voorwaarde = Nee → `Update a row` skipt → elke call wordt een Insert.

## Stap 1 — Snelle bevestigingstest (30 seconden)

Vervang in `List rows` de Filter Query door:

```
ConversationId ne 'zzz'
```

- Krijg je **0 rijen** → kolom is niet filterbaar door de connector → ga naar Stap 2.
- Krijg je **alle rijen** → filter werkt; dan zit er een verborgen karakter in de celwaarde (zeldzaam met UUID's die je app netjes schrijft) → ga naar Stap 3.

## Stap 2 — Tabel hernieuwen (definitieve fix voor 90% van de gevallen)

Doe dit in Excel desktop (niet alleen browser):

1. Selecteer een cel in de tabel → tab **Tabelontwerp** → noteer de exacte **Tabelnaam** (heb je later nodig).
2. Klik **Converteren naar bereik**. Bevestig. (Data blijft staan, alleen tabel-opmaak verdwijnt.)
3. Selecteer de volledige kolom `ConversationId` → rechtsklik → **Celeigenschappen** → categorie **Tekst** → OK.
4. Optioneel maar aanbevolen — forceer dat bestaande waardes opnieuw als tekst worden opgeslagen: selecteer de kolom → **Data → Tekst naar kolommen → Vast → Volgende → Volgende → kolomtype Tekst → Voltooien**.
5. Selecteer het volledige datablok inclusief headers → **Ctrl+T** → vink "Mijn tabel bevat kopteksten" aan → OK.
6. Tab **Tabelontwerp** → zet de **Tabelnaam** terug op de oorspronkelijke naam.
7. Bewaar het bestand.
8. In Power Automate: open `List rows` → klik op de **Tabel**-dropdown → selecteer **dezelfde tabel opnieuw** (dit dwingt de connector om het schema te verversen). Doe hetzelfde voor `Update a row` en `Add a row`. Bewaar de flow.
9. Test: nieuw gesprek starten in de app → eerste user-bericht → check Excel: 1 nieuwe rij. Verstuur tweede bericht binnen hetzelfde gesprek → check: rij wordt geüpdatet, géén nieuwe rij.

## Stap 3 — Als Stap 1 toonde dat het een waarde-issue is

Sleep een **Compose**-actie tussen trigger en `List rows`:
- Input: `trim(triggerBody()?['ConversationId'])`
- Zet in de Filter Query: `ConversationId eq '@{outputs('Compose')}'`

Hiermee strip je eventuele onzichtbare whitespace/newlines die in de payload zouden zitten. Tegelijk maakt de Compose-output zichtbaar in run history wat er exact verstuurd wordt, zodat je het kan vergelijken met wat in Excel staat.

## Stap 4 — Backup als niks helpt

Maak een nieuwe lege Excel:
- Eén rij met alleen de headers in dezelfde volgorde als nu.
- Zet `ConversationId` als **Tekst** vóór er één rij data in zit.
- Ctrl+T om er een tabel van te maken.
- Sla op in dezelfde map.

Wijs in Power Automate de drie Excel-acties (`List rows`, `Add row`, `Update row`) naar dit nieuwe bestand + nieuwe tabel. Dit elimineert alle legacy schema-issues.

## Geen app-wijzigingen nodig

De frontend stuurt al consistent dezelfde UUID per gesprek; de edge function geeft de payload ongewijzigd door. De oorzaak en de fix zitten 100% aan Excel/Power Automate-kant.
