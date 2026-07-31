# Plugin — guida / Plugin guide

> Italiano prima, English below. Il contratto di riferimento è `src/plugins/api.ts`.
> Italian first, English below. The reference contract is `src/plugins/api.ts`.

---

# Italiano

## Cos'è un plugin

Un plugin è un **modulo ES** (un file `.js`) che l'applicazione carica con un `import()` dinamico e che
aggiunge funzionalità senza toccare il codice di Harness Designer: comandi, voci di menù contestuale,
regole di verifica, esportatori, simboli di connettore, nomi colore, sezioni della barra laterale e
traduzioni.

Un plugin **non** è compilato insieme all'applicazione: è JavaScript puro, servito così com'è. Non può
usare gli alias `@/...`, non può importare i moduli interni e non ha bisogno di alcun passo di build.
Tutto ciò che gli serve arriva dall'oggetto `api` passato ad `activate`.

Due esempi pronti si trovano in `public/plugins/`:

| file                                 | id                 | cosa aggiunge                                                           |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| `public/plugins/metraggi.js`         | `metraggi`         | comando "metraggio per copertura" + regola di verifica sulle lunghezze  |
| `public/plugins/connettore-tondo.js` | `connettore-tondo` | simbolo di connettore circolare + voce di menù + sigle colore DIN 47002 |

## L'oggetto da esportare

Il modulo deve esportare come **default** un oggetto `HarnessPlugin`:

```ts
interface HarnessPlugin {
  /** identificativo univoco e stabile: distingue il plugin e isola la sua memoria */
  id: string;
  /** nome mostrato nel pannello Plugin */
  name: string;
  version?: string;
  author?: string;
  description?: string;
  activate(api: PluginAPI): void | Promise<void>;
  deactivate?(): void;
}
```

`id` non va più cambiato dopo la prima pubblicazione: è la chiave con cui il plugin viene ricordato fra
una sessione e l'altra e con cui è indicizzata la sua memoria (`api.storage`).

## Ciclo di vita

1. **Caricamento** — l'host importa il modulo (da URL o da sorgente incorporata) e legge l'export default.
2. **`activate(api)`** — è qui che va registrato _tutto_. Può essere `async`: l'host attende la promessa.
3. **Uso** — i contributi restano attivi finché il plugin è abilitato.
4. **`deactivate()`** (facoltativa) e funzioni passate a **`api.onDispose(fn)`** — vengono eseguite alla
   disattivazione o alla rimozione.

Ogni contributo registrato tramite `api` è **revocabile**: l'host raccoglie da sé le funzioni di rimozione e
le esegue alla disattivazione, quindi comandi, voci di menù, regole ed esportatori spariscono senza
ricaricare la pagina. `api.onDispose` serve per ciò che l'host non conosce: timer, `addEventListener` sul
`document`, `AbortController`, connessioni.

Un errore sollevato durante il caricamento, in `activate` o dentro un contributo viene intercettato
dall'host: il plugin viene segnato come _fallito_ nel pannello Plugin e l'applicazione prosegue.

Due accortezze pratiche:

- **guardia dopo la disattivazione** — una voce di menù già aperta può essere premuta dopo che il plugin è
  stato disabilitato; tenere un flag `disposed` impostato da `onDispose` ed uscire subito (entrambi gli
  esempi lo fanno);
- **i nomi colore e i messaggi non si tolgono** — `api.colors.registerName` e `api.i18n.add` alimentano
  registri di sola aggiunta: dopo la disattivazione un colore e una traduzione restano riconosciuti. Non è
  un contributo visibile nell'interfaccia, quindi non lascia funzionalità attive.

## PluginAPI — elenco completo

