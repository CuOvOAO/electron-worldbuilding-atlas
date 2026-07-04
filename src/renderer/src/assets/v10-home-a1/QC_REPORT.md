# Manuscript Atlas V10-A1 Home Asset QC Report

Baseline canvas: 1600 x 900 px

All PNG assets were generated as isolated single subjects on chroma-key backgrounds, then background-removed, cropped, resized, and saved with RGBA transparency. `desk-fabric-bg.webp` is the only opaque background asset.

| File | Final size | Format | Alpha channel | Single subject / no text / no extra part / no background | Raw generation size | Retries |
|---|---:|---|---|---|---:|---:|
| desk-fabric-bg.webp | 3200 x 1800 | WebP | No | Pass | 16:9 generated source | 0 |
| sidebar-base-home.png | 640 x 1704 | PNG | Yes | Pass | generated source | 0 |
| folder-base-home-center.png | 1688 x 1704 | PNG | Yes | Pass | 1614 x 975 | 1 |
| paper-main-home.png | 1520 x 1520 | PNG | Yes | Pass | generated source | 0 |
| quickadd-receipt-base.png | 600 x 1400 | PNG | Yes | Pass | generated source | 0 |
| world-identity-card.png | 560 x 250 | PNG | Yes | Pass | generated source | 0 |
| search-field-paper.png | 560 x 96 | PNG | Yes | Pass | generated source | 0 |
| nav-tab-base.png | 560 x 100 | PNG | Yes | Pass | generated source | 0 |
| utility-divider-strip.png | 560 x 52 | PNG | Yes | Pass | generated source | 0 |
| quickadd-row-base.png | 504 x 108 | PNG | Yes | Pass | generated source | 0 |
| note-decoration.png | 420 x 340 | PNG | Yes | Pass | generated source | 0 |
| paperclip-left.png | 192 x 344 | PNG | Yes | Pass | generated source | 0 |
| stamp-circle-neutral.png | 376 x 376 | PNG | Yes | Pass | generated source | 0 |
| star-chart-fine-overlay.png | 720 x 720 | PNG | Yes | Pass | generated source | 0 |

Automated checks:

| Check | Result |
|---|---|
| Expected file count | Pass, 14 assets present |
| Exact pixel dimensions | Pass |
| PNG RGBA alpha channel | Pass |
| Transparent PNG corners | Pass |
| Chroma-key green residue | Pass, 0 visible key pixels |
| Chroma-key magenta residue | Pass, 0 visible key pixels |
| WebP dimensions and format | Pass |

Manual visual checks:

| Check | Result |
|---|---|
| Single isolated component per image | Pass |
| No readable text, numbers, labels, logos, or watermarks | Pass |
| No UI buttons, icons, plus signs, search symbols, or navigation labels baked into assets | Pass |
| No asset sheet, collage, preview page, or multiple unrelated parts | Pass |
| Light parchment / low-contrast tone aligned to the supplied overview image | Pass |
