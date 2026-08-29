# Pole-Zero Editor Tab — Design Spec

Date: 2026-08-27

## Purpose

Add a second tab to the Linear System Response Explorer: an interactive
pole-zero editor. The instructor (or a student) clicks to place poles and
zeros anywhere in the s-plane; the app derives the corresponding transfer
function and plots its step response live. This is a different learning
mode than the existing tab — instead of typing coefficients and seeing
poles/zeros as a read-only diagnostic, the user builds a system geometrically
and sees the resulting math and response.

## Hard constraint

**The existing tab's behavior, markup, styles, and backend endpoints must
not change.** Every element ID, CSS class, JS function, and API contract
described in the prior spec
(`docs/superpowers/specs/2026-08-19-linear-system-response-explorer-design.md`)
and built across the subsequent incremental features (amplitude, visual
redesign, component decomposition, stability classification, static
pole-zero map, bold s-plane axes) stays exactly as it is. This feature is
purely additive: a new tab, new files, and edits that only add to (never
remove or repurpose) `templates/index.html` and `static/style.css`.
`app.py` and `test_app.py` are not modified at all — the new tab reuses the
existing `/api/response` endpoint unchanged.

## Non-goals

- No new backend endpoint. Root→coefficient conversion happens client-side.
- No metrics panel, decomposition plot, or stability badge in the new tab —
  just the editor canvas, the derived transfer function, and the step
  response curve (per explicit direction: keep it focused).
- No dragging placed points (click-to-place / select / delete only — see
  Interaction below). No pan/zoom on the editor canvas; the coordinate
  range is fixed.
- No persistence — the editor's poles/zeros reset on page reload, same as
  every other input in the app today.
- No support for placing more than one point at the exact same location
  (not specifically prevented, but not a designed-for case); overlapping
  markers are a display detail, not a correctness concern (the math is
  still correct — repeated roots just multiply out to a higher-order
  factor).

## Architecture

Two tab panels in the same page, toggled client-side (no reload, no new
Flask routes):

- **Explorer tab** — the existing content, moved into its own `<section
  id="tab-panel-explorer">` wrapper but otherwise byte-for-byte unchanged.
- **Editor tab** — new `<section id="tab-panel-editor">`: an SVG canvas for
  placing poles/zeros, a gain (K) input, a transfer-function fraction
  display (reusing the same visual component as the Explorer tab), an
  error banner, and a step-response chart.

A tab-nav bar (two buttons, `role="tablist"`) sits above both panels and
toggles a `hidden` class on each panel — the same hide/show pattern already
used for conditional UI elsewhere in the app (e.g. the decomposition card).

New static assets:

- `static/chart-utils.js` — `cssVar()` and `chartAxis()`, extracted
  verbatim from `static/app.js` (no behavior change) so both tabs' scripts
  can share them without duplication. `app.js` is updated to call these
  instead of its own copies; every other line of `app.js` is untouched.
- `static/pole-zero-editor.js` — all new logic for the Editor tab: SVG
  rendering, click/select/delete interaction, polynomial-from-roots math,
  fetching `/api/response`, and rendering the transfer-function fraction
  and step-response chart for this tab.

`templates/index.html` gains the tab-nav markup and the new Editor
`<section>`, plus two new `<script>` tags (`chart-utils.js` before
`app.js`, and `pole-zero-editor.js` after it). The existing Explorer
`<section>`'s inner markup is unchanged — it is only wrapped in a new outer
`<section id="tab-panel-explorer">` for the tab-toggle to target.

`static/style.css` gains new rules for the tab nav, the SVG canvas, and the
editor's controls — appended, not modified. Existing selectors (`.card`,
`.controls`, `.tf-preview`, `.error-banner`, etc.) are reused as-is by the
new markup wherever they already fit (the tab-nav and canvas are the only
genuinely new visual elements).

## Component: the SVG pole-zero canvas

A hand-built SVG widget rather than a Plotly chart — Plotly's click events
are designed around clicking existing rendered points, not placing new
points at arbitrary empty-canvas coordinates, so it's the wrong tool for
this specific interaction.

- **Coordinate range:** fixed at Real ∈ [−6, 6], Imaginary ∈ [−6, 6], equal
  aspect ratio, `viewBox="0 0 480 480"` (40 pixels per data unit). No
  pan/zoom.
