# Contributing

Thanks for taking a look. This file covers how to run the project and the
handful of conventions that keep it coherent.

## Getting started

Node 20 or newer. There are no runtime dependencies: everything below is
development tooling.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run typecheck  # tsc, no emit
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # typecheck + static site in dist/
```

`npm run build:standalone` produces `dist-standalone/index.html`, a single file
that opens with a double click and works with no server at all.

## Conventions

These are not style preferences: each one exists because the alternative caused
a real problem.

**Every change to the document goes through `store.edit(...)`**, or through the
`store.beginLive()` / `store.live(...)` / `store.endLive()` trio for drags and
continuous typing. That is what makes a change one undo step and gets it saved.
`store.edit` records nothing when the document does not actually change, so undo
never takes an empty step.

**Redrawing is complete and deferred.** `renderer.requestRedraw()` coalesces
draws onto one frame. There is no diffing: any change to `doc` ends in a full
redraw. It is cheaper than keeping a partial update correct.

**No user-facing string outside i18n.** Use `t("key")`. A key added to
`i18n/it.ts` has to be added to `i18n/en.ts` as well, or `tests/i18n.test.ts`
fails.

**No runtime dependencies.** The application has to stay installable by copying
a folder over FTP, and has to work offline.

**`normalizeDoc` is the barrier.** Everything entering the application (opened
file, autosave, plugins) passes through it, so no other module has to defend
itself against dangling references.

**Comments explain why, not what.** The code says what it does. A comment earns
its place by recording a constraint, a browser quirk or a decision that is not
obvious from the lines below it.

**Hit-testing** goes through `data-ent` (`node|segment|inline|table`) and
`data-id` on the SVG elements; table cells also carry `data-row` / `data-col`.

**Tooltips use `data-tip`, never `title`.** The native tooltip is slow, cannot
be styled and never appears on touch. Text in trailing brackets is rendered as a
key cap: `"Undo (Ctrl+Z)"`.

**Scrollbars are hidden everywhere** while scrolling still works. If content can
be clipped, wrap it rather than relying on a bar nobody can see.

**Colours live in `styles/app.css`** under `:root[data-theme=…]`; modules use the
variable names, never a literal. The drawing has its own palette in
`render/palette.ts`, and `palette()` must be read on every stroke rather than
cached in a module constant. `withPaper(...)` forces white paper for export and
print: a harness drawing is printed on a white sheet, and that constraint stays.

## Before opening a pull request

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Keep commits focused: one logical change each, with a message that says why.