```ts
interface PluginAPI {
  /** id dichiarato dal plugin */
  readonly id: string;
  /** versione dell'applicazione, per adattarsi a più versioni */
  readonly appVersion: string;
  /** traduzione nella lingua attiva: t("chiave", { nome: "valore" }) */
  readonly t: (key: string, params?: Record<string, string | number>) => string;

  /* --- documento --- */
  getDoc(): HarnessDoc;
  /** una sola azione annullabile; false se la funzione non ha cambiato nulla */
  edit(mutate: (doc: HarnessDoc) => void, reason?: string): boolean;
  getSelection(): Selection | null;
  select(selection: Selection | null): void;

  /* --- contributi --- */
  commands: {
    register(command: {
      id: string;
      /** chiave i18n del titolo mostrato nella palette (Ctrl+K) */
      titleKey: string;
      /** scorciatoia dichiarativa, es. "Ctrl+Alt+M" */
      shortcut?: string;
      run(app: AppContext): void | Promise<void>;
    }): void;
  };
  menu: {
    /** invocata ad ogni apertura del menù contestuale: restituisci le voci da aggiungere */
    contribute(fn: (ctx: { target: Selection | null; world: Point; app: AppContext }) => MenuItem[]): void;
  };
  validation: { addRule(rule: ValidationRule): void };
  exporters: { register(exporter: Exporter): void };
  symbols: { registerConnector(symbol: ConnectorSymbol): void };
  colors: { registerName(name: string, hex: string): void };
  i18n: { add(locale: "it" | "en", messages: Record<string, string>): void };

  /* --- interfaccia --- */
  ui: {
    toast(message: string): void;
    confirm(options: {
      title: string;
      body: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }): Promise<boolean>;
    prompt(options: {
      title: string;
      label: string;
      value?: string;
      placeholder?: string;
    }): Promise<string | null>;
    /** sezione aggiuntiva del pannello proprietà */
    sidebarSection(
      section: (container: HTMLElement, selection: Selection | null, app: AppContext) => void,
    ): void;
  };

  /* --- eventi, memoria, pulizia --- */
  events: { on(event: "doc" | "selection" | "load", fn: (payload: unknown) => void): () => void };
  storage: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void };
  onDispose(fn: () => void): void;
}
```

### Tipi che ricorrono

```ts
type EntityType = "node" | "segment" | "inline" | "table";
interface Selection {
  type: EntityType;
  id: string;
}
interface Point {
  x: number;
  y: number;
}

type MenuItem =
  | { label: string; run: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { separator: true }
  | { header: string };

interface ValidationRule {
  id: string;
  run(ctx: {
    doc: HarnessDoc;
    t: Translate;
    tables: CavityTable[]; // tabelle cavità già riconosciute
    byOwner: Map<string, CavityTable>; // indicizzate per nome del connettore
  }): Issue[];
}

interface Issue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  target?: Selection; // rende il problema cliccabile nel rapporto di verifica
}

interface Exporter {
  id: string;
  labelKey: string;
  run(app: AppContext): void | Promise<void>;
}

interface ConnectorSymbol {
  id: string; // finisce in node.style, quindi nel file .json
  labelKey: string; // chiave i18n del nome nei menù
  tip: number; // distanza dall'origine alla punta, per collocare l'etichetta
  draw(group: SVGGElement): void;
  hidden?: boolean;
}
```

`AppContext` (in `src/app/context.ts`) è il contesto completo dell'applicazione, ricevuto dai comandi e
dalle voci di menù: `store`, `renderer`, `t`, `dialogs`, `toast`, `commands`, `plugins`, `exporters`,
`doc`, `version`, oltre a `refreshUi()`, `refreshProps()`, `showReport()`, `openFilePicker()`, `pickCsv()`.
Da lì passa, per esempio, `app.renderer.contentBBox()` per sapere dove finisce il disegno.

### Regole di buon vicinato

- **Nessun testo a schermo scritto a mano.** Ogni stringa visibile passa da `t("chiave")`; le chiavi si
  registrano con `api.i18n.add` per **tutte** le lingue dell'applicazione (`it` ed `en`). Convenzione dei
  nomi: `plugin.<id>.<nome>`.
- **Modifiche solo tramite `api.edit`.** Mutare il documento fuori da `edit` non aggiorna cronologia,
  salvataggio automatico e ridisegno.
- **Prefissa gli identificativi** di comandi, regole e simboli con l'id del plugin, per non collidere con
  altri plugin.
- **Niente `alert`/`confirm`/`prompt` nativi**: usa `api.ui.confirm` e `api.ui.prompt`.
- **Nessuna dipendenza esterna**: l'applicazione deve restare utilizzabile offline.

