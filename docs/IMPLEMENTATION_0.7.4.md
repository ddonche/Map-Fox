# Map Fox 0.7.4 — Native-Resolution Political Layer

**Status:** Stages A and B implemented/tested on `main` (native tile model + standalone political regeneration); Stages C–E **not implemented yet**. The visible app remains 0.7.3.  
**Prepared:** 2026-11-19  
**Baseline:** Map Fox 0.7.3, `main` branch.  
**Product direction:** Standalone image-first political map generator/editor. Fext remains an optional derived export.

## Stage A implementation record — 2026-11-19

**Done (foundation only):**

- `src/native-map.mjs` adds `NativeMap` with 256×256 bit-packed land/water mask tiles, independent 16-bit political owner tiles, arbitrary stable external region IDs via a dense-index lookup table, explicit geography writes, and water-safe political writes.
- Supports exact RGBA flat-color classification into native masks with explicit color-to-region mapping (unknown colors remain unclaimed), plus creating a native **representation of existing coarse generated maps** without pretending that the generated geography is newly high resolution.
- Supports clone, exact geography equality, geography-preserving political replacement, and serialized tile roundtrips (base64 bitmask, RLE or raw 16-bit ownership; missing tiles represent water).
- `src/master-map.mjs` now has opt-in `saveNativeProjectDocument`/`loadNativeProjectDocument` for version-2 native project data. Existing `loadProjectDocument` remains v1 and the shipping 0.7.3 app still saves v1. The new loader distinguishes v6/v1 projects as `requiresNativeMigration`; it does **not** synthesize false native data.
- `npm test` executes `tests/native-map.test.mjs` (water channels, lakes, tile boundaries, stable IDs, corrupt tiles, sparse 9201×6600 dimensions, and native project roundtrip). Standalone builder includes native-map source without changing the UI.
- **No new visible political regeneration or native painting in the app yet.** The current reroll still uses the working grid. The next engineering task is Stage B, native political regeneration.

**Stage A deliberately does not yet provide** a full 9201×6600 native import pipeline with worker-based tiling, region ownership regeneration, compressed project container, or runtime map/UI integration. Those remain in Stages B–E.

## Phase B implementation record — 2026-11-19

**Done (independent regeneration engine; not wired into editor yet):**

- Added `src/native-politics.mjs` with `regenerateNativePolitics(nativeMap, options)` and `sampleNativePlanningMask()`.
- Reuses the existing deterministic `growRegions()` planner on a bounded, **area-sampled** land mask, then constructs a **distinct native-resolution owner tile for every source land pixel**.
- Replaces 0.7.3's nearest-neighbor upscaling with a **continuous seeded influence field**, refined with multiscale smooth displacement and weighted neighbor voting in native coordinates. It writes actual owner values, not a blur or display-only interpolation.
- Any coast, lake, strait or small island in the original `NativeMap` is copied bit-for-bit. Planner-omitted tiny islands are not erased: the native land retains a deterministic nearest-owner/unclaimed fallback, according to the planned political ownership.
- Supports 0–100 regions, optional external stable region IDs, island policies, seeded determinism, explicit unclaimed land, progress callbacks and cancellation. The operation returns a new map and **never mutates the input**.
- Added `tests/native-politics.test.mjs`. Tests include exact 1-pixel water features, mask identity, two seeds, same-seed byte equality, arbitrary IDs, output borders inside planner-cell rectangles, zero-region map, cancellation, malformed options, a sparse 9201×6600 map and a **dense synthetic 2048×1469 map**. CI run recorded **219 ms** for the dense synthetic sample; it is **not** an Everwind-world benchmark or a guaranteed runtime.
- Registered these tests in `npm test` and included `src/native-politics.mjs` in the standalone build. GitHub CI was green.
- **No UI claim:** `src/app.mjs` still calls the 0.7.3 `regeneratePoliticalMap()` for the Regenerate button, and `src/native-preview.mjs`/`src/native-export.mjs` still show working-grid edits. Phase C is needed before the native political result is visible or exportable.

**Next:** Stage C — make the native political layer authoritative in preview and PNG export, and connect the regeneration path with a safe transition. Stage D will make painting, eyedropper, fill and Undo/Redo operate on the same native tiles.

## The bug this milestone addresses

