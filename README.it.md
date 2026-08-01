# Harness Designer

Editor di schemi di cablaggio auto: formboard con fascio a doppia linea, connettori, tabelle cavità,
verifica di coerenza e distinta fili.

[![CI](https://github.com/0xDevDav/harness-designer/actions/workflows/ci.yml/badge.svg)](https://github.com/0xDevDav/harness-designer/actions/workflows/ci.yml)
[![Licenza: MIT](https://img.shields.io/badge/Licenza-MIT-blue.svg)](LICENSE)

**[Demo dal vivo](https://0xdevdav.github.io/harness-designer/)** — [English](README.md)

È un sito statico: nessun backend, nessun account, nessuna registrazione, nessun dato che esce dal browser.
Il disegno vive nel tuo computer e si archivia in un file `.json` che resta tuo.

![Il foglio e lo schema affiancati, con un cablaggio motore a quattro cilindri](docs/images/overview.png)

_Lo schema di esempio incluso, nelle due viste: il foglio a sinistra, lo schema a destra. È il cablaggio
motore di un 1.4 benzina a quattro cilindri — batteria e fusibile principale, scatola fusibili,
alternatore, centralina su due connettori, quattro iniettori e quattro bobine, i sensori, due coppie
accoppiate e il passaparete fino al quadro. Ventiquattro pin-out, oltre settanta fili, e nessun problema
nella verifica. Un filo scelto in una vista si accende anche nell'altra: qui l'alimentazione dell'abitacolo,
dalla scatola fusibili al passaparete, con tutti i rami che percorre accesi lungo il fascio._

## Che cosa fa

| Funzione                    | Descrizione                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disegno formboard**       | Fascio a doppia linea, calze di giunzione, simboli di terminale, etichette inline per fusibili, corrugato e nastro                                                                           |
| **Squadrato o libero**      | Rami tenuti in orizzontale e verticale con l'angolo che si forma da sé, oppure liberi, con punti di piega dove serve                                                                         |
| **I fili dentro il fascio** | Selezioni un ramo o un connettore e i fili che ci passano vengono disegnati dalle tabelle cavità, ognuno sulla sua corsia e col suo colore                                                   |
| **Colori dei fili**         | I fili multicolore sono resi come sono davvero: il primo colore è il fondo, gli altri sono bande che lo attraversano, inclinate come se ci fossero avvolte                                   |
| **Vista schema**            | Lo stesso cablaggio letto come circuiti: un riquadro per connettore, un filo per collegamento. Da sola, o accanto al foglio, dove quello che scegli in una vista si accende anche nell'altra |
| **Tabelle cavità**          | Pin-out compilati direttamente sul foglio, legati al loro connettore                                                                                                                         |
| **Collegamento automatico** | Scrivi una destinazione e la cavità corrispondente all'altro capo si compila da sé, colore e sezione compresi                                                                                |
| **Giunti**                  | Due connettori accoppiati: lì il filo finisce e ne comincia un altro, quindi il colore può cambiare e la verifica lo sa                                                                      |
| **Verifica di coerenza**    | Incroci che non tornano, cavità mancanti, riferimenti a senso unico e caratteristiche discordanti, ognuno cliccabile                                                                         |
| **Regola dei due capi**     | Lo stesso colore in tre o più connettori è segnalato per l'errore di cablaggio che è, con il nero esente perché è la massa                                                                   |
| **Distinta fili**           | Generata dalle tabelle, coppie speculari deduplicate, metraggi sommati, esportabile in CSV                                                                                                   |
| **Bilingue**                | Italiano e inglese, si cambia al volo, nomi dei colori compresi                                                                                                                              |
| **Plugin**                  | Comandi, regole di verifica, esportazioni, simboli connettore e nomi colore, senza ricompilare                                                                                               |
| **Palette dei comandi**     | `Ctrl+K` per ogni azione con la sua scorciatoia                                                                                                                                              |
| **Chiaro e scuro**          | Il foglio resta chiaro in entrambi, perché è quello che si stampa                                                                                                                            |
| **Pronto al tocco**         | Pizzico, trascinamento e menù offcanvas su tablet e telefono                                                                                                                                 |
| **File unico**              | Un solo file HTML che si apre con doppio clic, senza alcun server                                                                                                                            |

## Avvio rapido

Serve Node 20 o superiore, e solo per compilare: quello che esce è statico.

```bash
git clone https://github.com/0xDevDav/harness-designer.git
cd harness-designer
npm install
npm run dev        # http://localhost:5173
```

| Comando                    | Cosa fa                                      |
| -------------------------- | -------------------------------------------- |
| `npm run dev`              | Server di sviluppo con ricarica immediata    |
| `npm run build`            | Controllo dei tipi e sito statico in `dist/` |
| `npm run build:standalone` | Un solo file `dist-standalone/index.html`    |
| `npm test`                 | Vitest sul core                              |
| `npm run typecheck`        | `tsc --noEmit`                               |
| `npm run lint`             | ESLint                                       |

Non ci sono dipendenze a runtime: il programma esce come file semplici e si installa via FTP.

## Come si usa

**Seleziona e sposta è sempre attivo.** Clic per selezionare, trascina per spostare nodi, tabelle ed
etichette; trascina il vuoto per la vista, rotella per lo zoom. Gli stessi gesti valgono con le dita.

| Azione                         | Come                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| Disegnare un ramo              | Tasto destro sul vuoto → _Inizia un ramo qui_, oppure `B`         |
| Modificare qualsiasi cosa      | Doppio clic sul foglio                                            |
| Aggiungere un'etichetta inline | Tasto destro su un ramo → _Aggiungi etichetta inline qui_         |
| Compilare un pin-out           | Doppio clic su una cella, `Tab` per la successiva                 |
| Scegliere il colore di un filo | Doppio clic sulla cella colore: tavolozza IEC 60757 e DIN 47002   |
| Copiare e incollare            | `Ctrl+C`, poi `Ctrl+V` ne mette una uguale dov'è il puntatore     |
| Sceglierne più di uno          | `Ctrl+clic`, poi tasto destro per ciò che vale su tutto il gruppo |
| Annullare                      | `Ctrl+Z`, e ogni modifica è un solo passo                         |

**Non c'è una barra laterale**: le proprietà si modificano dove sono disegnate, il resto sta nel menù del
tasto destro.

### La destinazione di un filo

Si scrive in due modi, entrambi capiti:

```
Verso = "C3.3"                una sola colonna
Verso = "C3"  +  PIN = "3"    divisa in due
```

Compili un capo e l'altro si compila da sé. Se la cavità di arrivo punta già altrove il conflitto viene
segnalato e non si sovrascrive nulla: perdere un collegamento in silenzio è peggio che non crearlo.

## Plugin

Un plugin è un modulo ES che esporta un oggetto con `activate(api)`. Niente da compilare: lo scrivi, lo
installi, funziona.

```js
export default {
  id: "acme.esempio",
  name: "Esempio",
  version: "1.0.0",
  activate(api) {
    api.i18n.add("it", { "plugin.acme.esempio.ciao": "Saluta" });
    api.commands.register({
      id: "acme.esempio.ciao",
      titleKey: "plugin.acme.esempio.ciao",
      run: () => api.ui.toast("Ciao!"),
    });
  },
};
```

Ne trovi due di esempio in `public/plugins/`: il metraggio dei rami raggruppato per copertura e un simbolo
di connettore tondo DIN con le relative sigle colore.

> **Nota.** I plugin girano con gli stessi permessi della pagina. Quelli esterni vengono caricati solo da
> `https:`. Vedi [SECURITY.md](SECURITY.md).

API completa: **[docs/PLUGINS.md](docs/PLUGINS.md)**

Plugin della comunità e un modello da cui partire: **[harness-designer-plugins](https://github.com/0xDevDav/harness-designer-plugins)**

## Pubblicazione

Carica il contenuto di `dist/` su qualunque hosting. `base: "./"` fa sì che funzioni sia in root del
dominio sia in una sottocartella, senza configurare nulla.

Con la build a file unico, `dist-standalone/index.html` è l'intero programma: lo passi su una chiavetta e
si apre con un doppio clic.

Passo per passo: **[docs/DEPLOY.md](docs/DEPLOY.md)**

## Struttura del progetto

```
harness-designer/
├── src/
│   ├── main.ts           # avvio: servizi, contesto, ascoltatori
│   ├── app/context.ts    # i contratti dei servizi, da leggere per primo
│   ├── core/             # logica pura, senza DOM: è ciò che i test coprono
│   ├── render/           # disegno SVG
│   ├── ui/               # interfaccia: barra, menù, pannelli, modifica sul posto
│   ├── io/               # archiviazione, file, esportazioni
│   ├── plugins/          # API pubblica e host
│   └── i18n/             # dizionari
├── public/plugins/       # plugin di esempio, caricati a runtime
├── tests/                # Vitest sul core
└── docs/                 # architettura, pubblicazione, API dei plugin
```

Scelte di progetto e motivazioni: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

## Licenza

MIT: vedi **[LICENSE](LICENSE)**.

Per contribuire: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Crediti

Le icone dell'interfaccia vengono da [Bootstrap Icons](https://icons.getbootstrap.com/) (licenza MIT). I
tracciati sono incorporati nel codice: nessun file viene scaricato dalla rete, così il programma funziona
offline e come file unico.
