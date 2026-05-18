
## Probleem
Elke webhook-call (advies-log, rating-update, mid-gesprek afbreken, off-topic) maakt in Power Automate een **nieuwe rij** in Excel aan. We willen **één rij per gesprek** die meegroeit, en die rij moet ook geschreven worden als de gebruiker op een onverwacht moment stopt (tab sluit, refresh, langere inactiviteit).

## Aanpak in twee lagen
De oplossing zit deels in de app (alles linken aan dezelfde `ConversationId` + alle stop-momenten afdekken) en deels in Power Automate (upsert in plaats van insert). Beide moeten samen werken.

---

## 1. Frontend — webhook-calls consolideren

### Eén identifier, één payload-vorm
- `conversationIdRef` (al aanwezig, uuid) blijft de unieke sleutel voor het gesprek. Reset enkel bij `handleNewConversation`.
- **Alle** calls naar de webhook gebruiken voortaan dezelfde volledige `ExcelPayload`-vorm — geen aparte "rating-update" payload meer met enkel 2 velden. Power Automate krijgt dan altijd hetzelfde schema en kan netjes upserten.
- `sendRatingUpdate(...)` vervangen door een hersend van de **laatst bekende volledige payload** met enkel `Aantal_Sterren` + `status` bijgewerkt.

### Snapshot bijhouden
Een nieuwe `lastPayloadRef` houdt de meest recente volledige payload bij (advies, criteria, gesprek, status). Zo kunnen alle vervolg-events (rating, stop, off-topic, tab-close) hem hergebruiken zonder opnieuw te moeten inferren.

### Statussen
`status`-veld krijgt een vollediger lijstje, zodat Power Automate weet in welke fase de rij zit:
- `In gesprek` — eerste write, zodra er minstens 1 user-bericht is
- `Voltooid` — advies getoond
- `Niet afgerond` — gebruiker startte nieuw gesprek of sloot tab vóór advies
- `Beëindigd - Off-topic` — 3 strikes
- `Vinyl - doorverwezen` — vinyl-flow eindigde met "nee"

### Stop-momenten afdekken
We sturen op deze momenten een upsert:

| Moment | Trigger | Status |
|---|---|---|
| Eerste user-bericht verstuurd | binnen `handleSend` | `In gesprek` (initiële rij) |
| Advies getoond | `handleCompletedAssistantMessage` / `handleForceAdvice` | `Voltooid` |
| Vinyl → "nee" | binnen `handleSend` vinyl-flow | `Vinyl - doorverwezen` |
| Off-topic 3x | `terminateForOffTopic` | `Beëindigd - Off-topic` |
| Sterren geklikt | `handleRate` | huidige status + `Aantal_Sterren` |
| "Nieuw gesprek starten" | `handleNewConversation` | huidige status (of `Niet afgerond` als er nog geen advies was) |
| Tab sluiten / refresh / mobile background | `beforeunload` + `visibilitychange === "hidden"` | huidige status of `Niet afgerond` |

De unload-flush gebruikt `navigator.sendBeacon(LOG_ENDPOINT, blob)` zodat de browser de request gegarandeerd verstuurt, ook al wordt de pagina meteen daarna gesloten. We zetten een `lastFlushRef` om dubbele writes binnen dezelfde sessie te voorkomen (alleen flushen als er iets veranderd is sinds de laatste verzending).

### Bestanden die wijzigen
- `src/lib/webhookLogger.ts`
  - `AdviesStatus` uitbreiden met `"In gesprek"` en `"Vinyl - doorverwezen"`.
  - `sendRatingUpdate` verwijderen (of intern: stuurt nu volledige payload met nieuwe rating).
  - Helper `sendBeacon(payload)` toevoegen voor de unload-flush.
- `src/components/TegelChat.tsx`
  - `lastPayloadRef` + `lastFlushRef` toevoegen.
  - Initiële "In gesprek"-write bij eerste user-bericht.
  - Alle bestaande `sendToExcel`-calls schrijven hun payload ook weg naar `lastPayloadRef`.
  - `handleRate`: payload uit ref pakken, `Aantal_Sterren` bijwerken, opnieuw versturen.
  - `useEffect` met `beforeunload` + `visibilitychange` voor de beacon-flush.

---

## 2. Power Automate — upsert in plaats van insert

In de flow die nu "Add a row into a table" doet, plaats vóór de insert deze stappen:

```text
1. Trigger: When a HTTP request is received  (ongewijzigd)
2. List rows present in a table
       Filter Query:  ConversationId eq '@{triggerBody()?['ConversationId']}'
3. Condition:  length(outputs('List_rows...')?['body/value']) is greater than 0
       ├── Ja  → Update a row
       │         Key column:   ConversationId
       │         Key value:    @{triggerBody()?['ConversationId']}
       │         (alle velden uit triggerBody mappen)
       └── Nee → Add a row into a table
                 (alle velden uit triggerBody mappen)
```

Voorwaarde in Excel: kolom **ConversationId** bestaat en is uniek per gesprek. Geen verdere wijzigingen aan de andere kolommen nodig — het schema dat de frontend stuurt blijft identiek.

---

## Wat verandert er niet
- Het JSON-schema dat Power Automate ontvangt blijft hetzelfde (zelfde veldnamen). Enkel de **frequentie** van writes verandert en alle writes hebben nu altijd dezelfde volledige vorm.
- Geen wijzigingen aan AI-prompts, matching-logica of UI-layout.
- Geen database-tabel toegevoegd; de Excel via Power Automate blijft de bron.

## Bekende randgevallen
- **Race condition** in Power Automate: als de gebruiker héél snel klikt kan een tweede call binnenkomen vóór de eerste "Add a row" klaar is → dan ontstaan alsnog 2 rijen. Mitigatie aan PA-kant: voeg een `Delay` van 1–2s toe vóór `List rows` bij de eerste write, of zet `concurrency control = 1` op de flow.
- **sendBeacon** kan niet wachten op het antwoord. Dat is bewust: bij tab-sluiten willen we alleen vuur-en-vergeet. De edge function logt zelf eventuele fouten.
