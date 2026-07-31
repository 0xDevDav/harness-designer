# Pubblicazione / Deployment

[🇮🇹 Italiano](#italiano) · [🇬🇧 English](#english)

---

<a id="italiano"></a>

# 🇮🇹 Italiano

Harness Designer è un **sito statico**: HTML, CSS, JavaScript e nient'altro. Non serve PHP, né un database, né alcuna configurazione lato server. Va bene qualsiasi hosting condiviso (Hostinger, Altervista, Aruba, Netsons…), un GitHub Pages, o anche una cartella su una rete locale.

## 1. Compilare

Dalla cartella del progetto:

```bash
npm install
npm run build
```

`npm run build` esegue prima il controllo dei tipi (`tsc --noEmit`) e poi la compilazione: se i tipi non tornano, la build si ferma e non produce file incompleti.

Il risultato è la cartella **`dist/`**. Tutto ciò che serve è lì dentro: la cartella del progetto (`src/`, `node_modules/`, i file di configurazione) **non va caricata**.

## 2. Caricare via FTP

1. Apri il tuo client FTP (FileZilla, WinSCP, il file manager del pannello di controllo…).
2. Entra nella cartella pubblica dell'hosting. Cambia nome a seconda del fornitore:

   | Hosting         | Cartella pubblica                   |
   | --------------- | ----------------------------------- |
   | Hostinger       | `public_html/`                      |
   | Altervista      | la cartella radice dello spazio FTP |
   | Aruba           | `httpdocs/` (o `www/`)              |
   | cPanel generico | `public_html/`                      |

3. Carica **il contenuto** di `dist/` (non la cartella `dist` stessa): devi ritrovarti `index.html` direttamente nella cartella pubblica, con accanto `assets/`.
4. Carica in modalità **binaria** (o «automatica»): è l'impostazione predefinita di FileZilla e va bene così.
5. Visita il tuo indirizzo: l'applicazione si apre con lo schema di esempio.

### Pubblicare in una sottocartella

Funziona senza modifiche. La build usa `base: "./"` (vedi `vite.config.ts`), quindi tutti i riferimenti a JS, CSS e icone sono **relativi** al file `index.html`: la stessa cartella `dist/` funziona identica su

- `https://tuosito.it/`
- `https://tuosito.it/schemi/`
- `https://tuosito.it/clienti/officina/cablaggi/`

Non serve toccare nulla e non servono regole di riscrittura (`.htaccess`): l'applicazione è una pagina sola, senza rotte lato client.

## 3. File prodotti

| File                      | A cosa serve                                                         | Obbligatorio |
| ------------------------- | -------------------------------------------------------------------- | ------------ |
| `index.html`              | La pagina dell'applicazione, punto di ingresso                       | Sì           |
| `assets/index-<hash>.js`  | Tutto il codice compilato                                            | Sì           |
| `assets/index-<hash>.css` | Tutti gli stili                                                      | Sì           |
| `assets/*.map`            | Sourcemap, servono solo a chi indaga un errore col debugger          | No           |
| `manifest.webmanifest`    | Nome, icona e colori quando l'app viene «installata» sul dispositivo | No           |
| `sw.js`                   | Service worker: mette in cache l'app perché funzioni anche offline   | No           |
| `plugins/`                | Plugin distribuiti insieme all'applicazione, se presenti             | No           |

Il nome dei file in `assets/` contiene un **hash del contenuto**: cambia a ogni build in cui il codice cambia. È quello che impedisce ai browser di servire una versione vecchia del programma. Tutto ciò che metti nella cartella `public/` del progetto viene copiato tale e quale in `dist/`.

> Se non ti interessa distribuire le sourcemap, puoi semplicemente non caricare i file `.map`: l'applicazione funziona lo stesso. In alternativa metti `sourcemap: false` in `vite.config.ts`.

## 4. HTTPS e funzionamento offline

Il service worker — quello che permette all'applicazione di aprirsi anche senza rete e di essere installata come app — viene registrato dal browser **solo su HTTPS** (con l'unica eccezione di `http://localhost`, per lo sviluppo). Su un indirizzo `http://` non viene registrato affatto: l'applicazione continua a funzionare normalmente, ma perde la modalità offline e l'installabilità.

In pratica:

