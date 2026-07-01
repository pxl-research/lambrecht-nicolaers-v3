## Wat er aan de hand is

De foutmelding "Er is helaas iets misgegaan. Probeer het nog eens." komt uit `src/lib/puterAI.ts` — dat is de catch-tak die **alleen** afgaat als de `fetch()` zelf gooit met een netwerkfout ("Failed to fetch"), dus nog vóór de server antwoordt.

Ik heb de edge function `mistral-chat` net rechtstreeks getest vanuit de sandbox:

- `OPTIONS` preflight → 200 met correcte CORS headers.
- `POST` met `{"messages":[]}` → 200, stream werkt, Mistral antwoordt netjes met de begroeting.

Dus **de edge function, CORS en Mistral werken**. Het probleem zit in de browser: `fetch()` faalt daar meteen bij het openen van het gesprek, terwijl dezelfde call uit de sandbox lukt. Dat wijst op iets tussen jouw browser en Supabase (bv. adblocker / privacy-extensie / netwerkfilter / bedrijfs-VPN die `*.supabase.co` blokkeert, of een stale preview-iframe).

## Wat ik wil doen

**Stap 1 — betere diagnostiek in de UI (kleine code-wijziging)**

In `src/lib/puterAI.ts` het `catch`-blok uitbreiden:
- De concrete error-naam en `message` (bv. `TypeError: Failed to fetch`) tonen aan de gebruiker in plaats van de generieke zin.
- Een korte hint toevoegen: "controleer je verbinding of een eventuele adblocker/VPN".
- De volledige error naar `console.error` blijft staan.

Dit is puur een tekstwijziging in de bestaande error-tak — geen wijziging aan business-logica of aan de edge function.

**Stap 2 — eerst zonder code wijzigen: 2 snelle tests aan jouw kant**

Voordat ik iets deploy, wil ik graag dat je even twee dingen probeert, want dat lost dit mogelijk direct op zonder wijziging:

1. Open de preview in een **nieuw browser-tabblad** (dus niet in de Lovable editor-preview), URL:
   `https://id-preview--275e6cf1-7bd3-4f33-9bfa-96531352ef57.lovable.app`
   en klik daar op Start. Werkt dat?
2. Zo niet: probeer een **incognito-venster** (adblockers/extensies uit) en/of een **ander netwerk** (bv. mobiele hotspot). Werkt dat?

Op basis daarvan weten we of het aan de preview-iframe, aan een browser-extensie of aan je netwerk ligt.

## Technische details

- Getest: `curl -X POST https://msoaqydgnawrkyghoiok.supabase.co/functions/v1/mistral-chat …` → HTTP/2 200, `content-type: text/event-stream`, volledige SSE-stream met tokens en `[DONE]`.
- Edge-function logs voor `mistral-chat`: leeg → jouw browserrequest bereikt de function niet eens, wat bevestigt dat `fetch` client-side faalt vóór de server.
- De request in het network-panel toont `Error: Failed to fetch` met body `{"messages":[]}` — dat is de correcte payload; niets mis met de request zelf.
- Bestandswijziging beperkt tot `src/lib/puterAI.ts`, alleen in het `catch (error)`-blok onderaan `streamPuterChat`.

Laat me weten wat de twee tests opleveren, dan pas ik de error-tekst aan en (indien nodig) zoeken we verder.