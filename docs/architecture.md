# Architettura e regole decisionali

## Obiettivo

Ridurre il costo economico totale senza perdere controllo su qualità, budget su
carta e regole dei buoni pasto. Il modello non assegna un vantaggio aprioristico
a GDO, negozio locale o discount.

## Ordine delle decisioni

1. **Vincoli rigidi:** copertura del bisogno, soglie salute, prodotti eleggibili,
   numero e taglio dei ticket, minimo d'ordine, budget su carta.
2. **Costo economico:** prodotti più consegna e commissioni. I ticket sono una
   fonte di pagamento e non cancellano il costo del prodotto.
3. **Quota carta:** deve restare nel plafond mobile di quattro settimane.
4. **Spareggio:** qualità oltre soglia e comodità.

I pesi 75/15/10 descrivono soltanto lo spareggio fra alternative già molto
vicine. Non possono rendere vincente un carrello più caro che viola la soglia di
risparmio.

## Discount gate

Un nuovo canale entra nel piano soltanto quando:

- il preventivo ha meno di 24 ore;
- almeno il 70% dei bisogni confrontati è realmente equivalente;
- prezzi online e commissioni sono noti;
- il risparmio è almeno €5 e almeno il 5%;
- il piano completo resta entro €40 di carta;
- nessun prodotto ricorrente scende sotto 71 e nessun flessibile sotto 50.

Se il retailer dichiara che i prezzi online possono differire dal negozio, il
campo `priceBasis` rimane `unknown` fino alla cattura del carrello live.

## Ruolo dell'AI

L'AI trasforma frasi e liste grezze in bisogni strutturati, propone equivalenze e
spiega la decisione. Il motore deterministico esegue conti e controlli. Una
proposta AI non verificata non può aggiornare prezzo, punteggio o checkout.

## Confini degli adapter

L'agente non riceve un endpoint generico del retailer. Ogni adapter espone un
insieme ristretto di capacità:

```text
search → quote → valutazione cost-first → proposta → approvazione → draft cart
```

- `searchProducts`: sola lettura;
- `createQuote`: produce prezzi, fonte, scadenza, commissioni e prodotti;
- `getOrderHistory`: sola lettura e opzionale;
- `createDraftCart`: richiede una proposta accettata e una ricevuta valida;
- checkout e pagamento non fanno parte del contratto.

La decisione economica è legata all'ID e al totale del preventivo. La ricevuta
lega poi l'approvazione al digest esatto di prodotti, quantità e totale.
Non è un sistema di autenticazione: l'applicazione host deve autenticare chi
approva e proteggere la sessione.

## Memoria

Preferenze e bisogni usano un contratto separato dal provider di storage. Gli
aggiornamenti includono una versione attesa, così due conversazioni simultanee
non possono sovrascriversi silenziosamente. File locale, database e documenti
cloud possono implementare lo stesso contratto.

## Ottimizzatore v1

L'input dell'ottimizzatore è un catalogo già normalizzato e confrontabile, non
una pagina web o una risposta libera del modello. Per ogni settimana il motore:

1. distribuisce le quantità secondo la frequenza dichiarata;
2. rimuove le categorie escluse dal profilo;
3. ammette solo offerte con stessa unità, disponibilità, prezzo massimo e soglia
   salute verificati;
4. confronta combinazioni di negozi includendo consegna, commissioni e minimi;
5. assegna i tagli di buono disponibili senza superare gli alimenti eleggibili;
6. sceglie prima il minor costo economico e poi la minore quota carta.

I cataloghi `fixture` generano sempre una simulazione. Per i cataloghi `live` il
motore blocca dati futuri, scaduti o più vecchi della politica configurata. La
versione iniziale limita il numero di negozi e candidati per mantenere il calcolo
locale e prevedibile; non effettua scraping né pretende di trovare l'ottimo su
cataloghi arbitrariamente grandi.

## Contratti v1

Gli schemi in `schemas/v1/` sono il confine pubblico fra onboarding, agente,
provider e motore. Un cambio incompatibile richiede una nuova versione dello
schema; aggiungere campi silenziosamente a un documento v1 non è consentito.

## Dati e privacy

- configurazioni personali in `data/private/`, mai versionate;
- credenziali conservate dal sistema operativo o dalla sessione del browser;
- cache prezzi breve e accompagnata da data, negozio e fonte;
- Open Food Facts attribuito e riutilizzato secondo ODbL/CC BY-SA;
- punteggi proprietari solo manuali o tramite integrazioni autorizzate;
- cataloghi dei retailer non redistribuiti come dataset permanente senza diritto.

## Checkout

La versione iniziale si ferma all'anteprima o, per adapter autorizzati, a una
bozza reversibile. L'acquisto e il pagamento non fanno parte del contratto e
richiedono sempre un'azione esplicita dell'utente nel canale del retailer.