## Come si installa

Dalla barra superiore, pulsante **Plugin**:

- **Da URL** — indirizzo di un modulo ES, per esempio uno dei plugin distribuiti con l'applicazione:
  `plugins/metraggi.js` oppure `plugins/connettore-tondo.js` (i file di `public/plugins/` finiscono nella
  radice del sito). Un indirizzo esterno deve essere raggiungibile e servito con gli header CORS adatti.
- **Da file** — si sceglie un `.js` dal disco: il contenuto viene letto e conservato come sorgente
  incorporata, quindi il plugin continua a funzionare anche offline e dopo un riavvio del browser.

L'elenco dei plugin, il loro stato (attivo, disattivato, fallito) e la memoria di `api.storage` sono
conservati in `localStorage` del browser: restano su questa macchina e non viaggiano con il file `.json`
del disegno.

### Avvertenza sui permessi

I plugin girano **nello stesso contesto della pagina**, senza sandbox: hanno accesso al documento, al DOM,
a `localStorage` e alla rete esattamente come l'applicazione. È una scelta esplicita — un plugin deve poter
disegnare sul foglio e leggere il documento — ma significa che **installare un plugin equivale a eseguire
codice altrui sul proprio computer**.

Installa solo plugin di cui conosci la provenienza, leggi il sorgente prima di installarlo (sono file
piccoli e leggibili) e preferisci l'installazione da file, che congela una versione verificata invece di
riscaricare a ogni avvio ciò che si trova a quell'indirizzo. L'host isola gli **errori** dei plugin, non i
loro **permessi**.

## Modello minimo da copiare

```js
export default {
  id: "mio-plugin",
  name: "Il mio plugin",
  version: "1.0.0",
  author: "Nome Cognome",
  description: "Che cosa aggiunge, in una riga.",

  activate(api) {
    let disposed = false;
    api.onDispose(() => {
      disposed = true;
    });

    api.i18n.add("it", { "plugin.mio-plugin.hello": "Ciao dal plugin" });
    api.i18n.add("en", { "plugin.mio-plugin.hello": "Hello from the plugin" });

    api.commands.register({
      id: "mio-plugin.hello",
      titleKey: "plugin.mio-plugin.hello",
      run() {
        if (disposed) return;
        api.ui.toast(api.t("plugin.mio-plugin.hello"));
      },
    });
  },
};
```

Il comando compare subito nella palette (`Ctrl+K`) con il titolo tradotto.

## I due esempi

### `public/plugins/metraggi.js`

Cosa mostra: **comando che scrive sul foglio**, **regola di verifica**, **traduzioni**, **memoria del
plugin**.

- `parseLengthMm(value)` converte in millimetri le lunghezze scritte a mano — `"600 mm"`, `"1,2 m"`,
  `"30 cm"`, `"12 ft"`, `"18\""` — e restituisce `null` per tutto il resto (`"da definire"` non è un
  errore di battitura da correggere). Un numero senza unità è inteso in millimetri, l'unità di quotatura
  del disegno.
- La **copertura** non è un campo del modello dati: è scritta come etichetta inline sul ramo
  (`COR ø13`, `GUAINA`, `NASTRO`). Il plugin riconosce le etichette che nominano una protezione con
  un'espressione regolare e ignora le altre (un `FUS 15A` non è una copertura); i rami senza etichette di
  protezione finiscono nel gruppo "Senza copertura".
- Il comando somma i millimetri per gruppo, ordina dal più lungo, aggiunge la riga dei rami non
  quantificati e il totale, poi scrive la tabella con `api.edit`. La tabella è **unica**: il suo id viene
  ricordato con `api.storage`, quindi ripetere il comando la riscrive invece di accumularne copie. La prima
  volta viene collocata a destra del disegno usando `app.renderer.contentBBox()`.
- La regola `metraggi.missing-length` percorre i rami e segnala con un avviso quelli la cui lunghezza non è
  interpretabile, indicando in `target` il ramo: nel rapporto di verifica il problema diventa cliccabile.

### `public/plugins/connettore-tondo.js`

