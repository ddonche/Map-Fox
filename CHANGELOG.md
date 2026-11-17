# Changelog

All notable changes to Map Fox will be recorded here. Version numbering is continuous with the former Map Spawner V7.2; **0.7.2 is the current development series**, not 0.1.

## [0.7.2] — 2026-11-17 (development baseline)

- Renamed Map Spawner to **Map Fox**, with supplied fox branding, light ivory/fox-orange interface and MIT license.
- Restored a compact header and four left navigation actions: Generate, Import, Edit, Export.
- Maintained seeded geography generation, region creation/reroll, island settings and subdivisions.
- Added/matured editing: eyedropper, brush size shortcuts, wheel zoom, map panning, paint/fill Undo and Redo.
- Ported Goblin's `write_png!` smoothing renderer for preview and PNG export while retaining grid JSON compatibility.
- Added clean flat-color import, black-water preservation and import-size bound fix.
- Preserved editable JSON and optional Fext/DES reduced grid export.
- **Known limitations:** imported source dimensions may be reduced to <=5M pixels; full-quality image-first map model, native-quality generated geography, complete political variations and full-res export are planned, **not yet implemented**.

## Next

See [ROADMAP.md](ROADMAP.md) for M1–M6 milestones and acceptance criteria.
