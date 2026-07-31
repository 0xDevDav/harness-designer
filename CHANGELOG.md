# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.0.0]

First release.

### Added

- Formboard drawing: double-line bundles, junction boots, termination symbols
  (plug, ring, faston, pin, splice) and inline labels for fuses, conduit, sleeve
  and tape.
- Cavity tables edited straight on the sheet, tied to their connector.
- Automatic mutual linking: filling in a destination fills the matching cavity at
  the other end, colour and section included.
- Consistency check: mismatched cross-references, missing cavities, one-way
  references and wire properties that disagree between the two ends, each entry
  clickable and centred on the offending element.
- Two-ends rule: the same wire colour across three or more connectors is
  reported as a wiring mistake, with plain black exempt as ground.
- Wire list generated from the tables, mirrored pairs collapsed, exportable as
  CSV, SVG, PNG or printed.
- Bilingual interface, Italian and English, switchable at runtime.
- Command palette (`Ctrl+K`) listing every action with its shortcut.
- Plugin system: commands, validation rules, exporters, connector symbols and
  colour names, installable without recompiling. See `docs/PLUGINS.md`.
- Light and dark themes. The drawing sheet stays light in both, because that is
  what gets printed.
- Touch support, high-density screens, and an offcanvas menu on tablets and
  phones.
- Guarded autosave that warns when browser storage is full, and a warning when
  the same drawing is open in two tabs.
- Single-file build (`npm run build:standalone`): one HTML file that opens on a
  double click, with no server.
