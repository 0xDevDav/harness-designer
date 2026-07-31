# Architettura

Guida per chi mette le mani nel codice. Il [README](../README.md) racconta cosa fa il programma; qui si spiega **com'è fatto e perché**.

Regole valide ovunque: TypeScript **strict** (con `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`), **zero dipendenze** a runtime, alias di importazione `@/…` = `src/…`, ogni testo mostrato all'utente passa da `t("chiave")`.

---

## 1. Sguardo d'insieme

Cinque livelli, con le dipendenze sempre rivolte verso il basso:

```
  ui/  ─────────────┐          plugins/  (estensioni dell'utente)
  (barra, pannelli, │              │
   menù, tastiera)  │              ▼
        │           └────────►  app/context.ts   ← i contratti fra i servizi
        ▼                          ▲
  render/  (SVG dal documento)     │
        │                          │
        ▼                          │
  core/  (documento, store, regole, geometria) ──── i18n/
        ▲
        │
  io/   (localStorage, file, esportazioni)
```

- **`core/`** non conosce il DOM. Sono dati e funzioni pure (più lo `Store`): si può provare con i test senza browser.
- **`render/`** legge il documento e produce SVG. Non modifica mai nulla.
- **`ui/`** raccoglie gli eventi dell'utente e li traduce in chiamate allo `Store`.
- **`io/`** parla con il mondo esterno: `localStorage`, file, appunti del sistema, stampa.
- **`app/context.ts`** definisce le **interfacce** dei servizi (dialoghi, messaggi, comandi, plugin, disegno) senza implementarne nessuno: è il punto in cui i moduli si incontrano senza importarsi a vicenda.

---

## 2. Mappa dei moduli

### `src/core/` — modello e logica, senza DOM

| File           | Contenuto                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`     | Il modello dati: `HarnessDoc`, `HNode`, `Segment`, `Inline`, `Table`, `DocMeta`, `Selection`, `Issue`, `WireRow` e `DOC_VERSION`                                                                                                           |
| `ids.ts`       | `uid(prefisso)` genera identificativi univoci; `seedIds(n)` riparte oltre il massimo trovato in un documento aperto                                                                                                                        |
| `geometry.ts`  | Passo della griglia, `clamp`/`snapTo`, distanze, punto lungo un segmento, proiezione parametrica, angoli sempre leggibili, unione di riquadri                                                                                              |
| `colors.ts`    | Dai nomi colore italiani e inglesi (e dai `#hex`) ai campioni a fasce dei fili bicolore; i plugin registrano nomi nuovi                                                                                                                    |
| `doc.ts`       | Costruzione, **normalizzazione** e interrogazione del documento: creazione di nodi e rami, divisione di un ramo, rinomina propagata alle tabelle, riconoscimento delle colonne e delle tabelle cavità, eliminazione con le sue conseguenze |
| `store.ts`     | Lo `Store`: unico punto di modifica, cronologia annulla/ripristina, selezione, vista, strumento attivo, eventi                                                                                                                             |
| `validate.ts`  | Le regole della verifica di coerenza, in un registro estendibile dai plugin                                                                                                                                                                |
| `wirelist.ts`  | Distinta fili ricavata dalle tabelle cavità (le coppie speculari contano una volta sola), esportazione e lettura CSV                                                                                                                       |
| `factories.ts` | Tabelle predefinite già intestate nella lingua attiva: cavità, note, revisioni, cartiglio                                                                                                                                                  |
| `sample.ts`    | Il documento di esempio caricato al primo avvio                                                                                                                                                                                            |

### `src/render/` — dal documento all'SVG