- **Axes:** bold real and imaginary axis lines through the origin (visually
  consistent with the "bold axes" treatment already applied to the static
  pole-zero map's Real/Imaginary axes), plus lighter gridlines at integer
  intervals for a sense of scale.
- **Coordinate mapping:** `dataToPixel(re, im)` / `pixelToData(px, py)`
  helper functions convert between the fixed data range and the SVG's
  pixel/viewBox space.
- **Placement mode:** a two-button toggle ("Place pole" / "Place zero",
  visually matching the existing Step/Impulse toggle) controls what a
  canvas click places. Default: "Place pole".
- **Markers:** reuse the same visual language as the static pole-zero map
  — poles as `×`, zeros as `○`, poles in the critical/red token, zeros in
  the accent/blue token — so a student who's seen the Explorer tab
  recognizes the convention immediately. Each marker is drawn at a fixed
  13px radius (matching the static pole-zero map's marker size), with a
  transparent hit-circle of 16px radius layered on top to make clicking
  an existing marker reliable (bigger than the visible mark, per the
  general "hit target bigger than the mark" rule already followed
  elsewhere in this app's charts).
- **Click on empty canvas space** (i.e. the click's pixel coordinate falls
  outside every marker's 16px hit-circle): places a point of the current
  mode at the clicked location.
  - If the click's imaginary-axis data coordinate has magnitude < 0.15
    (i.e. |Im| < 0.15 in the fixed [−6, 6] data range), it snaps to the
    real axis (Im = 0 exactly) and places a single real point.
  - Otherwise, it places the clicked point *and* its mirror image
    (reflected across the real axis) as one linked conjugate pair — two
    markers that are always added, selected, and removed together.
- **Click on an existing marker** (inside its 16px hit-circle): selects it
  (and its conjugate partner, if any) — shown by drawing an additional
  larger unfilled circle (radius 18px, stroke = `var(--ink-primary)`,
  stroke-width 2) centered on each selected marker. Selecting a new point
  replaces the previous selection (single-selection only). If two
  markers' hit-circles overlap at the click point, the nearest marker's
  center wins.
- **"Delete selected" button:** enabled only when something is selected;
  removes the selected point (and its conjugate partner, if paired).
- **"Clear all" button:** removes every placed pole and zero (always
  enabled).

## Deriving the transfer function

Every placed point is either a single real root (contributes a linear
factor `(s − p)`, real coefficients by construction) or an auto-mirrored
conjugate pair (contributes a quadratic factor `s² − 2a·s + (a² + b²)` for
a pair at `a ± bi`, also real by construction). The full numerator and
denominator polynomials are built by multiplying these real linear/
quadratic factors together via plain real-coefficient polynomial
multiplication (repeated convolution) — no complex-number arithmetic is
needed anywhere in this feature.

```
numerator(s)   = K · ∏ (real/quadratic factors from placed zeros)
denominator(s) = ∏ (real/quadratic factors from placed poles)
```

Zero poles placed → denominator is `[1]` (constant). Zero zeros placed →
numerator is `[K]`. Both are valid, simulable transfer functions.

This conversion is implemented once in `pole-zero-editor.js` and its
correctness is checked directly (e.g. via a quick Node run against known
cases — a single real pole, a conjugate pair, a mix of both) before it's
wired into the page, the same verification approach already used for the
transfer-function fraction formatter.

## Data flow

1. Editor tab loads with a default conjugate pole pair already placed at
   `−0.5 ± 1.94i` (the Explorer tab's Underdamped preset's pole locations,
   rounded to 2 decimals) and no zeros, so there's something to see
   immediately; gain K = 1. The Explorer tab is the active/visible tab on
   page load, matching current behavior — the Editor tab is available but
   not shown until its tab button is clicked.
2. Every change (place, delete, clear, gain edit) recomputes numerator/
   denominator coefficients client-side, then POSTs
   `{num, den, response_type: "step", amplitude: 1}` to the existing
   `/api/response` endpoint (unchanged contract).
3. On success: render the returned `time`/`values` as a step-response line
   chart (reusing `chartAxis()` from `chart-utils.js`, same visual style as
   the Explorer tab's response chart) and update the G(s) fraction display
   using the same fraction-rendering approach as the Explorer tab.
4. On error — in practice this construction method can only ever produce
   one reachable backend error: more zeros placed than poles (numerator
   order > denominator order → the existing "must be proper" rejection).
   Every other coefficient list this tab can generate is well-formed by
   construction (each linear/quadratic factor has a nonzero leading term,
   so the denominator is never all-zero, and zero poles placed simply
   yields `[1]`). Show the same error-banner pattern already used
   elsewhere, with the backend's existing message. The last good
   chart/fraction stay visible, consistent with how the Explorer tab
   already handles errors.
5. Amplitude is fixed at 1 for this tab (not exposed here — K already
   serves as the analogous scale control per the design discussion, and
   duplicating both would be confusing); `response_type` is fixed at
   `"step"` (impulse is out of scope for this tab per the Non-goals).

## Error handling

Reuses the Explorer tab's existing error-banner CSS/markup pattern
(duplicated as its own instance — `#editor-error-banner` — since the two
tabs must remain independently functional and the constraint is that
nothing about the Explorer tab's own `#error-banner` element changes).
Same behavior: red banner with the backend's message, last good render
stays on screen underneath it.

## Testing

- **Backend:** none needed — no backend code changes in this feature.
  `test_app.py`'s existing 67 tests continue to cover the reused
  `/api/response` endpoint unchanged.
- **Root→coefficient math:** verified directly via a standalone Node check
  (same technique used for the polynomial-formatting fraction display)
  against hand-computable cases before integration:
  - One real pole at `s = −2`: denominator `[1, 2]`.
  - One conjugate pole pair at `−1 ± 2i`: denominator `[1, 2, 5]` (since
    `s² − 2(−1)s + (1+4) = s² + 2s + 5`).
  - A mix: two real poles + one conjugate zero pair, checked against
    manual convolution.
  - Zero poles placed: denominator `[1]`.
- **Manual (in-browser):** switch tabs and confirm the Explorer tab is
  pixel-identical to before this change; on the Editor tab, place a real
  pole, place an off-axis point and confirm its mirror appears
  automatically, select and delete a pair, clear all, adjust gain, and
  trigger the improper-transfer-function error (more zeros than poles) to
  confirm the error banner appears with the existing backend message.
