# Contributing and version workflow

Map Fox is under active development. Review [ROADMAP.md](../ROADMAP.md) before changing major architecture.

## Workflow

1. Branch from `main` for changes; use feature branches/PRs where possible.
2. Preserve the **current 0.7.2 version** until the owner explicitly approves the next version. Do not reset to 0.1.
3. Update `CHANGELOG.md` with changes, fixes, regressions and known issues.
4. Run the core generator tests and browser smoke tests; specifically verify imported high-resolution Everwind maps, generated maps, painting, saving, reopening and PNG/Fext exports.
5. Commit the complete app/source/docs to GitHub. Create a Git tag (for example `v0.7.2` once a publishable checkpoint is approved), and attach distributable standalone HTML and ZIP to a GitHub Release when available.
6. Don't merge unverified UI rewrites that discard existing capabilities. Treat app version and project JSON schema version as distinct.

## Release checklist

- [ ] App loads in a normal desktop browser without server setup.
- [ ] Generate works with seeded repeatability.
- [ ] Import preserves black water and color regions; size/fidelity limitations documented.
- [ ] Wheel zoom, pan, eyedropper, bracket brush sizes, undo/redo work.
- [ ] PNG export is visually inspected at output resolution.
- [ ] Editable JSON saves/reopens without changing ownership/color assignment.
- [ ] Fext export is optional and does not modify the editing master.
- [ ] No oversized logo, confusing nested scroll areas, or missing explanations.
- [ ] README/ROADMAP/CHANGELOG updated; release/version label verified.

## Project identity

Name: Map Fox. Version: 0.7.2. License: MIT. Logo: the owner's existing fox-and-star identity; no substituted artwork.