On the imported Everwind map, the native source image is sharp but clicking **Regenerate political boundaries** produces conspicuous blocky shapes, breaks visual continuity, and can expose mixed old/new political coloring.

This is caused by the **data path**, not the browser's canvas smoothing:

- `src/spawner.mjs:regeneratePoliticalMap()` shrinks its geography to a **maximum 190,000-cell planning grid** (`maxPlanningCells=190000`). It assigns planning labels and expands them by nearest coarse cell to the larger **working grid** (typically about 5 million cells), with some fallback ownership.
- `src/native-preview.mjs` projects those working ownership cells onto the original full-resolution image. Its native preview is high-resolution, **but its political edits aren't**.
- `src/native-export.mjs` also projects the working grid onto native pixels. Changing the rendering filter alone cannot fix the political shape.
- `src/master-map.mjs` stores the original image plus a working-grid RLE baseline. There is **no authoritative native political-ownership layer**.
- `src/app.mjs` paint history currently stores grid-index changes; it does not record native brush edits or a native political variation.

**Requirement:** Do not solve this by simply hiding jagged edges with blur, nearest-neighbor interpolation, enlarged export dimensions, or reusing original political colors. The native political layer must actually exist.

## 0.7.4 scope and release boundary

**Ship in 0.7.4:**
1. Imported map gets an exact native-resolution land/water mask and a separate authoritative native-resolution ownership layer.
2. Regeneration writes a genuinely high-resolution political layer, with reproducible boundaries, respecting the exact shoreline and island semantics.
3. Zoom/pan preview, eyedropper, paint, fill, undo/redo, save/reopen and native PNG export read/write that single ownership layer.
4. Preserve the existing four-action UI (Generate / Import / Edit / Export), existing import modes, browser-only operation and Fext compatibility.
5. Add regression/performance tests for actual Everwind source and 9201 × 6600 images.
6. Upgrade documentation and retain the ability to open existing legacy projects.

**Subsequent milestone:** Native-detail procedural **geography generation**. 0.7.4 must use the **same native-map interfaces** for generated projects but should not quietly claim the existing coarse geography generator has been upgraded. That remains separately tracked work (provisionally 0.7.5). Generating a map on a 480 × 300 grid and enlarging it is not acceptable as the final high-resolution-generator solution.

## Invariants — must not be broken

1. **Geography is authoritative and separate.** If political reroll is requested, for every native pixel `i`, `waterMaskAfter[i] === waterMaskBefore[i]`. This includes every black water pixel, tiny stream, enclosed water area and island in the Everwind source. Black is **water** in that particular map, not a political-border hint.
2. **Every native land pixel** has an ownership value (region or explicitly unclaimed); water pixels never acquire an owner. The land mask cannot be changed by political-only tools. A geography-edit tool is an explicit separate operation.
3. **Single political truth.** Preview, export, color lookup, brush, flood fill and variation snapshots must derive from the native owner layer. A reduced working grid is cache/LOD data, not a second truth.
4. **No original-image color leakage after reroll.** Once political ownership changes, render all native land pixels from the **current** native owner layer and palette; retain original **water** pixels and coastline detail. Do not reveal obsolete original territory colors or jagged partial patches.
5. **Region identity != color.** Nonconsecutive arbitrary region IDs and names survive remaps; palette rerolls must not change ownership.
6. **Reproducible.** Same master geography, policy, region count, seed and implementation version produce the same native ownership (not merely a visually similar image).
7. **Backward compatibility.** Read historical grid `version:6` and 0.7.3 `map-fox-document` (`documentVersion:1`). Do not misrepresent an old grid-only project as having native ownership; migration must be explicit and validated.
8. **No hidden performance cliff.** Work at full native resolution without doing a large all-map canvas `getImageData` / graph search on the UI thread for every redraw.

## Proposed data model

Refactor `src/master-map.mjs` to own a new versioned document and introduce `src/native-map.mjs`.

```js
// Conceptual, NOT the final serialized API.
MapDocument {
  documentVersion: 2,
  appVersion: '0.7.4',
  source: {
    kind: 'imported' | 'generated' | 'legacy-grid',
    originalImage: BlobOrAssetRef, // original lossless source, retained unchanged
    nativeWidth: 9201,
    nativeHeight: 6600,
    seed: null
  },
  geography: {
    tileSize: 256,
    nativeWaterMask: TileStore<BitMask>,   // exact source geometry
    coastlineRevision: number
  },
  politics: {
    regionIdTable: [/* stable map region IDs */],
    nativeOwner: TileStore<Uint16>,        // index into regionIdTable; 65535 = unclaimed land
    palette: [/* IDs, names, colors */],
    revision: number,
    variationSeed: string
  },
  editor: { zoom: number, offset: [number, number], undo: [] },
  working: { /* optional cached downsample / planning data only */ }
}
```

