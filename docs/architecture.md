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

## Dati e privacy

- configurazioni personali in `data/private/`, mai versionate;
- credenziali conservate dal sistema operativo o dalla sessione del browser;
- cache prezzi breve e accompagnata da data, negozio e fonte;
- Open Food Facts attribuito e riutilizzato secondo ODbL/CC BY-SA;
- punteggi proprietari solo manuali o tramite integrazioni autorizzate;
- cataloghi dei retailer non redistribuiti come dataset permanente senza diritto.

## Checkout

La versione iniziale si ferma all'anteprima. Compilazione del carrello e acquisto
sono adapter separati; il pagamento richiede sempre un'approvazione esplicita.