Cosa mostra: **simbolo di connettore**, **voce di menù contestuale condizionata**, **nomi colore**.

- `api.symbols.registerConnector` aggiunge lo stile `round`. Il gruppo SVG ricevuto da `draw(g)` è già
  ruotato in modo che il filo entri **da destra**, con l'origine sul nodo: il simbolo si sviluppa quindi
  verso le _x_ negative. `tip` dichiara la distanza dall'origine alla punta e serve all'applicazione per
  collocare l'etichetta del nodo senza sovrapposizioni.
- L'id dello stile (`"round"`) finisce dentro `node.style` e quindi nel file `.json`: se il plugin non è
  installato, quel connettore viene disegnato con lo stile di ripiego, ma il dato non va perso.
- `api.menu.contribute` restituisce la voce **solo** quando il bersaglio è un nodo con al più un ramo
  collegato — l'invariante dell'applicazione vuole i terminali soltanto alle estremità — e la disabilita se
  lo stile è già applicato.
- `api.colors.registerName` registra le sigle DIN 47002 (`sw` nero, `rt` rosso, `ge` giallo, `gn` verde,
  `bl` blu, `br` marrone, `ws` bianco, `gr` grigio) con le stesse tinte dei nomi italiani, così una cella
  scritta `ge/sw` produce lo stesso campione a due bande di `giallo/nero`.

---

# English

## What a plugin is

A plugin is an **ES module** (a `.js` file) that the application loads through a dynamic `import()` and
that extends Harness Designer without touching its code: commands, context-menu entries, validation rules,
exporters, connector symbols, colour names, sidebar sections and translations.

A plugin is **not** compiled with the application: it is plain JavaScript, served as-is. It cannot use the
`@/...` aliases, cannot import internal modules and needs no build step. Everything it needs comes from the
`api` object passed to `activate`.

Two ready-made examples live in `public/plugins/`:

| file                                 | id                 | what it adds                                                     |
| ------------------------------------ | ------------------ | ---------------------------------------------------------------- |
| `public/plugins/metraggi.js`         | `metraggi`         | "length by covering" command + validation rule on branch lengths |
| `public/plugins/connettore-tondo.js` | `connettore-tondo` | round connector symbol + menu entry + DIN 47002 colour codes     |

## The object to export

The module must export a `HarnessPlugin` object as **default**:

```ts
interface HarnessPlugin {
  /** unique, stable identifier: identifies the plugin and scopes its storage */
  id: string;
  /** name shown in the Plugins panel */
  name: string;
  version?: string;
  author?: string;
  description?: string;
  activate(api: PluginAPI): void | Promise<void>;
  deactivate?(): void;
}
```

Never change `id` after the first release: it is the key under which the plugin is remembered across
sessions and under which its storage (`api.storage`) is filed.

## Lifecycle

1. **Loading** — the host imports the module (from a URL or from inlined source) and reads the default export.
2. **`activate(api)`** — register _everything_ here. It may be `async`: the host awaits the promise.
3. **Use** — contributions stay live while the plugin is enabled.
4. **`deactivate()`** (optional) and the functions given to **`api.onDispose(fn)`** — run on disable or removal.

Every contribution registered through `api` is **revocable**: the host collects the removal functions itself
and runs them on disable, so commands, menu entries, rules and exporters disappear without a page reload.
`api.onDispose` is for what the host cannot know about: timers, `document`-level listeners,
`AbortController`s, connections.

An error thrown while loading, inside `activate` or inside a contribution is caught by the host: the plugin
is marked _failed_ in the Plugins panel and the application keeps working.

Two practical points:

- **guard after disposal** — an already open menu entry can be clicked after the plugin was disabled; keep a
  `disposed` flag set from `onDispose` and return immediately (both examples do this);
- **colour names and messages are not removed** — `api.colors.registerName` and `api.i18n.add` feed
  append-only registries: after disabling, a colour and a translation stay recognised. Neither is a visible
  contribution, so nothing keeps working behind the user's back.

## PluginAPI — full listing

