<p align="center">
  <img src="assets/map-fox-logo-dark.png" alt="Map Fox" width="350">
</p>

# Map Fox

**Map Fox** is a browser-based political map generator and editor for creating, importing, refining, and exporting maps and alternate political layouts.

**Visible app version: 0.7.3** · **0.7.4 development: Phases A–C integrated** · **License: MIT** · **Status: pre-MVP**

## Try the app

**[Open Map Fox in your browser](https://ddonche.github.io/Map-Fox/)** *(GitHub Pages must first be enabled for this repository; until then, download and open [index.html](index.html) directly.)*

The repository contains the maintainable source modules in `src/`, a stylesheet in `styles/`, and the `assets/` directory. Because `index.html` imports ES modules, run it through a static server (for example `python -m http.server 8000`, then visit `http://localhost:8000`) or enable GitHub Pages. For an offline single-file download, run `npm run build` and open `dist/Map_Fox_0.7.3_Standalone.html`. No backend is needed.

## Main actions

- **Generate:** Procedurally create a map with seeded landmasses, islands and political territories.
- **Import:** Convert a flat-color political map into editable geography and regions.
- **Edit:** Zoom/pan, eyedropper, paint, fill, undo/redo, recolor, and manage political areas.
- **Export:** Download PNG or editable JSON; optionally export a reduced grid to **Fext**, the separate Goblin simulation engine.

## The direction we're building

**Map Fox is image-first.** Imported maps must retain their full native-resolution geographic source, and **generated maps must also create high-quality master geography**. Preview/editing resolution and optional simulation-grid resolution are derived outputs and must not degrade the master map. Geography and political regions are separate, so users can generate political variations while keeping coastlines fixed.

This is the design target, **not all implemented yet**: version 0.7.3 still contains coarse-grid generation and a legacy maximum of 5 million working/import cells. The roadmap spells out the implementation steps and acceptance tests.

**Start here for future work:**

- **[ROADMAP.md](ROADMAP.md)** — product decisions, milestone priorities, acceptance criteria and conversation continuity
- **[0.7.4 Native Politics Implementation](docs/IMPLEMENTATION_0.7.4.md)** — Phases A–C built; Phase D native editing and Phase E packaging/performance remain
- **[Architecture](docs/ARCHITECTURE.md)** — source/master/editor/render/Fext separation
- **[Changelog](CHANGELOG.md)** — implemented version history and current limitations
- **[Release process](docs/RELEASE_PROCESS.md)** — how to publish subsequent versions

## Project identity and UI

The current UI uses the owner's original fox logo and light ivory/fox-orange theme. The interface keeps four primary actions in a **left navigation rail** with one persistent map canvas. Future public website links will be Home, Docs, Forum and Downloads when those pages exist.

## Technical notes

- Editable Map Fox project JSON now uses a `map-fox-document` wrapper with the native source image (for imported maps) and a nested backwards-compatible grid `version: 6`. Old version-6 project files still reopen, but cannot restore source pixels that were never saved.
- Preview smoothing is based on Goblin's `write_png!` implementation: [Goblin image renderer](https://github.com/ddonche/goblin-lang/blob/jareth/crates/goblin-vm/src/image.rs).
- New maps saved in 0.7.3 include an embedded source image, which makes project JSON files considerably larger. Native-resolution export presently uses the original pixels and overlays working-grid edits; a fully resolution-independent editor is still planned.
- The optional Fext export should preserve the outside land/water silhouette as faithfully as its chosen reduced grid permits; internal political ownership may be simplified. Future Fext-returned maps can be rendered on the saved full-resolution coastline.
- The project is licensed under the [MIT License](LICENSE).
