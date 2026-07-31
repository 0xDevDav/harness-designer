# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.1.6]

### Added

- Copy and paste: `Ctrl+C` takes whatever is selected, `Ctrl+V` puts an
  identical one down with its corner exactly where the pointer is. The
  right-click menu offers the same, and pastes at the point that was clicked.
  References inside the copy follow the copies — two connectors copied together
  stay mated, a branch keeps its ends, a cavity table copied with its connector
  goes on belonging to it — while references out of it are dropped, so a copy
  never lays claim to what the original owns. A copied connector is given a free
  name. The title block is not copied: there is one to a sheet.
- Inline labels take any colour, not only the six presets, and the menu marks
  the one already in use.

### Changed

- A bundle of banded wires draws in a fortieth of the time. The marks are worked
  out from the geometry rather than measured against a live document, all the
  marks of one colour go into a single shape, and nothing is drawn outside the
  window or smaller than the pixels it would be drawn on. A trunk carrying
  seventy banded wires went from 14.7 s a frame to 40 ms.

## [1.1.5]

### Added

- Wires of two or more colours are marked the way they really are: the first
  colour is the ground the wire is made of, the rest are bands across it
  repeated along its length, leaning as if wound round it. A wire of three or
  four colours used to be drawn exactly like a wire of two.

## [1.1.4]

### Fixed

- Each half of a circuit running through a joint is drawn in the colour its own
  end declares. The wire list keeps one colour per wire, which is right until a
  joint makes it two wires — and the whole point of a joint is that the colour
  is allowed to change there.

## [1.1.3]

### Added

- A connector can be pointed by hand: selecting one offers the four directions,
  and the symbol, its name and the cable leaving it all follow.

### Changed

- An automatic corner forms at the midpoint between the two ends it joins,
  instead of hard against one of them.
- A selected branch is lit with a single stroke: no paler halo around it and no
  dots at the ends.
- The name of a mated connector lifts clear of the joint, which shares its axis.

## [1.1.2]

### Added

- A circuit can be routed through a joint. Two mated connectors carry it on, but
  what the tables describe is then two wires and not one: they may be different
  colours and different sections, the checks allow it, and no single cut length
  is offered where there is none.
- The joint is drawn the way it plugs in: the arrow leaves along the connector's
  own axis and curves into the other.

## [1.1.1]

### Added

- A message when a newer version is ready, with a Reload button, instead of
  waiting for every tab to be closed.

### Fixed

- The service worker's version is stamped in at build time, and the build fails
  if the line it writes to has gone. Releasing with a stale cache name left
  1.1.0 unreachable for anyone who had already opened the program.

## [1.1.0]

### Added

- The wires inside the bundle, drawn for whatever is selected: routed from the
  cavity tables, each on its own lane, ordered by where it is going so a fan-out
  does not cross itself.
- Cut lengths summed along each wire's route, and wires whose two ends no chain
  of branches joins reported as unbuildable.
- Branches turn corners: bend points where the harness turns, and a whole
  drawing that can be squared off with the corners forming themselves.
- Two connectors can be mated into a joint, and nodes gathered with `Ctrl` can
  be merged into one.
- Plugins can register whole languages, not only their own strings.

### Fixed

- Routing reads every spelling of a destination a real drawing uses, not only
  `C3.7`.
- The plugin panel explains why a GitHub `raw` URL cannot be installed.

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