```ts
interface PluginAPI {
  /** id declared by the plugin */
  readonly id: string;
  /** application version, to adapt across releases */
  readonly appVersion: string;
  /** translation in the active locale: t("key", { name: "value" }) */
  readonly t: (key: string, params?: Record<string, string | number>) => string;

  /* --- document --- */
  getDoc(): HarnessDoc;
  /** one undo step; false when the callback changed nothing */
  edit(mutate: (doc: HarnessDoc) => void, reason?: string): boolean;
  getSelection(): Selection | null;
  select(selection: Selection | null): void;

  /* --- contributions --- */
  commands: {
    register(command: {
      id: string;
      /** i18n key of the title shown in the palette (Ctrl+K) */
      titleKey: string;
      /** declarative shortcut, e.g. "Ctrl+Alt+M" */
      shortcut?: string;
      run(app: AppContext): void | Promise<void>;
    }): void;
  };
  menu: {
    /** called every time the context menu opens: return the entries to add */
    contribute(fn: (ctx: { target: Selection | null; world: Point; app: AppContext }) => MenuItem[]): void;
  };
  validation: { addRule(rule: ValidationRule): void };
  exporters: { register(exporter: Exporter): void };
  symbols: { registerConnector(symbol: ConnectorSymbol): void };
  colors: { registerName(name: string, hex: string): void };
  i18n: { add(locale: "it" | "en", messages: Record<string, string>): void };

  /* --- user interface --- */
  ui: {
    toast(message: string): void;
    confirm(options: {
      title: string;
      body: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }): Promise<boolean>;
    prompt(options: {
      title: string;
      label: string;
      value?: string;
      placeholder?: string;
    }): Promise<string | null>;
    /** extra section in the properties panel */
    sidebarSection(
      section: (container: HTMLElement, selection: Selection | null, app: AppContext) => void,
    ): void;
  };

  /* --- events, storage, cleanup --- */
  events: { on(event: "doc" | "selection" | "load", fn: (payload: unknown) => void): () => void };
  storage: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void };
  onDispose(fn: () => void): void;
}
```

### Recurring types

```ts
type EntityType = "node" | "segment" | "inline" | "table";
interface Selection {
  type: EntityType;
  id: string;
}
interface Point {
  x: number;
  y: number;
}

type MenuItem =
  | { label: string; run: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { separator: true }
  | { header: string };

interface ValidationRule {
  id: string;
  run(ctx: {
    doc: HarnessDoc;
    t: Translate;
    tables: CavityTable[]; // cavity tables already recognised
    byOwner: Map<string, CavityTable>; // indexed by connector name
  }): Issue[];
}

interface Issue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  target?: Selection; // makes the issue clickable in the validation report
}

interface Exporter {
  id: string;
  labelKey: string;
  run(app: AppContext): void | Promise<void>;
}

interface ConnectorSymbol {
  id: string; // ends up in node.style, hence in the .json file
  labelKey: string; // i18n key of the name shown in menus
  tip: number; // origin-to-tip distance, used to place the node label
  draw(group: SVGGElement): void;
  hidden?: boolean;
}
```

`AppContext` (see `src/app/context.ts`) is the full application context handed to commands and menu
entries: `store`, `renderer`, `t`, `dialogs`, `toast`, `commands`, `plugins`, `exporters`, `doc`,
`version`, plus `refreshUi()`, `refreshProps()`, `showReport()`, `openFilePicker()`, `pickCsv()`. That is
where `app.renderer.contentBBox()` comes from, for instance, when you need to know where the drawing ends.

### House rules

- **No hand-written on-screen text.** Every visible string goes through `t("key")`; keys are registered with
  `api.i18n.add` for **all** application locales (`it` and `en`). Naming convention: `plugin.<id>.<name>`.
- **Change the document only through `api.edit`.** Mutating it outside `edit` leaves history, autosave and
  redraw out of sync.
- **Prefix your identifiers** for commands, rules and symbols with the plugin id, to avoid clashes.
- **No native `alert`/`confirm`/`prompt`**: use `api.ui.confirm` and `api.ui.prompt`.
- **No external dependencies**: the application must stay usable offline.

## Installing

From the top bar, **Plugins** button:

