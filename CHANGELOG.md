# Changelog

All notable changes to Map Fox will be recorded here. Version numbering is continuous with the former Map Spawner V7.2; **0.7.3 is the current development series**, not 0.1.

## [0.7.3] — 2026-11-18 (image-first foundation)

- **Native-quality viewport correction:** Imported political maps now display the full-resolution original image when viewing political regions, even when the editable working grid is smaller. Zoom/pan samples native-source pixels rather than magnifying the working cells; painted territory/geometry changes are overlaid on the original, and Undo remains functional. Other grid display layers retain their existing rendering.
- Verified in-browser on Everwind and a 9201 × 6600 test image. Native-resolution source preservation was already present in project JSON/PNG export but previously missing from the editor display.

- Added `src/master-map.mjs` with versioned `map-fox-document` project wrapper; native source-image bytes/dimensions and a compressed baseline of imported working ownership are retained alongside the editable grid.
- Added `src/native-export.mjs` for original-resolution PNG output from imported maps. Unmodified source pixels remain intact, and working-grid territory edits are projected onto the native source while retaining untouched water channels.
- Imported project save/reopen retains full source bytes; old schema-v6 JSON remains loadable.
- Added master resolution to the UI and updated the Export action; source image pixels are no longer discarded when the importer must downsize its working grid.
- Tests cover the document model and native-size browser export on Everwind (2048×1469) and a larger 5200×2600 synthetic political map with painted changes and save/reopen.
- **Still planned:** detailed high-resolution procedural geography, native-resolution painting and tiled processing, rich political variations, arbitrary huge-canvas export, Fext round trip. Generated maps currently still use coarse-grid geometry.

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
