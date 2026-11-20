# Map Fox Roadmap

> **Project continuity document — 17 November 2026**  
> **Current application version: 0.7.3 (development / pre-MVP).**  
> This document preserves decisions made during the initial Map Fox work and should be read before modifying the application in a new conversation or coding session.

## Product vision

Map Fox is a **standalone, browser-based political map generator and editor**—a lightweight, map-focused Photoshop for creating, importing, painting, refining, varying and exporting political maps. Most users may never run a simulation. **Do not make DES/Fext the center of Map Fox's user experience.** Fext integration is optional, downstream functionality.

**Critical rule: imported AND generated maps both follow the same image-first architecture.** The high-quality map is the master; working grids, previews, and simulation grids are derived representations. Do not let simulation constraints determine image quality.

## Non-negotiable product decisions

1. **Image-first for both generation and import.** An imported image retains its original source and full-resolution geography. A newly generated map creates full-quality geography of its own, not merely a stretched low-resolution grid.
2. **Preserve detail.** Never silently discard coastlines, tiny islands, waterways, colors or source resolution solely because a working-grid or simulation export has a cell limit.
3. **Independent representations.** Keep the master geography / land-water mask, political regions, editable working state and rendered presentation distinct. Reduced Fext grids are exports.
4. **Political variations are a core product feature.** Reroll territory layout and colors while keeping geographical silhouettes exactly fixed unless the user explicitly edits geography.
5. **The user interface stays simple.** Compact existing fox-and-star logo in the header; four actions on the left: **Generate, Import, Edit, Export**. One persistent large map workspace. Each action displays only relevant controls. No overwhelming parameter spreadsheet or nested-scroll maze. Advanced controls can be disclosed as needed.
6. **Editing feels like painting.** Mouse wheel zoom at cursor; drag with Move or Space/middle mouse to pan; eyedropper picks a real territory/region ID; brush with [ and ] resize; Ctrl+Z undo / Ctrl+Shift+Z redo; paint/fill must modify editable data, not just an overlay.
7. **Use the actual Goblin renderer for smooth presentation.** Port of `crates/goblin-vm/src/image.rs` `draw_onto`: Gaussian-weighted 5×5 class voting (sigma .7), margin-based edge antialiasing and optional 1.5px border. Rendering does **not** silently change map ownership or coastline cells. Different from algorithms that improve the underlying geography.
8. **Black-water flat-color import must be faithful.** The Everwind test map uses black for water, **not black political borders**. Do not infer black lines should be filled as land.
9. **Version continuity.** Current development version remains **0.7.3**, descended from original Map Spawner V7.2. Do **not** reset to v0.1. JSON schema `version: 6` is a separate backwards-compatibility detail.
10. **MIT license.** Respect the repository's existing LICENSE file.
11. **Future site navigation.** Reserve Home, Docs, Forum and Downloads links for when those pages exist; don't invent live URLs.

## Current baseline: 0.7.3 (what exists)

The checked-in `index.html` is the **working 0.7.3 application** with modular source under `src/`. The original 0.7.2 baseline is superseded. It contains:
- Standalone browser app, four-action workspace, light ivory/fox-orange color scheme, user-supplied fox logo;
- Seeded procedural generation and political regions; political seeds, island policies, provinces/subdivisions;
- Image import including clean flat-color recognition, black-water preservation and a size-bound fix;
- Editing with paint / eyedropper / fill / zoom / pan, brush resize and brush/fill undo/redo;
- Goblin-derived smoothed display and PNG rendering; editable JSON save/reopen;
- Reduced simulation-grid preview/export for Fext.

**0.7.3 completed in the first image-first foundation pass:**
- Imported PNG/JPEG/WebP source bytes, original dimensions, source background color and a baseline of the working grid are preserved in the versioned `map-fox-document` JSON wrapper.
- Native-size imported PNG export uses unchanged original pixels where possible; painted working-grid differences are projected onto the native source while retaining original water pixels unless geography is explicitly edited.
- Project save/reopen retains the native source and editable grid. Existing version-6 grid JSON remains readable.
- Both import and procedural generation now have master-document metadata, but the generated master is still a coarse grid and native-quality procedural geography remains a subsequent milestone.
- Tested: 2048×1469 Everwind exact-source round trip; 5200×2600 synthetic source uses a smaller working grid yet exports at original size, including a painted region edit after save/reopen.

