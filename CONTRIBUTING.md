# Contribuire

Le contribuzioni più utili sono adapter di sola lettura, casi di test anonimi e
miglioramenti alla spiegabilità delle decisioni.

Ogni adapter deve dichiarare:

- fonte e data dei prezzi;
- copertura geografica;
- eventuale differenza fra prezzo online e punto vendita;
- minimo d'ordine, consegna e commissioni;
- metodi di pagamento e limite dei ticket;
- condizioni d'uso applicabili;
- comportamento in caso di prodotto o prezzo sconosciuto.

Non inserire credenziali, indirizzi completi, token, cookie o cronologie personali.
Un adapter non deve completare un pagamento nei test o nelle pull request.

Prima di proporre modifiche:

```bash
npm test
npm run plan
npm run channels
```
