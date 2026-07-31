# Security

## What this application is

Harness Designer is a static site. There is no backend, no account, no database
and no telemetry. Every drawing lives in the browser that opened it: in
`localStorage` for the autosave, and in the `.json` files you save yourself.
Nothing is uploaded anywhere.

That shape removes most of the usual attack surface, and leaves two things worth
stating plainly.

## Plugins run with the page's own permissions

A plugin is a JavaScript module the application imports and executes. It is not
sandboxed: it can do anything the page itself can do, including reading and
rewriting your drawing and its stored copy. The host isolates plugin **errors**,
so a broken plugin cannot take the application down with it, but it does not
isolate **permissions**.

Two consequences:

- **Only install plugins you trust.** The plugin panel says so before you
  install anything, and it is not a formality.
- **External plugins are only loaded over `https:`.** Anything from the page's
  own origin is allowed too, which covers the built-in plugins, the dev server
  and the single-file build opened from disk. A plain `http:` address or a
  pasted `data:` URL is refused, because a plugin address is stored and
  re-executed at every startup: a bad one would stay active forever.

## Files you open

Any `.json` you open passes through `normalizeDoc` before anything else touches
it. It rebuilds the document field by field, drops dangling references,
duplicate ids and self-loops, and clamps values into range. A malformed or
hand-edited file can make the drawing wrong, but it cannot put the application
into an unrecoverable state, and there is no code path that evaluates it.

## Reporting a problem

Open an issue on GitHub. If you would rather not discuss it in the open, say so
in the issue without the details and a private channel will be arranged.

Please include the browser and version, what you did, and what happened.
