# Changelog

All notable changes to Map Fox will be recorded here. Version numbering is continuous with the former Map Spawner V7.2; **0.7.3 is the current development series**, not 0.1.

## [0.7.4 — in development] — 2026-11-19 (Stages A and B)

- Added isolated, testable native tile model in `src/native-map.mjs`: bit-packed exact geography, independent owner tiles, stable arbitrary IDs, sparse 256-pixel tiles, native RGBA classification and geography-preserving political replacement.
- Added an **opt-in** document version-2 codec in `src/master-map.mjs`, with native serialization, validation and explicit v1/v6 migration required status. The released 0.7.3 application still saves and displays legacy v1 data.
- Added new native tile tests, including tiny waterways, tile boundaries, 9201×6600 sparse dimensions, corrupted tile data, and version-2 project reopen. Updated standalone builder to include new modules.
- **Phase B native regeneration engine added:** `src/native-politics.mjs` samples the exact native land mask into a bounded political planning graph, calls the existing seeded region algorithm, and refines ownership **at each native land pixel** using a continuous, deterministic, smoothly displaced influence field. Original geography is copied bit-for-bit. Includes optional stable region ID table, island fallback, zero-region case, cancellation/progress and validation.
- Added nine native political tests, including deterministic rerolls, one-pixel straits/lakes, true within-planner-cell boundaries, a 9201×6600 sparse map and a dense 2048×1469 synthetic map; the existing `npm test` and standalone build pass.
- **Not shipped in the editor:** the Regenerate button still uses the old coarse-grid path. Preview/export integration (Stage C), native painting/Undo (Stage D), worker/packed project format (Stage E) are still pending. No visible version bump was made.

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