| File            | Contenuto                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `svg.ts`        | Aiutanti minimi: creazione di elementi nel namespace SVG, testo, misura e troncamento delle stringhe                                                   |
| `connectors.ts` | Registro dei simboli di terminale (`plug`, `ring`, `faston`, `pin`, `splice`, `none`), aperto ai plugin                                                |
| `tables.ts`     | Disegno delle tabelle e del cartiglio, con il calcolo delle larghezze di colonna                                                                       |
| `boot.ts`       | Il simbolo della giunzione (il «boot» del fascio)                                                                                                      |
| `renderer.ts`   | Il `Renderer`: svuota `#world` e ridisegna tutto, gestisce vista, riquadri, ricerca del nodo vicino e produce l'SVG autonomo per esportazione e stampa |

### `src/ui/` — interfaccia

| File              | Contenuto                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interaction.ts`  | Puntatore sul foglio: selezione, trascinamenti, panoramica, zoom, disegno del ramo. Usa i **Pointer Events**, quindi vale anche per dita e pennino |
| `menu.ts`         | Il menù a comparsa generico (voci, separatori, intestazioni) con navigazione da tastiera                                                           |
| `contextmenu.ts`  | Quali voci mostrare per il bersaglio del clic destro, comprese quelle dei plugin                                                                   |
| `commands.ts`     | Registro dei comandi e comandi di serie: sono l'unica definizione di ogni azione, e da lì li pescano barra, palette e tastiera                     |
| `keyboard.ts`     | Scorciatoie globali: confronta l'evento con le scorciatoie dichiarate dai comandi                                                                  |
| `palette.ts`      | La palette `Ctrl+K`: ricerca fra i comandi disponibili                                                                                             |
| `topbar.ts`       | Barra superiore: pulsanti, menù _Inserisci_ ed _Esporta_, lingua, plugin, stato annulla/ripristina                                                 |
| `props.ts`        | Pannello proprietà: ricostruito da zero a ogni cambio di selezione                                                                                 |
| `report.ts`       | Rapporto della verifica nel pannello flottante; ogni voce porta al colpevole                                                                       |
| `dialogs.ts`      | Conferme, richieste di testo e avvisi dell'applicazione (mai `alert`/`confirm`/`prompt` nativi)                                                    |
| `toast.ts`        | Messaggi temporanei in basso                                                                                                                       |
| `pluginsPanel.ts` | Elenco dei plugin installati con installazione, attivazione e rimozione                                                                            |

### `src/io/` — mondo esterno

| File           | Contenuto                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `storage.ts`   | Accesso a `localStorage` protetto da `try/catch`: distingue «non disponibile» da «spazio esaurito» |
| `file.ts`      | Scaricamento e lettura dei file `.json`, nome del file ricavato dal cartiglio                      |
| `tabs.ts`      | Ascolta l'evento `storage` per accorgersi che lo stesso schema è aperto in un'altra scheda         |
| `exporters.ts` | Esportazioni di serie: SVG, PNG (dall'SVG, scala 2×), distinta fili CSV, stampa                    |

### `src/plugins/` — estensioni

| File      | Contenuto                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `api.ts`  | Il contratto pubblico verso chi scrive un plugin (`HarnessPlugin`, `PluginAPI`)                                       |
| `host.ts` | Caricamento, attivazione e disattivazione: ogni contributo è **revocabile** e ogni chiamata è protetta da `try/catch` |

### `src/i18n/` — lingue

| File       | Contenuto                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | `t()` con interpolazione `{nome}`, lingua attiva memorizzata, notifica del cambio lingua, dizionari aggiunti dai plugin |
| `it.ts`    | Dizionario italiano: è il riferimento, tutte le chiavi nascono qui                                                      |
| `en.ts`    | Dizionario inglese                                                                                                      |

### Il resto

| File                 | Contenuto                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`        | Avvio: costruisce store, renderer e servizi, li assembla nell'`AppContext`, collega gli eventi e carica documento e plugin                                           |
| `src/app/context.ts` | Le interfacce dei servizi. **Da leggere per primo** prima di aggiungere una funzionalità                                                                             |
| `src/app/version.ts` | La versione dell'applicazione                                                                                                                                        |
| `src/styles/app.css` | Unico foglio di stile; nella sua intestazione c'è l'inventario delle classi, che vale come contratto per i moduli dell'interfaccia                                   |
| `index.html`         | Lo scheletro del DOM: `#topbar`, `#svg` con `#world`, `#overlay` (editor sul posto), `#panels`, `#hint`, `#zoomLabel`, `#toasts` e i due `input[type=file]` nascosti |
| `public/`            | File copiati tali e quali nella build: manifest, service worker, plugin distribuiti con l'app                                                                        |