- attiva il certificato **SSL/TLS gratuito** che il tuo hosting offre (su Hostinger e Altervista è un interruttore nel pannello) e forza il reindirizzamento da `http://` a `https://`;
- verifica che l'indirizzo mostri il lucchetto;
- il file `sw.js` deve stare **accanto a `index.html`**: un service worker può controllare solo i file della propria cartella e delle sottocartelle. Se pubblichi in `/schemi/`, `sw.js` va in `/schemi/sw.js` — è già così se hai caricato il contenuto di `dist/` senza spostare nulla.

Al primo caricamento riuscito compare un messaggio che conferma la disponibilità offline.

## 5. Aggiornare e svuotare la cache

Per aggiornare: ricompila (`npm run build`) e ricarica il contenuto di `dist/` sovrascrivendo quello vecchio. Conviene **cancellare prima la vecchia cartella `assets/`**, altrimenti si accumulano i file delle build precedenti.

Il codice in `assets/` non dà problemi di cache perché il nome cambia a ogni versione. Restano invece invariati `index.html` e `sw.js`, e sono proprio loro a poter «restare indietro». Se dopo l'aggiornamento vedi ancora la versione vecchia:

1. **Ricarica forzata**: `Ctrl+F5` (Windows) o `Cmd+Shift+R` (macOS).
2. **Chiudi tutte le schede** dell'applicazione e riaprila: un service worker nuovo prende il controllo solo quando non restano pagine aperte con quello vecchio.
3. Se non basta, svuota manualmente: nel browser apri gli strumenti per sviluppatori → _Applicazione_ / _Archiviazione_ → _Cancella dati del sito_, oppure _Service worker_ → _Annulla registrazione_.
4. Se il tuo hosting ha una **CDN o una cache lato server** (Hostinger e Cloudflare ce l'hanno), svuotala dal pannello di controllo dopo ogni caricamento.

> Attenzione: «Cancella dati del sito» elimina anche il **salvataggio automatico** del disegno in corso, che vive nel `localStorage` del browser. Prima di farlo, salva il tuo lavoro con **Salva** (file `.json`).

## 6. Variante «file unico» (offline, senza hosting)

Se ti serve solo aprire il programma con un doppio clic — su una chiavetta, su un PC di officina senza rete, come allegato di posta:

```bash
npm run build:standalone
```

Produce **`dist-standalone/index.html`**: un solo file, con CSS e JavaScript incorporati, senza alcun file di supporto. Si apre con un doppio clic dal protocollo `file://`.

È la copia da passare a qualcuno: un allegato, una chiavetta, una cartella condivisa. Chi la riceve fa doppio clic e lavora, senza installare nulla e senza connessione.

Differenze rispetto alla versione pubblicata:

- **funziona**: disegno, modifica sul foglio, tabelle, collegamento reciproco, verifica, salvataggio e apertura dei `.json`, esportazione SVG/PNG/CSV, stampa, salvataggio automatico e i **due plugin di serie**, i cui sorgenti sono incorporati nel file (`src/plugins/bundled.standalone.ts`) e vengono valutati in memoria, senza `import()` — che dal protocollo `file://` sarebbe vietato;
- **non funziona**: il service worker e il manifesto (inutili quando il file è già in locale: la build li esclude e il programma non li richiede nemmeno) e l'installazione di plugin **da URL**, perché il browser non carica moduli esterni da `file://`. L'installazione di un plugin da **file locale** funziona se il plugin è autonomo, cioè se espone una sola `export default` senza importare altri moduli.

Due dettagli tecnici che rendono possibile l'apertura da disco, da non rimuovere per sbaglio:

1. lo script è **classico e in fondo al corpo della pagina**, non un modulo ES nell'intestazione: i moduli sono bloccati su `file://`, e uno script classico nell'intestazione girerebbe prima che il documento esista;
2. l'esportazione PNG prova prima un blob URL e, se il browser considera «sporca» la tela — succede proprio da `file://` — ricade su una data URI.

## 7. Verifiche dopo la pubblicazione

- [ ] L'indirizzo si apre e mostra lo schema di esempio, non una pagina bianca.
- [ ] La barra dell'indirizzo mostra `https://` e il lucchetto.
- [ ] La console del browser (`F12`) non riporta errori 404: se ne vedi, hai caricato `dist` come cartella invece del suo contenuto, oppure hai dimenticato `assets/`.
- [ ] Il tasto destro sul foglio apre il menù delle azioni.
- [ ] Disegna un ramo (`B`), ricarica la pagina: il disegno è ancora lì (salvataggio automatico attivo).
- [ ] **Salva** scarica un file `.json`; **Apri** lo ricarica correttamente.
- [ ] **Esporta → PNG** e **→ SVG** producono un file corretto.
- [ ] **Esporta → Stampa** apre l'anteprima di stampa con il disegno leggibile.
- [ ] Il selettore della lingua cambia effettivamente i testi dell'interfaccia.
- [ ] Su telefono o tablet: pizzico per lo zoom, trascinamento con un dito, tocco prolungato per il menù.
- [ ] Riapri l'indirizzo con la rete disattivata: l'applicazione si carica comunque (service worker attivo).
- [ ] Un file `.json` salvato in precedenza si apre senza errori.

## 8. Problemi frequenti

| Sintomo                                                    | Causa e rimedio                                                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pagina bianca, console con errori 404 su `/assets/…`       | Hai caricato la cartella `dist` invece del suo contenuto. Sposta `index.html` e `assets/` di un livello più su                                            |
| «Failed to load module script… MIME type»                  | Il server restituisce i `.js` con un tipo MIME sbagliato. Sui pannelli condivisi è raro; se capita, aggiungi al `.htaccess` `AddType text/javascript .js` |
| L'icona e il nome dell'app non compaiono all'installazione | Il server non conosce l'estensione `.webmanifest`: `AddType application/manifest+json .webmanifest`                                                       |
| Vedo ancora la versione vecchia                            | Vedi il punto 5: ricarica forzata, chiusura delle schede, svuotamento cache/CDN                                                                           |
| Il disegno sparisce cambiando browser o dispositivo        | È normale: il salvataggio automatico è locale al browser. Per spostare il lavoro usa i file `.json`                                                       |
| Un plugin da URL non si carica                             | L'indirizzo deve essere `https://` e servito con gli header CORS che ne consentono l'importazione come modulo                                             |

---

<a id="english"></a>

# 🇬🇧 English

Harness Designer is a **static site**: HTML, CSS, JavaScript and nothing else. No PHP, no database, no server-side configuration. Any shared host works (Hostinger, Altervista, Aruba, Netsons…), as does GitHub Pages or even a folder on a local network.

## 1. Build

From the project folder:

```bash
npm install
npm run build
```

`npm run build` first runs the type check (`tsc --noEmit`) and then the bundler: if the types do not check out, the build stops and no half-finished files are produced.

The result is the **`dist/`** folder. Everything you need is in there: the project folder itself (`src/`, `node_modules/`, the configuration files) **must not be uploaded**.

## 2. Upload over FTP

1. Open your FTP client (FileZilla, WinSCP, the control panel's file manager…).
2. Enter the host's public folder. Its name depends on the provider:

   | Host           | Public folder                    |
   | -------------- | -------------------------------- |
   | Hostinger      | `public_html/`                   |
   | Altervista     | the root folder of the FTP space |
   | Aruba          | `httpdocs/` (or `www/`)          |
   | Generic cPanel | `public_html/`                   |

3. Upload **the contents** of `dist/` (not the `dist` folder itself): `index.html` must end up directly in the public folder, with `assets/` next to it.
4. Upload in **binary** (or "auto") mode: that is FileZilla's default and it is fine as is.
5. Visit your address: the application opens with the sample drawing.

### Publishing in a subfolder

Works unchanged. The build uses `base: "./"` (see `vite.config.ts`), so every reference to JS, CSS and icons is **relative** to `index.html`: the very same `dist/` folder works identically at

- `https://yoursite.com/`
- `https://yoursite.com/harness/`
- `https://yoursite.com/customers/workshop/wiring/`

Nothing to change, and no rewrite rules (`.htaccess`) are needed: the application is a single page with no client-side routing.

## 3. Produced files

| File                      | What it is for                                                 | Required |
| ------------------------- | -------------------------------------------------------------- | -------- |
| `index.html`              | The application page, the entry point                          | Yes      |
| `assets/index-<hash>.js`  | All the compiled code                                          | Yes      |
| `assets/index-<hash>.css` | All the styles                                                 | Yes      |
| `assets/*.map`            | Source maps, only useful when debugging an error               | No       |
| `manifest.webmanifest`    | Name, icon and colours when the app is "installed" on a device | No       |
| `sw.js`                   | Service worker: caches the app so it also works offline        | No       |
| `plugins/`                | Plugins shipped with the application, if any                   | No       |

File names inside `assets/` contain a **content hash**: it changes on every build where the code changed. That is what stops browsers from serving a stale version of the program. Anything you put in the project's `public/` folder is copied verbatim into `dist/`.

> If you do not care about shipping source maps, simply do not upload the `.map` files: the application works all the same. Alternatively set `sourcemap: false` in `vite.config.ts`.

## 4. HTTPS and offline use

The service worker — the piece that lets the application open without a network connection and be installed as an app — is registered by the browser **only over HTTPS** (the single exception being `http://localhost`, for development). Over a plain `http://` address it is not registered at all: the application still works normally, but loses offline mode and installability.

In practice:

- turn on the **free SSL/TLS certificate** your host provides (on Hostinger and Altervista it is a switch in the panel) and force the redirect from `http://` to `https://`;
- check that the address bar shows the padlock;
- `sw.js` must sit **next to `index.html`**: a service worker can only control files in its own folder and subfolders. If you publish under `/harness/`, then `sw.js` goes to `/harness/sw.js` — which is already the case if you uploaded the contents of `dist/` without moving anything around.

On the first successful load a message confirms that offline use is available.

## 5. Updating and clearing the cache

To update: rebuild (`npm run build`) and upload the contents of `dist/` over the old ones. It is worth **deleting the old `assets/` folder first**, otherwise files from previous builds pile up.

The code in `assets/` never causes cache trouble because its name changes with every version. `index.html` and `sw.js`, on the other hand, keep the same name, and they are precisely the ones that can lag behind. If you still see the old version after updating:

1. **Hard reload**: `Ctrl+F5` (Windows) or `Cmd+Shift+R` (macOS).
2. **Close every tab** of the application and open it again: a new service worker only takes control once no page controlled by the old one is left open.
3. If that is not enough, clear it by hand: in the browser open the developer tools → _Application_ / _Storage_ → _Clear site data_, or _Service workers_ → _Unregister_.
4. If your host has a **CDN or a server-side cache** (Hostinger and Cloudflare do), purge it from the control panel after every upload.

> Careful: "Clear site data" also wipes the **autosaved** drawing in progress, which lives in the browser's `localStorage`. Save your work with **Save** (a `.json` file) before doing it.

## 6. The "single file" variant (offline, no hosting)

If all you need is to open the program with a double click — from a USB stick, on a workshop PC with no network, as an e-mail attachment:

```bash
npm run build:standalone
```

This produces **`dist-standalone/index.html`**: one single file with CSS and JavaScript inlined and no supporting files at all. It opens with a double click over the `file://` protocol.

Differences from the published version:

- **works**: drawing, tables, checking, saving and opening `.json` files, SVG/PNG/CSV export, printing, autosave;
- **does not work**: the service worker (irrelevant — the file is already local) and installing plugins from a URL, because browsers refuse to load external modules over `file://`. Plugins bundled into the build remain available.

## 7. Post-publication checks

- [ ] The address opens and shows the sample drawing, not a blank page.
- [ ] The address bar shows `https://` and the padlock.
- [ ] The browser console (`F12`) reports no 404 errors: if it does, you uploaded `dist` as a folder instead of its contents, or you forgot `assets/`.
- [ ] Right-clicking the sheet opens the action menu.
- [ ] Draw a branch (`B`), reload the page: the drawing is still there (autosave works).
- [ ] **Save** downloads a `.json` file; **Open** loads it back correctly.
- [ ] **Export → PNG** and **→ SVG** produce a correct file.
- [ ] **Export → Print** opens the print preview with a legible drawing.
- [ ] The language selector actually changes the interface text.
- [ ] On a phone or tablet: pinch to zoom, one-finger drag, long press for the menu.
- [ ] Reopen the address with the network turned off: the application still loads (service worker active).
- [ ] A previously saved `.json` file opens without errors.

## 8. Common problems

| Symptom                                             | Cause and fix                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank page, console full of 404s on `/assets/…`     | You uploaded the `dist` folder instead of its contents. Move `index.html` and `assets/` one level up                                            |
| "Failed to load module script… MIME type"           | The server returns `.js` files with the wrong MIME type. Rare on shared panels; if it happens, add `AddType text/javascript .js` to `.htaccess` |
| The app icon and name do not show up on install     | The server does not know the `.webmanifest` extension: `AddType application/manifest+json .webmanifest`                                         |
| I still see the old version                         | See section 5: hard reload, close the tabs, purge the cache/CDN                                                                                 |
| The drawing disappears on another browser or device | That is expected: autosave is local to the browser. Use `.json` files to move your work around                                                  |
| A plugin from a URL will not load                   | The address must be `https://` and served with CORS headers that allow importing it as a module                                                 |
