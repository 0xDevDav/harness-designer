<div align="center">

# 🔌 Harness Designer

**Disegna schemi di cablaggio auto come li vuole l'officina**

Formboard con fascio a doppia linea, connettori, tabelle cavità, verifica di coerenza e distinta fili

[![Demo dal vivo](https://img.shields.io/badge/Demo-dal%20vivo-6d5cff.svg)](https://0xdevdav.github.io/harness-designer/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-646cff.svg)](https://vite.dev)
[![Runtime deps](https://img.shields.io/badge/Dipendenze%20a%20runtime-0-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/Test-173%20verdi-brightgreen.svg)](tests)

[**▶ Provalo ora**](https://0xdevdav.github.io/harness-designer/) • [Funzioni](#-funzioni) • [Immagini](#-immagini) • [Avvio rapido](#-avvio-rapido) • [Come si usa](#-come-si-usa) • [Plugin](#-plugin) • [Pubblicazione](#-pubblicazione)

[🇬🇧 English](README.md) · **🇮🇹 Italiano**

</div>

---

È un **sito statico**: nessun backend, nessun account, nessuna registrazione, nessun dato che esce dal
browser. Il disegno vive nel tuo computer e si archivia in un file `.json` che resta tuo.

## ✨ Funzioni

| Funzione                       | Descrizione                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 🎨 **Disegno formboard**       | Fascio a doppia linea, calze di giunzione, simboli di terminale, etichette inline per fusibili, corrugato e nastro         |
| 📋 **Tabelle cavità**          | Pin-out compilati direttamente sul foglio, legati al loro connettore                                                       |
| 🔗 **Collegamento automatico** | Scrivi una destinazione e la cavità corrispondente all'altro capo si compila da sé, colore e sezione compresi              |
| ✅ **Verifica di coerenza**    | Incroci che non tornano, cavità mancanti, riferimenti a senso unico e caratteristiche discordanti, ognuno cliccabile       |
| ⚡ **Regola dei due capi**     | Lo stesso colore in tre o più connettori è segnalato per l'errore di cablaggio che è, con il nero esente perché è la massa |
| 📊 **Distinta fili**           | Generata dalle tabelle, coppie speculari deduplicate, esportabile in CSV                                                   |
| 🌍 **Bilingue**                | Italiano e inglese, si cambia al volo, nomi dei colori compresi                                                            |
| 🧩 **Plugin**                  | Comandi, regole di verifica, esportazioni, simboli connettore e nomi colore, senza ricompilare                             |
| 🎯 **Palette dei comandi**     | `Ctrl+K` per ogni azione con la sua scorciatoia                                                                            |
| 🌗 **Chiaro e scuro**          | Il foglio resta chiaro in entrambi, perché è quello che si stampa                                                          |
| 📱 **Pronto al tocco**         | Pizzico, trascinamento e menù offcanvas su tablet e telefono                                                               |
| 📦 **File unico**              | Un solo file HTML che si apre con doppio clic, senza alcun server                                                          |

## 📸 Immagini

<div align="center">
<img src="docs/images/overview.png" alt="Lo schema di esempio: kit gancio traino 13 poli con le tabelle cavità" width="900">
<p><em>Lo schema di esempio incluso: kit per gancio di traino a 13 poli ISO 11446, con tabelle cavità, note, revisioni e cartiglio</em></p>
</div>

## 🚀 Avvio rapido

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
| `npm test`                 | Vitest, 173 test sul core                    |
| `npm run typecheck`        | `tsc --noEmit`                               |
| `npm run lint`             | ESLint                                       |

## 🎮 Come si usa

**Seleziona e sposta è sempre attivo.** Clic per selezionare, trascina per spostare nodi, tabelle ed
etichette; trascina il vuoto per la vista, rotella per lo zoom. Gli stessi gesti valgono con le dita.

| Azione                         | Come                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| Disegnare un ramo              | Tasto destro sul vuoto → _Inizia un ramo qui_, oppure `B`       |
| Modificare qualsiasi cosa      | Doppio clic sul foglio                                          |
| Aggiungere un'etichetta inline | Tasto destro su un ramo → _Aggiungi etichetta inline qui_       |
| Compilare un pin-out           | Doppio clic su una cella, `Tab` per la successiva               |
| Scegliere il colore di un filo | Doppio clic sulla cella colore: tavolozza IEC 60757 e DIN 47002 |
| Annullare                      | `Ctrl+Z`, e ogni modifica è un solo passo                       |

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

## 🧩 Plugin

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

> ⚠️ I plugin girano con gli stessi permessi della pagina. Quelli esterni vengono caricati solo da `https:`.
> Vedi [SECURITY.md](SECURITY.md).

API completa: **[docs/PLUGINS.md](docs/PLUGINS.md)**

Plugin della comunità e un modello da cui partire: **[harness-designer-plugins](https://github.com/0xDevDav/harness-designer-plugins)**

## 📦 Pubblicazione

Carica il contenuto di `dist/` su qualunque hosting. `base: "./"` fa sì che funzioni sia in root del
dominio sia in una sottocartella, senza configurare nulla.

Con la build a file unico, `dist-standalone/index.html` è l'intero programma: lo passi su una chiavetta e
si apre con un doppio clic.

Passo per passo: **[docs/DEPLOY.md](docs/DEPLOY.md)**

## 🏗️ Struttura del progetto

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

## 📄 Licenza

MIT: vedi **[LICENSE](LICENSE)**.

Per contribuire: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## 🙏 Crediti

Le icone dell'interfaccia vengono da [Bootstrap Icons](https://icons.getbootstrap.com/) (licenza MIT). I
tracciati sono incorporati nel codice: nessun file viene scaricato dalla rete, così il programma funziona
offline e come file unico.