Water is controlled by `nativeWaterMask` only; owner values on water are ignored and must be normalized. `Uint16` stores **dense palette indices** rather than assuming external region IDs fit within 65534. This preserves the existing arbitrary/nonconsecutive IDs. If the number of regions ever exceeds the code range, switch the tile encoding or explicitly reject with a clear message. **Unclaimed land** uses sentinel 65535, distinct from water.

### Memory and storage discipline

At 9201 × 6600, there are **60,726,600 native pixels**. A naive full-size `Uint8Array` geography mask costs about 61 MB; a full-size `Uint16Array` ownership plane costs about 121 MB; an uncompressed RGBA canvas costs about 243 MB before the source bitmap and history. Duplicated canvases/history can overwhelm typical browsers.

Therefore:
- Use **256 × 256 tiles** for water and ownership, and only decode/cache the visible tiles and nearby halos during editing. A bit-packed geometry tile costs 8 KiB, while a `Uint16` owner tile is 128 KiB before compression.
- Persist lossless/compressed binary tile assets in a project container (`.mapfox` ZIP or equivalent) with a versioned manifest and the original image. Browser-only ZIP packaging may use a small vetted library; avoid introducing a server requirement.
- Cache/LOD views can be rebuilt. Do not persist enormous JSON arrays or append one entire 60-million-cell snapshot per Undo step.
- Handle import/regen/export in Web Workers and report progress/cancellation. Keep the visible viewport responsive; canceling should leave the previous valid map intact.
- Rendering/export should stream tiles or image strips; do not require holding both full native RGBA export and multiple full-resolution owner arrays simultaneously.
- Benchmark performance and memory in Chromium on Everwind and the 9201 × 6600 fixture. Measure rather than promising an untested time budget.

## Native political regeneration algorithm

**Avoid brute-force `growRegions()` over 60.7 million cells on the UI thread.** Keep the good parts of the existing seeded landmass/region algorithms while making **the high-resolution result authoritative**.

Proposed staged, testable implementation:

1. **Source classification:** Build the exact source-resolution water mask from native pixels and explicit user background selection. Do not change water to land to eliminate 'stray' black lines. Preserve tiny components, narrow straits and coastal holes. For anti-aliased input, user-adjustable classification is separate from Clean/exact mode.
2. **Macro political planning:** Retain the existing deterministic `growRegions()` island policies and seed logic to plan approximate territory distribution on a manageable graph. *The plan is not the final ownership raster.* Handle native islands too small to appear on the planning grid in a dedicated native component pass.
3. **Boundary refinement:** Form shared boundaries between neighboring planned regions (marching squares / dual contour or equivalent). Smooth them as **continuous native-coordinate curves**, optionally add bounded seed-driven natural irregularity at multiple native scales, and clip all evaluations to the exact water mask. Connected regions and preserved archipelago assignments must not be silently broken. Perturbation cannot move coastlines.
4. **High-resolution owner assignment:** Rasterize and/or flood the resulting region partitions to native **land pixels**, tile by tile with an overlap/halo. Deterministically resolve ties and ensure each pixel is exactly one region or explicitly unclaimed. A border shared by A and B is computed once, not independently by both regions.
5. **Validation and commit:** Check native land/water checksum unchanged, ownership coverage, region identity count, topology and absence of inadvertent holes/overlaps. Only then atomically swap current native political layer with the new one.
6. **Alternative implementation allowed:** A multi-scale signed-distance/influence-field renderer is acceptable instead of explicit contours **only if** it writes an actual native owner layer with smooth boundaries, passes topology/mask tests, and does not simply nearest-neighbor upscale coarse cells.

The exact smoothing approach should be selected after an isolated test that compares the pixel-space boundary quality and execution cost. The existing **Goblin `write_png!` renderer is a presentation pass**; don't confuse that with political ownership generation.

### Geography/province semantics