- **From URL** — the address of an ES module, for example one of the plugins shipped with the application:
  `plugins/metraggi.js` or `plugins/connettore-tondo.js` (files in `public/plugins/` land in the site root).
  An external address must be reachable and served with suitable CORS headers.
- **From file** — pick a `.js` from disk: its content is read and kept as inlined source, so the plugin keeps
  working offline and across browser restarts.

The plugin list, its status (enabled, disabled, failed) and the `api.storage` data live in the browser's
`localStorage`: they stay on this machine and do not travel inside the drawing's `.json` file.

### A word about permissions

Plugins run **in the page's own context**, unsandboxed: they can reach the document, the DOM,
`localStorage` and the network exactly like the application. This is a deliberate trade-off — a plugin must
be able to draw on the sheet and read the document — but it means **installing a plugin is running someone
else's code on your computer**.

Only install plugins whose origin you know, read the source before installing (these files are small and
readable), and prefer installing from file, which freezes a version you have checked instead of
re-downloading whatever sits at that address on every start. The host isolates plugin **errors**, not
plugin **permissions**.

## Minimal template

```js
export default {
  id: "my-plugin",
  name: "My plugin",
  version: "1.0.0",
  author: "Your Name",
  description: "What it adds, in one line.",

  activate(api) {
    let disposed = false;
    api.onDispose(() => {
      disposed = true;
    });

    api.i18n.add("it", { "plugin.my-plugin.hello": "Ciao dal plugin" });
    api.i18n.add("en", { "plugin.my-plugin.hello": "Hello from the plugin" });

    api.commands.register({
      id: "my-plugin.hello",
      titleKey: "plugin.my-plugin.hello",
      run() {
        if (disposed) return;
        api.ui.toast(api.t("plugin.my-plugin.hello"));
      },
    });
  },
};
```

The command shows up straight away in the palette (`Ctrl+K`) with its translated title.

## The two examples

### `public/plugins/metraggi.js`

Shows: **a command that writes on the sheet**, **a validation rule**, **translations**, **plugin storage**.

- `parseLengthMm(value)` converts hand-written lengths to millimetres — `"600 mm"`, `"1,2 m"`, `"30 cm"`,
  `"12 ft"`, `"18\""` — and returns `null` for anything else (`"tbd"` is not a typo waiting to be fixed).
  A bare number is read as millimetres, the drawing's dimensioning unit.
- **Covering** is not a field of the data model: it is written as an inline label on the branch
  (`COR ø13`, `GUAINA`, `NASTRO`). The plugin recognises labels naming a protection through a regular
  expression and ignores the others (a `FUS 15A` is not a covering); branches with no protection label fall
  into the "no covering" group.
- The command sums millimetres per group, sorts longest first, appends the unmeasured-branches row and the
  total, then writes the table through `api.edit`. There is a **single** table: its id is remembered with
  `api.storage`, so running the command again rewrites it instead of piling up copies. The first time, it is
  placed to the right of the drawing using `app.renderer.contentBBox()`.
- Rule `metraggi.missing-length` walks the branches and warns about those whose length cannot be read,
  pointing `target` at the branch so the issue is clickable in the validation report.

### `public/plugins/connettore-tondo.js`

Shows: **a connector symbol**, **a conditional context-menu entry**, **colour names**.

- `api.symbols.registerConnector` adds the `round` style. The SVG group handed to `draw(g)` is already
  rotated so that the wire comes in **from the right**, with the origin on the node: the symbol therefore
  grows towards negative _x_. `tip` declares the origin-to-tip distance and lets the application place the
  node label without overlaps.
- The style id (`"round"`) is stored in `node.style` and hence in the `.json` file: without the plugin
  installed that connector falls back to a default symbol, but the data is not lost.
- `api.menu.contribute` returns the entry **only** when the target is a node with at most one branch
  attached — the application's invariant keeps terminals at branch ends — and disables it when the style is
  already applied.
- `api.colors.registerName` registers the DIN 47002 codes (`sw` black, `rt` red, `ge` yellow, `gn` green,
  `bl` blue, `br` brown, `ws` white, `gr` grey) with the same tints as the built-in names, so a cell reading
  `ge/sw` yields the same two-band swatch as `yellow/black`.
