## Doel
Aan het einde van een gesprek de gebruiker laten beoordelen hoe goed de ervaring met de assistent was, via 5 sterretjes. Compact, ruimtevriendelijk op mobiel, en de score gaat mee in de bestaande Power Automate webhook.

## Plaatsing in de UI
Direct boven de "Nieuw gesprek starten"-knop, in dezelfde zone die toch al verschijnt na het advies of bij conversation-lock. Eén regel:

```text
Hoe was uw ervaring?  ☆ ☆ ☆ ☆ ☆
        [ Nieuw gesprek starten ]
```

- Sterren in primary-rood bij hover/selectie, anders muted (volgt de bestaande designtokens — geen losse kleuren).
- Klik = direct geselecteerd, geen "Verstuur"-knop nodig.
- Na klik: sterren blijven gevuld staan, tekst wordt "Bedankt voor uw beoordeling." Geen modal, geen extra veld.
- Verschijnt alleen wanneer er een eindstatus is (advies gegeven, vinyl-nee, limiet bereikt, of `conversationEnded`).
- Eén klik per gesprek; daarna disabled.

## Webhook payload
Eén extra veld toevoegen aan `ExcelPayload` in `src/lib/webhookLogger.ts`:

- `Rating: number` (0 = niet gegeven, 1–5 = score)

`buildPayload` krijgt een optionele `rating` parameter en zet die in het veld. Verder blijft de JSON-structuur exact gelijk.

## Verzendmoment
De rating wordt pas bekend ná de eerste `sendToExcel`-call (die gebeurt zodra het advies of de eindstatus klaar is). Twee opties, ik kies optie A omdat die het meest betrouwbaar is:

- **A. Tweede call met enkel update-payload** zodra de gebruiker klikt: dezelfde payload opnieuw versturen met `Rating` ingevuld én een nieuw veld `IsRatingUpdate: true`, zodat Power Automate de bestaande rij kan terugvinden (op `Datum` + `Volledig_Gesprek`-hash of een nieuwe `ConversationId`).
- Om matching makkelijk te maken voeg ik één extra veld toe: `ConversationId` (uuid, gegenereerd bij start van het gesprek). Beide calls bevatten dezelfde id.

Als dit te zwaar is voor Power Automate, kan ook simpeler: rating pas verzamelen en pas dán de éérste keer versturen. Maar dat betekent dat gesprekken zonder rating pas bij "Nieuw gesprek starten" gelogd worden — risico op verlies bij sluiten van de tab. Vandaar voorkeur voor optie A.

## Technische wijzigingen
- `src/lib/webhookLogger.ts`: veld `Rating` + `ConversationId` toevoegen aan `ExcelPayload` en `buildPayload`; helper `sendRatingUpdate(conversationId, rating)`.
- `src/components/TegelChat.tsx`:
  - `conversationIdRef` (uuid) aanmaken bij start, resetten in `handleNewConversation`.
  - State `rating` + `ratingSubmitted`.
  - Nieuwe kleine component `RatingStars` (intern of in `src/components/RatingStars.tsx`) — 5 knoppen met `Star` icoon van lucide-react, hover-state, `aria-label`.
  - Render boven de "Nieuw gesprek starten"-knop wanneer die zichtbaar is.
  - Bij klik: `sendRatingUpdate(...)` + state lock.

## Wat verandert er niet
- Geen wijzigingen aan de chat-flow, AI-prompts, matching-logica of de adviescard.
- Geen extra database-tabel.
- Geen modal of extra schermovergang.