**Important limitations—not solved yet**:
- The **working grid**, not the preserved source image, is still resized to a **5,000,000-cell** limit. Painting is applied at working-grid resolution and projected onto full-resolution export; this is not yet native-resolution brush editing or a fully tiled editor.
- Generated geometry is primarily based on a coarse discrete grid; high-fidelity generated master geography needs redesign.
- Native-resolution export now works on tested imports; very large canvases are limited by browser canvas/memory ceilings. A tile-based exporter is still needed for arbitrary source sizes.
- Political variation workflow and non-destructive layers are incomplete.
- Edit history currently covers painting/fill but not every command.
- Fext round-trip restoration against an original high-resolution coastline is **future** work.
- This baseline is pre-MVP, even if selected functional tests pass.

## Next engineering milestone — 0.7.4 (Stages A–C complete; Stages D–E planned)

**[Full implementation plan: native-resolution political ownership](docs/IMPLEMENTATION_0.7.4.md)**

The 0.7.3 editor retains and displays native imported source pixels, but political reroll and painting still derive from a smaller working grid. `regeneratePoliticalMap()` uses a planning grid capped at about 190,000 cells and then enlarges ownership; this explains the visibly stair-stepped regenerated nations. 0.7.4 will introduce a **native land/water mask and native political-owner tiles**, refine new borders at source resolution, and make reroll, editing, rendering, PNG export, and save/reopen use the **same authoritative native ownership**. Imported maps are the first end-to-end target; native-quality procedural geography remains the following milestone. Keep the current UI.

The implementation is divided into five testable changes in the linked plan. **Stages A–C are committed.** The 0.7.3-based development app now scans original imported pixels to build exact native geography, runs deterministic native political regeneration from its Regenerate button, renders the result using a shared native political compositor in preview and full-resolution PNG, and saves/reopens native version-2 projects. Browser integration tests cover these operations. **Stage D is next:** native painting/fill/Undo/Redo and the rest of the editing operations. Those legacy grid edits are currently guarded on native political variations, and Fext export is deliberately blocked rather than exporting stale political ownership. Stage E handles full packaging/performance. Native-quality procedurally generated geography is still later. Do not call 0.7.4 released.

## Roadmap: ordered milestones

### M1 — Master-map data model (partially implemented in 0.7.3)
- Introduce versioned **MapDocument**, separating `source`, `geography`, `politics`, `editor`, `render`, and `exports`.
- Retain original imported bytes or lossless image and exact native dimensions in the project; capture original land/water silhouette and native territory colors/IDs.
- Define **the same** master document for procedural generation. Generate native-quality geography and land mask, with optional preview/working tiles.
- Keep stable region identities independent of palette color and render scale.
- Make source/working/export resolutions explicit; never call an export/working dimension the "source" size.
- Persist and reopen the full document (design a schema evolution/migration path from existing version 6 JSON), with checksums/validation and tests.

**Acceptance:** Import high-resolution Everwind map or generate an equally high-quality master; save/reopen without sacrificing master coastline or dimensions.

### M2 — Resolution-independent editor and import
- Remove the 5M limit from **master storage**. If operations need a working limit, use tiling, background/offscreen workers, or level-of-detail previews.
- Clean import: exact flat-color recognition, water/background choice, preserve all legitimate territory colors and coastline pixels. Assisted import: optional grouping and user-adjustable detection; do not silently switch modes.
- Brush, eyedropper, fill, repair and undo work at the chosen working scale and project correctly to the master. No coordinate drift when zooming.
- Make changes non-destructive where practical; geometry editing and political ownership editing are separate.

**Acceptance:** 9201×6600 source can remain 9201×6600 while the interface remains responsive; small straits/islands and region IDs survive save/reopen.

### M3 — Native-quality procedural generation
- Change generated-map pipeline to create master-quality land/water geometry and political ownership, *not* 480×300 block shapes enlarged afterward.
- Support continents, long landmasses, archipelagos, independent island clusters and some unclaimed land.
- Keep seeding deterministic. Guarantee geography identical when rerolling only political states.
- Preserve high-quality coastlines with actual geometric resolution, not solely anti-aliasing of a coarse grid.