---

## 3. Il flusso di una modifica

Ogni modifica al documento percorre sempre la stessa strada:

```
azione dell'utente
      │  (clic, tasto, campo del pannello)
      ▼
store.edit(doc => { … })            ← unica porta d'ingresso alle modifiche
      │  1. fotografa il documento (JSON)
      │  2. applica la mutazione
      │  3. normalizeConnectors(doc) ripristina le invarianti
      │  4. se nulla è cambiato, si ferma qui e restituisce false
      │  5. impila lo stato precedente per l'annullamento
      │  6. persister → salvataggio automatico in localStorage
      ▼
emit("doc")
      │
      ├──► renderer.requestRedraw()  → un solo ridisegno al prossimo frame
      └──► topbar / props            → pulsanti e campi si riallineano
```

Punti che vale la pena conoscere:

- **`edit()` è atomico**: un `edit` = un passo di annullamento. Se la funzione non cambia nulla, non viene registrato niente e l'annulla non compie mai passi a vuoto.
- **Modifiche continue** (trascinamento di un nodo, digitazione in un campo): `beginLive()` → tanti `live(…)` quanti servono → `endLive()`. Durante il trascinamento si ridisegna ma non si tocca la cronologia; alla fine resta **un solo** passo annullabile. `cancelLive()` riporta tutto com'era (per esempio quando si preme `Esc`).
- **Il ridisegno è differito**: `requestRedraw()` accorpa più richieste in un unico ridisegno al prossimo `requestAnimationFrame`. Anche cento eventi di puntatore al secondo producono un ridisegno per frame. `redrawNow()` esiste solo per quando serve leggere subito il risultato (misure, esportazione).
- **La selezione passa dallo store** (`store.select`), che emette sia `selection` sia `doc` (il disegno si ridisegna con l'evidenziazione).
- **Annulla e ripristina** scambiano istantanee complete; dopo lo scambio la selezione che punta a un elemento sparito viene azzerata.
- **Sostituire il documento** (apertura di un file, «Nuovo», «Esempio») si fa con `store.load(input)`: passa da `normalizeDoc` e per impostazione predefinita azzera la cronologia.

---

## 4. Modello dati e invarianti

Tutto lo stato del disegno sta in un unico oggetto serializzabile, `HarnessDoc`. È **contemporaneamente** tre cose: il formato dei file `.json`, il contenuto del salvataggio automatico e l'unità di annullamento. Da qui la regola: **deve restare serializzabile con `JSON.stringify`** — niente `Map`, `Set`, funzioni, riferimenti circolari o classi.

```ts
doc = {
  version,                    // documents without the field are still accepted
  meta,                       // cartiglio: titolo, descrizione, part number, revisione, azienda, autore, data
  nodes:    [{ id, x, y, kind: "junction"|"connector", name, style, refs }],
  segments: [{ id, a, b, len, refs }],     // a, b: id di nodi
  inlines:  [{ id, seg, t, text, color }], // t: posizione lungo il segmento
  tables:   [{ id, x, y, kind: "table"|"title", title?, head?, rows, node? }],
}
```

Invarianti garantite da `normalizeDoc()` all'apertura e da `normalizeConnectors()` dopo ogni modifica:

1. **Identificativi univoci** in ogni collezione; i duplicati vengono scartati.
2. **Nessun riferimento pendente**: un segmento esiste solo se esistono entrambi i suoi nodi, un'etichetta inline solo se esiste il suo segmento, il legame `table.node` solo se il nodo esiste.
3. **Niente cappi né rami doppi**: un segmento non può unire un nodo a se stesso, e due nodi non possono essere collegati da due segmenti.
4. **I connettori vivono solo alle estremità**: `kind: "connector"` è ammesso solo su un nodo con al più un ramo. Se un ramo viene disegnato attraverso un terminale, questo torna giunzione. (È il motivo per cui uno splice a metà fascio si realizza con un rametto dedicato.)
5. **Righe rettangolari**: tutte le righe di una tabella hanno lo stesso numero di celle dell'intestazione.
6. **Un solo cartiglio**: `kind: "title"` compare al massimo una volta.
7. **`t` di un'etichetta inline** resta in `[0.05, 0.95]`, così non finisce mai sopra un nodo.

Grazie a queste garanzie il resto del programma **non si difende**: il renderer non controlla se un segmento ha i suoi nodi, perché non può non averli. La barriera è una sola, all'ingresso.

Convenzioni sui dati, non imposte dal tipo ma usate dalle funzioni: la colonna **Verso** contiene valori `NOME.cavità` (es. `C13.4`), che alimentano verifica e distinta fili; i campi `refs` contengono riferimenti alle note in forma `[1, 5]`; `len` e le celle delle tabelle sono **testo libero** (l'utente scrive `12 ft` o `30 cm` come preferisce).

### Retrocompatibilità

`normalizeDoc()` accetta qualunque oggetto, compresi i `.json` prodotti dalla versione a file unico. Da qui una regola per chi aggiunge campi: **si aggiunge, non si rinomina né si toglie**. Ogni campo nuovo deve avere un valore predefinito sensato quando manca, così un file vecchio continua ad aprirsi e un file nuovo non rompe una copia vecchia del programma.

---

## 5. Perché queste scelte

### Ridisegno completo, senza diffing

A ogni cambiamento `#world` viene svuotato e ridisegnato per intero da `doc`. È volutamente «ingenuo», e ha un vantaggio che vale più della raffinatezza: **non esiste uno stato intermedio da mantenere allineato**. Non ci sono bug del tipo «ho cambiato il documento ma lo schermo mostra ancora l'elemento vecchio», perché lo schermo è una funzione pura del documento.

Il costo è accettabile: uno schema di cablaggio ha centinaia di elementi, non centinaia di migliaia, e `requestRedraw()` garantisce comunque **un solo** ridisegno per frame. Se un giorno servisse più velocità, il punto da ottimizzare è uno solo — `Renderer.redrawNow()` — e nient'altro nel programma cambia.

### Annullamento a istantanee

La cronologia è fatta di stringhe JSON dell'intero documento, non di comandi invertibili. Un sistema a comandi sarebbe più leggero in memoria, ma richiederebbe di scrivere (e mantenere corretta) l'operazione inversa di ogni azione: la sorgente di bug più insidiosa in un editor. Con le istantanee, **una funzione che modifica il documento non deve sapere nulla dell'annullamento**: basta che passi da `store.edit`.

Il prezzo è la memoria, ed è tenuto sotto controllo con due limiti: al massimo 120 passi e 24 MB complessivi; oltre, gli stati più vecchi vengono scartati. L'uguaglianza fra istantanee serve anche da rilevatore di modifiche gratuito (`edit()` restituisce `false` se non è cambiato nulla).

### Hit-testing con `data-ent` / `data-id`

Ogni elemento SVG cliccabile porta due attributi: `data-ent` (`node`, `segment`, `inline`, `table`) e `data-id`. Chi gestisce il puntatore risale il DOM con `ev.target.closest("[data-ent]")` e sa immediatamente cosa è stato colpito.

Il vantaggio è che **il browser fa il lavoro geometrico**: niente calcoli di distanza da linee e rettangoli, niente indici spaziali da tenere aggiornati, e la zona sensibile coincide esattamente con ciò che si vede — comprese le aree di aggancio invisibili e più larghe che disegniamo apposta sotto i rami sottili, per rendere il tocco con le dita affidabile.

### Un solo punto di modifica

Tutto passa dallo `Store`. Cronologia, salvataggio automatico, ripristino delle invarianti e ridisegno sono conseguenze automatiche di `edit()`, non cose da ricordarsi. Un modulo che modificasse `doc` direttamente non romperebbe subito nulla di visibile — e sarebbe proprio questo il problema: niente annullamento, niente salvataggio, schermo fermo.

### I comandi come unica definizione delle azioni

Barra superiore, palette, scorciatoie da tastiera e plugin non definiscono azioni proprie: registrano o invocano **comandi**. Un comando dichiara titolo (chiave i18n), scorciatoia, condizione di abilitazione e cosa fa. Aggiungerne uno lo rende automaticamente ricercabile con `Ctrl+K` e assegnabile a una scorciatoia, senza toccare altri file.

Le scorciatoie vanno confrontate **con i modificatori**: guardando solo `key === "f"`, `Ctrl+F` farebbe scattare «adatta vista» e ruberebbe la ricerca del browser.

### Testi solo attraverso `t()`

Nessuna stringa rivolta all'utente compare nel codice: c'è sempre una chiave. Il cambio di lingua funziona a caldo, un test confronta i dizionari e segnala le chiavi mancanti, e un plugin può aggiungere una lingua senza toccare il programma. Le chiavi nuove nascono in `it.ts`, che fa da riferimento.

### Contributi dei plugin revocabili

Ogni funzione di registrazione (comandi, regole, esportatori, simboli, voci di menù, sezioni del pannello plugin) restituisce la funzione che **disfa** la registrazione. L'host le raccoglie e, quando un plugin viene disattivato, le chiama tutte: l'estensione sparisce senza ricaricare la pagina. I plugin girano nello stesso contesto della pagina — è una scelta esplicita, dichiarata all'utente — perciò l'host isola gli **errori** (`try/catch` attorno a caricamento, attivazione e a ogni chiamata di contributo) ma non i permessi.

### Zero dipendenze, base relativa

Nessuna libreria a runtime significa nessun aggiornamento di sicurezza da inseguire, nessuna dimensione che cresce da sola e un programma che nel 2035 si aprirà ancora. `base: "./"` nella build rende la cartella `dist/` collocabile ovunque, anche in una sottocartella, ed è ciò che permette anche la variante a file unico apribile con un doppio clic.

---

## 6. Dove intervenire

| Voglio aggiungere…                           | Tocco…                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Una nuova azione (con scorciatoia e ricerca) | Un comando in `ui/commands.ts` + la chiave `cmd.*` in `i18n/it.ts` e `en.ts`                                 |
| Una voce del menù contestuale                | `ui/contextmenu.ts` (o, da plugin, `menu.contribute`)                                                        |
| Un controllo nella verifica                  | Una `ValidationRule` in `core/validate.ts` (o, da plugin, `validation.addRule`)                              |
| Un formato di esportazione                   | Un `Exporter` in `io/exporters.ts` (o, da plugin, `exporters.register`)                                      |
| Un simbolo di terminale                      | `render/connectors.ts` (o, da plugin, `symbols.registerConnector`)                                           |
| Una modifica sul foglio                      | `ui/sheet-edit.ts` (quale editor aprire) + `ui/inline-edit.ts` (il campo)                                    |
| Un campo nel modello dati                    | `core/types.ts` + il valore predefinito in `core/doc.ts` (`normalizeDoc`), poi disegno e modifica sul foglio |
| Una lingua                                   | Un dizionario nuovo in `src/i18n/` (o, da plugin, `i18n.add`)                                                |
| Uno stile                                    | Solo `src/styles/app.css`, riusando le classi già inventariate nella sua intestazione                        |