- Native connected-components processing identifies small landmasses ignored by planning. Give those islands a seeded deterministic owner from existing independent-island / nearby-ownership / unclaimed policies.
- Unassigned should be deliberate, not caused by `planningMask` holes or fallback ownership.
- Respect the existing 0–100 initial political region-count UI range, or change it separately with validation.
- The original geography survives color rerolls, nation rerolls, undo, redo and reimport.
- Preserve the existing avoidance of ambiguous four-way political junctions where feasible; at minimum detect/report them in tests.

## Editing: same native pixels as rendering

Replace the imported-map use of `current.layers.regions` as source of truth with a native document API. Convert pointer locations to **native** (x, y) through one inverse viewport transform; use it for eyedropper, brush, fill and canvas tooltips.

- **Eyedropper:** returns stable region ID from native ownership; water indicated by native mask.
- **Brush:** [ and ] resize; define sizes in *native pixels* (or clear map-scale units) so brush doesn't suddenly become 17× larger when the working grid changes. Brush edits owner tiles only unless user expressly selects geography edit.
- **Fill:** native ownership connected-component flood, with water as barrier; use worker/tiles for large fill.
- **Undo/Redo:** record changed native tile runs or inverse stroke deltas; one stroke = one history action. Recolor/reroll should create a reversible political-layer transaction. No 40 full-resolution snapshots.
- **Move/zoom:** wheel and Space/middle drag as today, with no change to geography.
- **Preview invalidation:** invalidate only changed tiles and neighborhood; avoid full decode and full ownership array scans on every mouse move.

Give regenerated map a reversible **Restore previous map** action; do not silently discard a hand-painted variant.

## Single rendering pipeline

Extract a shared compositing primitive, e.g. `renderNativeTile(document, tileX, tileY, options)`:
- Read exact native water mask and original water appearance (black, blue or transparent based on *view/export setting*).
- Color each native land pixel from its **current** owner and palette; preserve unclaimed-land presentation.
- Draw political borders from ownership transitions at native resolution (optional border style and Goblin-derived antialiasing). Never use the original source's old color boundaries after a reroll.
- The **viewport** and **PNG export** must call the same compositing function with consistent output options; rendering at different zooms must not change ownership.
- Allow hiding/showing geography and political layer presentation without modifying map data.

For a no-change imported-map presentation, an exact original-pixels mode may remain available. After any political reroll, the entire land layer is re-rendered from current ownership to avoid source color bleed-through.

## Saving, reopening and migrations

1. Keep reading `version: 6` grid-only projects as legacy and 0.7.3 `map-fox-document` version 1.
2. Write document version 2 with immutable source bytes, exact native mask tiles, native owner tiles, palette and seeds, checksums/version stamps. Prefer `.mapfox` ZIP/packed container to huge embedded-base64 JSON.
3. On loading a v1 project, **do not invent a 'true' native political ownership map from the reduced grid without telling the user**. Offer a one-time native reconstruction from the original source image, preserving the source and allowing comparison/rollback.
4. Always save the current variation and original baseline without losing source fidelity.
5. Test interrupted saves, corrupt tile metadata, mismatched dimensions, missing source image, and unsupported future versions.

## Source files to modify

| File | Responsibility |
|---|---|
| `src/master-map.mjs` | Version 2 document schema, migration, native/source/working separation |
| `src/native-map.mjs` **(new)** | Native land mask, owner tiles, region ID table, read/write transactions |
| `src/native-politics.mjs` **(new)** | Political planning-to-native ownership, deterministic boundary refinement, island assignment |
| `src/native-preview.mjs` | Replace working-grid projection with tile compositing from native ownership |
| `src/native-export.mjs` | Use exactly the same native compositing path as preview |
| `src/app.mjs` | Route regenerate, brush, eyedropper, fill, undo/redo and save/reopen through native document API |
| `src/spawner.mjs` | Keep reusable planning algorithms; stop treating nearest-coarse result as native truth |
| `src/importer.mjs` | Produce exact native land mask and stable source color-region mapping |
| `src/renderer.mjs` | Presentation smoothing / shared renderer integration, not geography generation |
| `src/native-worker.mjs` **(new)** | Responsive regeneration and large fills with cancellation |
| `tests/*` | Native-region, mask, high-res browser, migration, determinism and performance tests |
| `scripts/build-standalone.py` | Bundle all new modules/workers/assets into offline distribution |
| `index.html` and `styles/app.css` | Minimal state/progress UI only; preserve four-action workspace |