**Acceptance:** A fresh generated map can export a clean, large PNG comparable in quality to a high-resolution imported political map, without Fext involvement.

### M4 — Political variations
- Add clear **New variation** controls to regenerate political borders **without moving any coastline pixel**, with configurable region count, island policy and seed.
- Optional color reroll and naming, stable identity/labels where requested; save variations independently; preserve original as a revertible baseline.
- Batch alternative political maps, previews/compare and export; deterministic seeds.

**Acceptance:** Ten variations from the same imported/generated world share exactly the same land/water master silhouette but have distinct political boundaries.

### M5 — High-quality editor and outputs
- Native-resolution or selected-resolution PNG export, clean border rendering, Goblin-derived smoothing, optional image enhancement for low-res sources with clear user control.
- Better validation, export feedback, stable brush behavior, multi-operation undo, clear user-facing tool names and useful help.
- Keep four left actions; do not add a separate complicated "layers" home screen.

**Acceptance:** The common path—Generate/Import → Edit → Variation → Save/Export—works intuitively without using developer terminology.

### M6 — Fext bridge (optional / later)
- Derive a reduced DES grid only on export. **Outer land/water silhouette is strict**, to the fidelity possible at the target grid size; interior political boundaries may be simplified and evolve under Fext.
- When Fext returns updated ownership snapshots, Map Fox projects new regions onto the **preserved original high-res coastline**, smoothing internal borders at presentation resolution.
- Track matching coordinate transforms, region IDs, epoch metadata and import/export schemas.
- Never claim Fext can recover detail that was discarded; Map Fox reuses the original master mask it retained.

**Acceptance:** Simulate on a reduced grid, ingest a later Fext snapshot, and export a full-res political picture with the original coastline intact.

## Version 0.7.3 compatibility notes

- New project saves use `format: 'map-fox-document'`, `documentVersion: 1`, with nested `map` retaining existing `version: 6` grid schema.
- Opening old v6 grid JSON works; no original source pixels can be recovered from historical saves.
- Imported project JSON embeds the full source file as a data URL and is substantially larger; eventually replace this with a packed/binary project container.
- Reimport a clean/assisted image to adjust import settings after reopening; full resolution retained for export but the original editable importer raw buffer is not restored yet.

## Test fixtures & regression requirements

- **Everwind political map:** large PNG, black = water; distinguish water from black-looking dark *territory* edges only if actually present. Keep all flat-color regions without merging; preserve narrow channels and islands.
- **Large sources:** image >5M pixels and wide enough to stress import limits; no source loss.
- **Generated seeds:** repeatable geography/regions; political reroll does not mutate valid land/water cells.
- **Editor:** zoom/pan/eyedropper/brush [ ]/undo/redo; edits land on correct coordinates and persist.
- **Export:** transparent/black/blue-water as explicit presentation choices; PNG and JSON consistent; Fext only reduced after explicit request.
- **Regression:** schema-6 project reopen, region palette IDs, small island fidelity, no unexpected four-way border artifacts where supported.

## Implementation guidance for future sessions

1. Read `ROADMAP.md`, **`docs/IMPLEMENTATION_0.7.4.md`**, `docs/ARCHITECTURE.md` and `CHANGELOG.md` first.
2. Inspect **actual** repository source; do not infer features from a previous conversational description.
3. Make a small, testable change without discarding existing behavior. Keep the user-facing left-rail layout and actual brand asset.
4. For renderer work, verify against Goblin's `crates/goblin-vm/src/image.rs` and `sims/capstone/picture.gbln` before proposing a substitute.
5. Clearly distinguish **implemented now**, **planned**, and **verified in browser**; do not say "MVP complete" until acceptance cases pass.
6. Keep committed versions in Git and document changes in `CHANGELOG.md`; tag published versions if the repository toolchain supports tags.

## Adjacent products

- **Fext**: separate simulation engine using Goblin's Dynamic Entity System.
- **Goblin**: the programming language and VM.
- Map Fox can feed Fext, but Map Fox itself is a general-purpose map product.
