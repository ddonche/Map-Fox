# Architecture notes (design target)

Map Fox is a high-quality *political map editing and generation* tool. Its format must work independently of Fext.

## Separate representations

```text
Imported image ---------------------┐
                                    v
Generated native geography ------> Master map
                                    |  source/native image; full-size coastline mask
                                    |  stable political-region identities
                                    |  provenance, seeds, dimensions
                    +---------------+----------------+
                    v                                v
             Editor / working view              Renderer
           tiles, LOD, brushes,             native-resolution PNG
           ownership and masks              and presentation styling
                    |
                    +----> On-demand reduced-grid export ----> Fext (optional)
                                                                   |
                                   later snapshot/ownership <------+
                                                |
                          reconstruct on ORIGINAL master coastline
```

### Master document

The **first version** of the `map-fox-document` wrapper is implemented in 0.7.3 in `src/master-map.mjs`. It stores `master` source dimensions and image bytes for imports, source palette and RLE baseline of editable working ownership, plus the legacy `map` grid. `src/native-export.mjs` composites edit differences onto original source pixels for native-size PNG output. Generated maps use the same wrapper but still produce a coarse-grid master. The model below remains a **longer-term target**, not the current serialized schema.

Proposed longer-term structure:

```json
{
  "documentVersion": 7,
  "appVersion": "0.7.3",
  "source": {
    "kind": "imported | generated",
    "nativeWidth": 0,
    "nativeHeight": 0,
    "sourceImage": "lossless image or linked asset",
    "seed": null
  },
  "geography": {
    "fullResolutionLandWaterMask": "raster/vector/tiles",
    "coastlines": "optional source contours"
  },
  "politics": {
    "stableRegionIds": [],
    "palette": [],
    "nativeOwnership": "raster/vector/tiles",
    "variations": []
  },
  "editor": {
    "view": {},
    "history": []
  },
  "render": {
    "smoothing": "Goblin-derived",
    "border": "#404040",
    "borderWidth": 1.5
  }
}
```

**This is an illustrative schema, NOT a serialized format to adopt without tests.** The current project JSON still uses `version: 6`; migration must be explicit. Storing full-res uncompressed arrays in JSON may be too expensive, so consider a manifest and chunked binary assets, ZIP-based project, or browser-backed file references with exportable packaging.

## Scale discipline

- Source dimensions: where the imported data came from or the native generated geography lives.
- Editor dimensions: working tiles/LOD and viewport; performance optimization, not source destruction.
- Render dimensions: requested output PNG pixels.
- Fext dimensions: explicit optional reduction; preserve land/water perimeter as faithfully as possible at selected grid size.

The 0.7.3 importer retains native source bytes, while the **editor working grid** is still capped at 5,000,000 cells. That working cap is a performance limitation, not a master-map limit. True native-resolution painting / tiling and full-quality procedural generation are later milestones.

## Native generation and variations

Procedural generation must start with native-quality land and water shapes (or a scalable equivalent), plus separately generated political ownership. Rerolling politics cannot mutate geography. Any smoothing applied only to the preview is not a replacement for detailed generated coastlines.

Political variants must be reproducible by seed; preserve each original geometry mask; color changes don't change region identity. Future batch generation should not destructively replace the original.

## Editing

Single map canvas + left rail: Generate / Import / Edit / Export. Contextual tools only. Input: wheel zoom toward cursor, Move/Space drag, pipette for region IDs, brush size [ ], Ctrl+Z and Redo. Undo history must be able to capture all editing operations eventually.

All paints/repairs must update underlying editable data. A cosmetic raster overlay that disappears on project reopen is not a valid edit.

## Rendering reference

Source of the implemented smoothing model:
- https://github.com/ddonche/goblin-lang/blob/jareth/crates/goblin-vm/src/image.rs (draw_onto)
- https://github.com/ddonche/goblin-lang/blob/jareth/sims/capstone/picture.gbln

The algorithm weights nearby cell colors with a Gaussian kernel (sigma 0.7), selects the strongest weighted class, calculates margin to runner-up, smooths the edge and optionally adds a 1.5-pixel outline. With a detailed mask, the exact source silhouette is preserved.

Do not confuse *appearance smoothing* with *actual geometry enhancement*. Also do not assume a 3000-cell export can generate high-quality coastlines on return without using the original master.

## Current baseline caveat

The checked-in `index.html` is the 0.7.2 working prototype, not the proposed full architecture. It still limits import size, uses a coarse generator, and exports reduced grids from current map arrays. Implement this architecture incrementally and measure quality with large Everwind imports and generated maps.