**Important build risk:** The current standalone builder concatenates ES modules and strips certain imports/exports. Dedicated Web Workers and binary ZIP assets will require explicitly compatible bundling/inline-worker support for the offline build. Test the GitHub Pages module app **and** the single-file distribution; don't make a worker work in one and silently break in the other.

## Incremental implementation order / pull requests

1. **PR A — Native document & tiles:** introduce testable native geometry and ownership APIs, project migration scaffold; existing UI behavior unchanged. Test exact water mask and project roundtrip.
2. **PR B — Regeneration engine (completed):** plan broadly, refine at native scale, assign tiny-island fallback ownership, validate and return a new immutable-by-contract native result. Progress/cancel callbacks are present. **UI progress button/apply wiring waits for Stage C**. Tests cover smooth high-res boundaries and exact geography.
3. **PR C — Renderer + export:** unify viewport and native PNG compositing from authoritative tiles; eliminate old-image territorial color leakage. Pixel-perfect preview/export consistency tests.
4. **PR D — Editing:** native eyedropper, brush, fill, Undo/Redo and efficient dirty-tile rendering. Stress test at zoom and narrow straits.
5. **PR E — Packaging / migration / performance:** .mapfox save/reopen, legacy loading, standalone worker packaging, benchmarks, documentation, final release checklist.

Each PR must leave `main` buildable and retain the working 0.7.3 experience until the new native path passes regression. Use a feature flag or internal switch during migration; do not merge a partially connected data model that corrupts existing projects.

## Acceptance / regression tests

**Fixtures:** actual Everwind 2048 × 1469 and high-res 9201 × 6600 source; plus test maps with 1-pixel water straits, tiny landmasses, enclosed lakes, nonconsecutive region IDs and multiple terrain colors.

- **Exact geography:** SHA-256 / bitset equality of native water mask before and after 10 seeded political rerolls, color rerolls, Undo/Redo and save/reopen.
- **Real native politics:** ownership output dimensions match original source; new boundaries have smooth native-scale contours and do **not** consist of repeated 10–20-pixel rectangular steps copied from the working grid.
- **Coverage:** every native land pixel assigned or deliberately unclaimed; no water becomes owned; no accidental unassigned holes along region boundaries.
- **Island policy:** tiny islands and narrow straits retained; a region does not jump water because of a low-res planning-cell fallback unless the island ownership policy explicitly assigns it.
- **Determinism:** same seed produces byte-identical owner tiles; different seed yields a distinct political map, same geography.
- **Render parity:** at 1:1 native detail, the viewport and PNG show the same owner colors and boundary coordinates, with the same border settings.
- **No old-color leakage:** rerolled map pixels must show only current palette colors (plus expected anti-aliasing/water/unclaimed styling), never patches from superseded political coloring.
- **Editor:** zoom/drag + eyedropper, [ ] brush, fill, Ctrl+Z/Ctrl+Y, save/reopen; repeat on 9201×6600 with edits crossing tile boundaries.
- **Performance:** UI stays interactive during regeneration; worker offers cancel; large-map memory does not grow unbounded across 10 rerolls or 40 strokes. Record measured time/peak memory instead of inventing pass thresholds before benchmarking.
- **Compatibility:** schema-v6 and document-v1 files still load; migrated v1 project visibly distinguishes reconstructed native politics from the preserved source.
- **CI:** `npm test` and `npm run build` pass; test GitHub Pages ES modules and offline standalone HTML.

## Definition of done

A user can import Everwind, click **Regenerate political boundaries**, see **native-detail** political boundaries with every coastline/water pixel preserved, zoom and paint without block-size artifacts, Undo the changes, save/reopen the native political map, and export a full-native-resolution PNG that matches the viewport. No hidden low-res ownership projection remains for imported maps.

**Deferred deliberately:** native-detail procedural **geography** generation, multi-variation gallery, and Fext round trip; they use this same document/renderer foundation in later milestones.

## Session restart note

Read this document, `ROADMAP.md`, `docs/ARCHITECTURE.md`, and the current branch before implementation. The code and constraints above were taken from the actual 0.7.3 repository; if line numbers or functions change, use the current source. Avoid changing the established Map Fox header/logo, left rail, and painting interaction model.
