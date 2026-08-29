# Pole-Zero Editor Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second tab to the Linear System Response Explorer — an interactive s-plane canvas where clicking places poles/zeros, the app derives the transfer function from their locations, and plots its step response — without changing anything about the existing (Explorer) tab.

**Architecture:** Client-side tab switching between two `<section>` panels in the same page (no new Flask routes). A hand-built SVG canvas (not Plotly — Plotly's click events aren't designed for placing new points at arbitrary empty-canvas locations) handles placement/selection/deletion. Transfer-function coefficients are derived from placed points via plain real-coefficient polynomial multiplication (every point is either a real linear factor or an auto-mirrored-conjugate-pair quadratic factor, so no complex arithmetic is ever needed) and POSTed to the existing, unmodified `/api/response` endpoint.

**Tech Stack:** Vanilla JS (no new dependencies), SVG, the existing Flask backend (unmodified), Plotly.js (already loaded) for the step-response chart.

**Spec:** `docs/superpowers/specs/2026-08-27-pole-zero-editor-tab-design.md`

## Global Constraints

- **Hard constraint from the spec:** the existing Explorer tab's markup, styles, element IDs, JS functions, and the backend (`app.py`, `test_app.py`) must not change in behavior. This plan touches `app.py`/`test_app.py` in zero tasks. Where `templates/index.html`/`static/style.css`/`static/app.js` are modified, the modification must be a pure refactor (Task 1) or pure addition (Task 2) — never a change to existing selectors' meaning or existing element IDs.
- No new backend endpoint — root→coefficient conversion is client-side JS.
- SVG canvas: fixed coordinate range Real/Imaginary ∈ [−6, 6], `viewBox="0 0 480 480"` (40 px per data unit, origin at pixel (240, 240)).
- Axis-snap tolerance: a placed point with |Im| < 0.15 (data units) snaps to the real axis and is placed as a single real point; otherwise it's placed as an auto-mirrored conjugate pair.
- Marker hit-testing radius: 16px (in the SVG's 480×480 pixel space), computed via JS distance math against each point's data-derived pixel position — not via separate invisible DOM hit-circle elements (the distance check alone fully implements the requirement).
- Default Editor-tab state on load: one conjugate pole pair at `−0.5 ± 1.94i`, no zeros, gain K = 1, placement mode "pole", Explorer tab active/visible.
- The only backend error this tab can realistically trigger is the existing "must be proper" rejection (more zeros placed than poles) — every other coefficient list this construction method produces is well-formed by construction.

---

### Task 1: Extract shared chart/formatting utilities into `chart-utils.js`

**Files:**
- Create: `static/chart-utils.js`
- Modify: `static/app.js:29-45` (remove `cssVar`/`chartAxis`), `static/app.js:55-87` (remove `formatCoefficientNumber`/`formatPolynomial`)
- Modify: `templates/index.html:124` (add a new `<script>` tag before the existing `app.js` one)

**Interfaces:**
- Produces: global functions `cssVar(name)`, `chartAxis(titleText, showZeroline, zerolineWidth = 1, zerolineColor = cssVar("--axis"))`, `formatCoefficientNumber(n)`, `formatPolynomial(coeffs)` — available to every script loaded after `chart-utils.js`. Later tasks (3, 4) call `cssVar`, `chartAxis`, and `formatPolynomial` from `pole-zero-editor.js`.
- This task changes zero runtime behavior — it's a pure refactor. `app.js`'s own callers of these four functions are untouched (the functions just move to a different file, loaded first).

- [ ] **Step 1: Create `static/chart-utils.js`**

```javascript
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartAxis(titleText, showZeroline, zerolineWidth = 1, zerolineColor = cssVar("--axis")) {
  const muted = cssVar("--ink-muted");
  return {
    title: { text: titleText, font: { color: muted } },
    gridcolor: cssVar("--gridline"),
    gridwidth: 1,
    linecolor: cssVar("--axis"),
    zeroline: showZeroline,
    zerolinecolor: zerolineColor,
    zerolinewidth: zerolineWidth,
    tickfont: { color: muted },
  };
}

function formatCoefficientNumber(n) {
  // Round away float noise (e.g. from typed values like "0.1") without
  // showing pointless trailing zeros.
  return String(Math.round(n * 10000) / 10000);
}

function formatPolynomial(coeffs) {
  const degree = coeffs.length - 1;
  const terms = [];

  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const power = degree - i;
    const magnitude = Math.abs(c);

    let powerHtml = "";
    if (power === 1) powerHtml = "s";
    else if (power > 1) powerHtml = `s<sup>${power}</sup>`;

    const showCoefficient = power === 0 || magnitude !== 1;
    const coefficientHtml = showCoefficient ? formatCoefficientNumber(magnitude) : "";

    terms.push({ negative: c < 0, html: coefficientHtml + powerHtml });
  });

  if (terms.length === 0) return "0";

  let html = (terms[0].negative ? "−" : "") + terms[0].html;
  for (let i = 1; i < terms.length; i++) {
    html += (terms[i].negative ? " − " : " + ") + terms[i].html;
  }
  return html;
}
```

- [ ] **Step 2: Remove the four extracted functions from `static/app.js`**

Delete these two blocks from `static/app.js` (they now live in `chart-utils.js`, loaded before `app.js` — see Step 3):

Block A — delete:
```javascript
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartAxis(titleText, showZeroline, zerolineWidth = 1, zerolineColor = cssVar("--axis")) {
  const muted = cssVar("--ink-muted");
  return {
    title: { text: titleText, font: { color: muted } },
    gridcolor: cssVar("--gridline"),
    gridwidth: 1,
    linecolor: cssVar("--axis"),
    zeroline: showZeroline,
    zerolinecolor: zerolineColor,
    zerolinewidth: zerolineWidth,
    tickfont: { color: muted },
  };
}
```

Block B — delete:
```javascript
function formatCoefficientNumber(n) {
  // Round away float noise (e.g. from typed values like "0.1") without
  // showing pointless trailing zeros.
  return String(Math.round(n * 10000) / 10000);
}

function formatPolynomial(coeffs) {
  const degree = coeffs.length - 1;
  const terms = [];

  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const power = degree - i;
    const magnitude = Math.abs(c);

    let powerHtml = "";
    if (power === 1) powerHtml = "s";
    else if (power > 1) powerHtml = `s<sup>${power}</sup>`;

    const showCoefficient = power === 0 || magnitude !== 1;
    const coefficientHtml = showCoefficient ? formatCoefficientNumber(magnitude) : "";

    terms.push({ negative: c < 0, html: coefficientHtml + powerHtml });
  });

  if (terms.length === 0) return "0";

  let html = (terms[0].negative ? "−" : "") + terms[0].html;
  for (let i = 1; i < terms.length; i++) {
    html += (terms[i].negative ? " − " : " + ") + terms[i].html;
  }
  return html;
}
```

After deleting both blocks, `app.js` should go directly from the `SERIES_COLOR_VARS`/`responseType` declarations to `function parseCoeffList(text) {...}`, and from `parseCoeffList`'s closing brace directly to `function updateTransferFunctionPreview() {...}`. Every other line of `app.js` is unchanged — do not edit `parseCoeffList`, `updateTransferFunctionPreview`, or anything below it.

- [ ] **Step 3: Add the new `<script>` tag to `templates/index.html`**

In `templates/index.html`, find this line near the end of the file:

```html
    <script src="{{ url_for('static', filename='app.js') }}"></script>
```

Add a new line directly **before** it:

```html
    <script src="{{ url_for('static', filename='chart-utils.js') }}"></script>
    <script src="{{ url_for('static', filename='app.js') }}"></script>
```

(`chart-utils.js` must load before `app.js` since `app.js` calls the functions it defines.)

- [ ] **Step 4: Verify nothing broke**

Run the backend test suite (unaffected by this frontend-only change, confirms nothing here touched `app.py`):

```bash
pytest test_app.py -v
```
Expected: all existing tests pass (67 at time of writing), unchanged.

Start the server and verify both new and existing static assets serve, and the page still works end-to-end:

```bash
python app.py &
sleep 1
curl -sf http://localhost:5000/static/chart-utils.js > /dev/null && echo "chart-utils.js OK"
curl -sf http://localhost:5000/static/app.js > /dev/null && echo "app.js OK"
curl -s http://localhost:5000/ | grep -c 'chart-utils.js\|app.js' # expect 2 (both script tags present)
curl -s -X POST http://localhost:5000/api/response -H "Content-Type: application/json" -d '{"num":[1],"den":[1,1,4],"response_type":"step"}' | python -c "import sys,json; d=json.load(sys.stdin); print('OK' if d['stable'] else 'FAIL')"
grep -c "^function cssVar\|^function chartAxis\|^function formatCoefficientNumber\|^function formatPolynomial" static/app.js  # expect 0 — confirms removal
kill %1
```
Expected: `chart-utils.js OK`, `app.js OK`, `2`, `OK`, `0`.

- [ ] **Step 5: Commit**

```bash
git add static/chart-utils.js static/app.js templates/index.html
git commit -m "refactor: extract shared chart/formatting utils into chart-utils.js"
```

---

### Task 2: Tab navigation and Editor tab skeleton

**Files:**
- Modify: `templates/index.html` (wrap existing content in a tab panel, add tab-nav, add the new Editor tab's static skeleton, add two new `<script>` tags)
- Modify: `static/style.css` (append tab-nav, tab-panel, secondary-button, and editor-skeleton styles)
- Create: `static/pole-zero-editor.js` (tab-switching logic only, in this task)

**Interfaces:**
- Produces: DOM elements later tasks depend on by exact ID — `pz-editor-svg`, `place-pole-btn`, `place-zero-btn`, `gain-input`, `delete-selected-btn`, `clear-all-btn`, `editor-error-banner`, `editor-error-message`, `editor-tf-numerator`, `editor-tf-denominator`, `editor-chart`, `tab-panel-explorer`, `tab-panel-editor`, `tab-btn-explorer`, `tab-btn-editor`. Produces function `initTabs()` and `showTab(name)` in `pole-zero-editor.js`, called once at the bottom of that file.
- Consumes: nothing from earlier tasks (Task 1's `chart-utils.js` isn't used by this task's tab-switching code, but its `<script>` tag ordering established in Task 1 stays intact).

- [ ] **Step 1: Wrap the existing content and add the tab-nav in `templates/index.html`**

Find this line (the opening of the Presets card, currently the first `<section>` inside `<div class="page">`):

```html
      <section class="card">
        <h2 class="card-title">Presets</h2>
```

Insert this immediately **before** it (still inside `<div class="page">`, right after the closing `</header>`):

```html
      <nav class="tab-nav" role="tablist">
        <button id="tab-btn-explorer" class="tab-btn active" type="button" role="tab" aria-selected="true">Explorer</button>
        <button id="tab-btn-editor" class="tab-btn" type="button" role="tab" aria-selected="false">Pole-Zero Editor</button>
      </nav>

      <section id="tab-panel-explorer" class="tab-panel">
        <section class="card">
          <h2 class="card-title">Presets</h2>
```

Note the extra opening `<section id="tab-panel-explorer" class="tab-panel">` — this wraps everything from the Presets card through the end of the existing Pole–zero map card. Find the end of that last existing card:

```html
      <section class="card">
        <h2 class="card-title">Pole&ndash;zero map</h2>
        <div id="pole-zero-chart"></div>
      </section>
    </div>
```

Change it to close the new wrapper section before `</div>`:

```html
        <section class="card">
          <h2 class="card-title">Pole&ndash;zero map</h2>
          <div id="pole-zero-chart"></div>
        </section>
      </section>

      <section id="tab-panel-editor" class="tab-panel hidden">
        <section class="card">
          <h2 class="card-title">Pole-Zero Editor</h2>
          <div class="pz-editor-controls">
            <div class="toggle-row" role="group" aria-label="Placement mode">
              <button id="place-pole-btn" class="toggle-btn active" type="button">Place pole</button>
              <button id="place-zero-btn" class="toggle-btn" type="button">Place zero</button>
            </div>
            <label class="amplitude-field">
              <span class="field-label">Gain (K)</span>
              <input id="gain-input" type="number" value="1" step="any" />
            </label>
            <button id="delete-selected-btn" class="secondary-btn" type="button" disabled>Delete selected</button>
            <button id="clear-all-btn" class="secondary-btn" type="button">Clear all</button>
          </div>
          <svg id="pz-editor-svg" viewBox="0 0 480 480" class="pz-editor-svg" role="img" aria-label="Pole-zero placement canvas"></svg>
          <p class="field-hint">Click empty space to place a pole or zero. Points placed off the real axis automatically get a mirrored conjugate partner. Click a marker to select it, then use Delete selected to remove it.</p>
        </section>

        <div id="editor-error-banner" class="error-banner hidden" role="alert">
          <svg class="error-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 2.5 18.5 17H1.5L10 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            <path d="M10 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="10" cy="14.5" r="0.9" fill="currentColor" />
          </svg>
          <span id="editor-error-message"></span>
        </div>

        <section class="card">
          <h2 class="card-title">Transfer function</h2>
          <div class="tf-preview" aria-live="polite">
            <span class="tf-label">G(s) =</span>
            <span class="tf-fraction">
              <span id="editor-tf-numerator" class="tf-num"></span>
              <span class="tf-bar"></span>
              <span id="editor-tf-denominator" class="tf-den"></span>
            </span>
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">Step response</h2>
          <div id="editor-chart"></div>
        </section>
      </section>
    </div>
```

Double-check after this edit: `<div class="page">` contains, in order — `<header>`, `<nav class="tab-nav">`, `<section id="tab-panel-explorer">` (containing all the pre-existing cards, unchanged internally), `<section id="tab-panel-editor">` (the new content above), then the closing `</div>`.

- [ ] **Step 2: Add the new `<script>` tags**

Find (added in Task 1):

```html
    <script src="{{ url_for('static', filename='chart-utils.js') }}"></script>
    <script src="{{ url_for('static', filename='app.js') }}"></script>
```

Change to:

```html
    <script src="{{ url_for('static', filename='chart-utils.js') }}"></script>
    <script src="{{ url_for('static', filename='app.js') }}"></script>
    <script src="{{ url_for('static', filename='pole-zero-editor.js') }}"></script>
```

- [ ] **Step 3: Create `static/pole-zero-editor.js`**

```javascript
const tabBtnExplorer = document.getElementById("tab-btn-explorer");
const tabBtnEditor = document.getElementById("tab-btn-editor");
const tabPanelExplorer = document.getElementById("tab-panel-explorer");
const tabPanelEditor = document.getElementById("tab-panel-editor");

function showTab(name) {
  const showExplorer = name === "explorer";
  tabPanelExplorer.classList.toggle("hidden", !showExplorer);
  tabPanelEditor.classList.toggle("hidden", showExplorer);
  tabBtnExplorer.classList.toggle("active", showExplorer);
  tabBtnEditor.classList.toggle("active", !showExplorer);
  tabBtnExplorer.setAttribute("aria-selected", String(showExplorer));
  tabBtnEditor.setAttribute("aria-selected", String(!showExplorer));
}

function initTabs() {
  tabBtnExplorer.addEventListener("click", () => showTab("explorer"));
  tabBtnEditor.addEventListener("click", () => showTab("editor"));
}

initTabs();
```

- [ ] **Step 4: Append tab-nav and skeleton CSS to `static/style.css`**

Add to the end of `static/style.css`:

```css
/* Tabs */

.tab-nav {
  display: flex;
  gap: 0.5rem;
}

.tab-btn {
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.55rem 1.1rem;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: var(--page-bg);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.tab-btn:hover {
  background: var(--accent-wash);
}

.tab-btn.active {
  background: var(--surface);
  color: var(--ink-primary);
}

.tab-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.tab-panel.hidden {
  display: none;
}

/* Pole-zero editor skeleton */

.pz-editor-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1.1rem;
  margin-bottom: 1.1rem;
}

.secondary-btn {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--page-bg);
  color: var(--ink-primary);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.secondary-btn:hover:not(:disabled) {
  border-color: var(--critical);
  background: var(--critical-wash);
}

.secondary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.secondary-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.pz-editor-svg {
  display: block;
  width: 100%;
  max-width: 480px;
  aspect-ratio: 1 / 1;
  margin: 0 auto;
  background: var(--page-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: crosshair;
}

#editor-chart {
  width: 100%;
  height: 340px;
}
```

- [ ] **Step 5: Verify**

```bash
pytest test_app.py -v
```
Expected: all existing tests still pass, unchanged (no backend touched).

```bash
python app.py &
sleep 1
curl -sf http://localhost:5000/static/pole-zero-editor.js > /dev/null && echo "pole-zero-editor.js OK"
curl -s http://localhost:5000/ > /tmp/page.html
for id in tab-btn-explorer tab-btn-editor tab-panel-explorer tab-panel-editor pz-editor-svg place-pole-btn place-zero-btn gain-input delete-selected-btn clear-all-btn editor-error-banner editor-error-message editor-tf-numerator editor-tf-denominator editor-chart; do
  grep -q "id=\"$id\"" /tmp/page.html || echo "MISSING: $id"
done
echo "id check done"
# Confirm the pre-existing Explorer elements are still present and unmoved (spot-check a few)
for id in num-input den-input step-btn stability-badge metric-rise-time pole-zero-chart; do
  grep -q "id=\"$id\"" /tmp/page.html || echo "REGRESSION: $id missing"
done
echo "explorer regression check done"
kill %1
```
Expected: `pole-zero-editor.js OK`, `id check done` with no `MISSING` lines, `explorer regression check done` with no `REGRESSION` lines.

Read `static/pole-zero-editor.js` and confirm `showTab`/`initTabs` correctly reference the toggled elements by the exact IDs just added to `templates/index.html`.

- [ ] **Step 6: Commit**

```bash
git add templates/index.html static/style.css static/pole-zero-editor.js
git commit -m "feat: add tab navigation and pole-zero editor tab skeleton"
```

---

### Task 3: SVG canvas — coordinate math, state, and rendering

**Files:**
- Modify: `static/pole-zero-editor.js`

**Interfaces:**
- Consumes: `cssVar` from `chart-utils.js` (Task 1); `pz-editor-svg` element from Task 2.
- Produces: constants `PZ_RANGE`, `PZ_VIEWBOX`, `PZ_PX_PER_UNIT`, `PZ_CENTER`; functions `dataToPixel(re, im) -> {x, y}`, `pixelToData(px, py) -> {re, im}`, `addPoleZeroPoint(kind, re, im) -> Array<point>` (`kind` is `"pole"` or `"zero"`; a `point` is `{id, real, imag, pairId}`, `pairId` is another point's `id` or `null`), `renderPoleZeroCanvas()`. State arrays `pzPoles`, `pzZeros` (each an array of `point`), counter `pzNextId`, and `pzSelectedId` (a point `id` or `null`) — all consumed by Tasks 4 and 5.

- [ ] **Step 1: Add coordinate math, state, and `addPoleZeroPoint` to `static/pole-zero-editor.js`**

Insert after the existing `const tabPanelEditor = ...` line and before `function showTab`:

```javascript
const PZ_RANGE = 6; // data units from -6 to 6 on each axis
const PZ_VIEWBOX = 480; // svg viewBox size in pixels
const PZ_PX_PER_UNIT = PZ_VIEWBOX / (2 * PZ_RANGE); // 40
const PZ_CENTER = PZ_VIEWBOX / 2; // 240
const PZ_AXIS_SNAP_TOLERANCE = 0.15;

const pzSvg = document.getElementById("pz-editor-svg");

let pzPoles = [];
let pzZeros = [];
let pzNextId = 1;
let pzSelectedId = null;
let pzPlacementMode = "pole";
let pzGain = 1;

function dataToPixel(re, im) {
  return { x: PZ_CENTER + re * PZ_PX_PER_UNIT, y: PZ_CENTER - im * PZ_PX_PER_UNIT };
}

function pixelToData(px, py) {
  return { re: (px - PZ_CENTER) / PZ_PX_PER_UNIT, im: (PZ_CENTER - py) / PZ_PX_PER_UNIT };
}

function addPoleZeroPoint(kind, re, im) {
  const list = kind === "pole" ? pzPoles : pzZeros;
  const snappedIm = Math.abs(im) < PZ_AXIS_SNAP_TOLERANCE ? 0 : im;

  if (snappedIm === 0) {
    const point = { id: pzNextId++, real: re, imag: 0, pairId: null };
    list.push(point);
    return [point];
  }

  const idA = pzNextId++;
  const idB = pzNextId++;
  const pointA = { id: idA, real: re, imag: snappedIm, pairId: idB };
  const pointB = { id: idB, real: re, imag: -snappedIm, pairId: idA };
  list.push(pointA, pointB);
  return [pointA, pointB];
}
```

- [ ] **Step 2: Verify the pure math directly with Node**

```bash
node -e '
const PZ_RANGE = 6, PZ_VIEWBOX = 480, PZ_PX_PER_UNIT = PZ_VIEWBOX / (2 * PZ_RANGE), PZ_CENTER = PZ_VIEWBOX / 2;
function dataToPixel(re, im) { return { x: PZ_CENTER + re * PZ_PX_PER_UNIT, y: PZ_CENTER - im * PZ_PX_PER_UNIT }; }
function pixelToData(px, py) { return { re: (px - PZ_CENTER) / PZ_PX_PER_UNIT, im: (PZ_CENTER - py) / PZ_PX_PER_UNIT }; }

console.log("origin ->", dataToPixel(0, 0)); // expect {x:240, y:240}
console.log("(-0.5, 1.94) ->", dataToPixel(-0.5, 1.94)); // expect {x:220, y:162.4}
console.log("round-trip (100, 50) ->", pixelToData(100, 50)); // expect {re:-3.5, im:4.75}

let pzNextId = 1;
function addPoleZeroPoint(list, kind, re, im) {
  const snappedIm = Math.abs(im) < 0.15 ? 0 : im;
  if (snappedIm === 0) {
    const point = { id: pzNextId++, real: re, imag: 0, pairId: null };
    list.push(point);
    return [point];
  }
  const idA = pzNextId++, idB = pzNextId++;
  const pointA = { id: idA, real: re, imag: snappedIm, pairId: idB };
  const pointB = { id: idB, real: re, imag: -snappedIm, pairId: idA };
  list.push(pointA, pointB);
  return [pointA, pointB];
}

const poles = [];
console.log("real point (im=0.05, snaps):", addPoleZeroPoint(poles, "pole", -2, 0.05));
console.log("off-axis point (im=1.94, mirrors):", addPoleZeroPoint(poles, "pole", -0.5, 1.94));
console.log("full poles list:", poles);
'
```
Expected output: origin at `{x:240,y:240}`; `(-0.5,1.94)` at `{x:220,y:162.4}` (since `240 - 1.94*40 = 240 - 77.6 = 162.4`); the round-trip recovers `{re:-3.5, im:4.75}`; the near-axis point snaps to a single point with `imag: 0, pairId: null`; the off-axis point produces two points with `imag: 1.94`/`imag: -1.94` and matching `pairId`s.

- [ ] **Step 3: Add rendering to `static/pole-zero-editor.js`**

Insert after `addPoleZeroPoint` and before `function showTab`:

```javascript
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function renderPoleZeroMarker(point, color) {
  const { x, y } = dataToPixel(point.real, point.imag);

  if (point.id === pzSelectedId) {
    pzSvg.appendChild(
      svgEl("circle", { cx: x, cy: y, r: 18, fill: "none", stroke: cssVar("--ink-primary"), "stroke-width": 2 })
    );
  }

  if (color === cssVar("--critical")) {
    // Pole: draw an X.
    const s = 9;
    pzSvg.appendChild(svgEl("line", { x1: x - s, y1: y - s, x2: x + s, y2: y + s, stroke: color, "stroke-width": 2.5 }));
    pzSvg.appendChild(svgEl("line", { x1: x - s, y1: y + s, x2: x + s, y2: y - s, stroke: color, "stroke-width": 2.5 }));
  } else {
    // Zero: draw an open circle.
    pzSvg.appendChild(svgEl("circle", { cx: x, cy: y, r: 8, fill: "none", stroke: color, "stroke-width": 2.5 }));
  }
}

function renderPoleZeroCanvas() {
  while (pzSvg.firstChild) pzSvg.removeChild(pzSvg.firstChild);

  const gridline = cssVar("--gridline");
  const boldAxis = cssVar("--ink-secondary");

  for (let n = -PZ_RANGE; n <= PZ_RANGE; n++) {
    if (n === 0) continue;
    const v = dataToPixel(n, 0);
    pzSvg.appendChild(svgEl("line", { x1: v.x, y1: 0, x2: v.x, y2: PZ_VIEWBOX, stroke: gridline, "stroke-width": 1 }));
    const h = dataToPixel(0, n);
    pzSvg.appendChild(svgEl("line", { x1: 0, y1: h.y, x2: PZ_VIEWBOX, y2: h.y, stroke: gridline, "stroke-width": 1 }));
  }

  pzSvg.appendChild(svgEl("line", { x1: 0, y1: PZ_CENTER, x2: PZ_VIEWBOX, y2: PZ_CENTER, stroke: boldAxis, "stroke-width": 2.5 }));
  pzSvg.appendChild(svgEl("line", { x1: PZ_CENTER, y1: 0, x2: PZ_CENTER, y2: PZ_VIEWBOX, stroke: boldAxis, "stroke-width": 2.5 }));

  pzPoles.forEach((p) => renderPoleZeroMarker(p, cssVar("--critical")));
  pzZeros.forEach((z) => renderPoleZeroMarker(z, cssVar("--accent")));
}

addPoleZeroPoint("pole", -0.5, 1.94);
renderPoleZeroCanvas();
```

The two trailing statements seed the default conjugate pole pair and draw it immediately. Leave the file's final `initTabs();` line exactly where it is (at the very end) — these new statements go **above** it.

- [ ] **Step 4: Verify**

```bash
pytest test_app.py -v
```
Expected: unaffected, all passing.

```bash
python app.py &
sleep 1
curl -s http://localhost:5000/static/pole-zero-editor.js | grep -c "function renderPoleZeroCanvas\|function dataToPixel\|function addPoleZeroPoint"
kill %1
```
Expected: `3`.

Read the full `static/pole-zero-editor.js` file and confirm: `pzPoles` has exactly 2 entries after the seed call (a conjugate pair from the single `addPoleZeroPoint("pole", -0.5, 1.94)` call), `renderPoleZeroCanvas` clears and redraws the SVG's children on every call (no leaked/duplicate elements across repeated calls), and the trailing `initTabs();` call is still the last line in the file.

- [ ] **Step 5: Commit**

```bash
git add static/pole-zero-editor.js
git commit -m "feat: add pole-zero editor coordinate math, state, and canvas rendering"
```

---

### Task 4: Polynomial-from-roots math and step-response fetch/render

**Files:**
- Modify: `static/pole-zero-editor.js`

**Interfaces:**
- Consumes: `chartAxis`, `cssVar`, `formatPolynomial` from `chart-utils.js` (Task 1); `pzPoles`, `pzZeros`, `pzGain` state from Task 3; DOM elements `editor-tf-numerator`, `editor-tf-denominator`, `editor-error-banner`, `editor-error-message`, `editor-chart` from Task 2.
- Produces: `convolvePolynomials(a, b) -> number[]`, `buildPolynomialFromPoints(points) -> number[]`, `computeTransferFunctionCoefficients() -> {num, den}`, `showEditorError(message)`, `clearEditorError()`, `renderEditorChart(data)`, `async function updateAndFetch()` — all consumed by Task 5's interaction handlers.

- [ ] **Step 1: Add the polynomial math to `static/pole-zero-editor.js`**

Insert after `renderPoleZeroCanvas` and before the `addPoleZeroPoint("pole", -0.5, 1.94);` seed line:

```javascript
function convolvePolynomials(a, b) {
  const result = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] += a[i] * b[j];
    }
  }
  return result;
}

function buildPolynomialFromPoints(points) {
  let polynomial = [1];
  const processed = new Set();

  points.forEach((point) => {
    if (processed.has(point.id)) return;
    if (point.pairId === null) {
      polynomial = convolvePolynomials(polynomial, [1, -point.real]);
      processed.add(point.id);
    } else {
      const a = point.real;
      const b = Math.abs(point.imag);
      polynomial = convolvePolynomials(polynomial, [1, -2 * a, a * a + b * b]);
      processed.add(point.id);
      processed.add(point.pairId);
    }
  });

  return polynomial;
}

function computeTransferFunctionCoefficients() {
  const denominator = buildPolynomialFromPoints(pzPoles);
  const zeroPolynomial = buildPolynomialFromPoints(pzZeros);
  const numerator = zeroPolynomial.map((c) => c * pzGain);
  return { num: numerator, den: denominator };
}
```

- [ ] **Step 2: Verify the math directly with Node against the spec's exact cases**

```bash
node -e '
function convolvePolynomials(a, b) {
  const result = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) result[i + j] += a[i] * b[j];
  return result;
}
function buildPolynomialFromPoints(points) {
  let polynomial = [1];
  const processed = new Set();
  points.forEach((point) => {
    if (processed.has(point.id)) return;
    if (point.pairId === null) {
      polynomial = convolvePolynomials(polynomial, [1, -point.real]);
      processed.add(point.id);
    } else {
      const a = point.real, b = Math.abs(point.imag);
      polynomial = convolvePolynomials(polynomial, [1, -2 * a, a * a + b * b]);
      processed.add(point.id); processed.add(point.pairId);
    }
  });
  return polynomial;
}

// One real pole at s = -2 -> denominator [1, 2]
console.log("real pole -2:", buildPolynomialFromPoints([{ id: 1, real: -2, imag: 0, pairId: null }]));

// One conjugate pole pair at -1 +/- 2i -> denominator [1, 2, 5]
console.log("pair -1+/-2i:", buildPolynomialFromPoints([
  { id: 1, real: -1, imag: 2, pairId: 2 },
  { id: 2, real: -1, imag: -2, pairId: 1 },
]));

// Zero poles placed -> [1]
console.log("empty:", buildPolynomialFromPoints([]));

// Mix: two real poles (-1, -3) + one conjugate zero pair (0 +/- 1i), checked by hand:
// (s+1)(s+3) = s^2+4s+3 ; (s^2+1) for the pair -> both independently checkable
console.log("two real poles -1,-3:", buildPolynomialFromPoints([
  { id: 1, real: -1, imag: 0, pairId: null },
  { id: 2, real: -3, imag: 0, pairId: null },
]));
console.log("conjugate pair 0+/-1i:", buildPolynomialFromPoints([
  { id: 1, real: 0, imag: 1, pairId: 2 },
  { id: 2, real: 0, imag: -1, pairId: 1 },
]));
'
```
Expected: `real pole -2: [1, 2]`; `pair -1+/-2i: [1, 2, 5]`; `empty: [1]`; `two real poles -1,-3: [1, 4, 3]`; `conjugate pair 0+/-1i: [1, 0, 1]`. Every value must match exactly before moving on — this is the correctness-critical step of the whole feature.

- [ ] **Step 3: Add fetch/render logic to `static/pole-zero-editor.js`**

Insert after `computeTransferFunctionCoefficients` and before the `addPoleZeroPoint("pole", -0.5, 1.94);` seed line:

```javascript
const editorTfNumerator = document.getElementById("editor-tf-numerator");
const editorTfDenominator = document.getElementById("editor-tf-denominator");
const editorErrorBanner = document.getElementById("editor-error-banner");
const editorErrorMessage = document.getElementById("editor-error-message");

function showEditorError(message) {
  editorErrorMessage.textContent = message;
  editorErrorBanner.classList.remove("hidden");
}

function clearEditorError() {
  editorErrorBanner.classList.add("hidden");
}

function renderEditorChart(data) {
  const ink = cssVar("--ink-secondary");
  const axis = cssVar("--axis");
  const surface = cssVar("--surface");

  Plotly.react(
    "editor-chart",
    [
      {
        x: data.time,
        y: data.values,
        mode: "lines",
        line: { color: cssVar("--accent"), width: 2 },
        hovertemplate: "t = %{x:.3f}s<br><b>%{y:.4g}</b><extra></extra>",
      },
    ],
    {
      margin: { t: 10, r: 20, b: 44, l: 52 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      xaxis: chartAxis("Time (s)", false),
      yaxis: chartAxis("Response", true),
      hovermode: "x",
      hoverlabel: { bgcolor: surface, bordercolor: axis, font: { color: ink } },
    },
    { responsive: true, displayModeBar: false }
  );
}

async function updateAndFetch() {
  const { num, den } = computeTransferFunctionCoefficients();
  editorTfNumerator.innerHTML = formatPolynomial(num);
  editorTfDenominator.innerHTML = formatPolynomial(den);

  try {
    const res = await fetch("/api/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num, den, response_type: "step", amplitude: 1 }),
    });

    const data = await res.json();

    if (!res.ok) {
      showEditorError(data.error);
      return;
    }

    clearEditorError();
    renderEditorChart(data);
  } catch (err) {
    showEditorError("Could not reach the server — is app.py still running?");
  }
}
```

- [ ] **Step 4: Call `updateAndFetch()` once at startup**

Change:

```javascript
addPoleZeroPoint("pole", -0.5, 1.94);
renderPoleZeroCanvas();
```

to:

```javascript
addPoleZeroPoint("pole", -0.5, 1.94);
renderPoleZeroCanvas();
updateAndFetch();
```

(still directly above the file's trailing `initTabs();` line).

- [ ] **Step 5: Verify end-to-end against the running backend**

```bash
pytest test_app.py -v
```
Expected: unaffected, all passing.

```bash
python app.py &
sleep 1
# Confirm the default state's derived coefficients (denominator from a
# conjugate pair at -0.5+/-1.94i: [1, 1, 0.25+3.7636] = [1, 1, 4.0136])
# produce a sensible step response through the unmodified endpoint.
curl -s -X POST http://localhost:5000/api/response -H "Content-Type: application/json" \
  -d '{"num":[1],"den":[1,1,4.0136],"response_type":"step","amplitude":1}' \
  | python -c "import sys,json; d=json.load(sys.stdin); print('stable:', d['stable']); print('steady_state:', d['metrics']['steady_state'])"
kill %1
```
Expected: `stable: True`, `steady_state:` approximately `0.249...` (close to `1/4.0136`).

Read the full `static/pole-zero-editor.js` file top to bottom and confirm the function order is: coordinate math/state → `addPoleZeroPoint` → SVG helpers/`renderPoleZeroCanvas` → polynomial math → fetch/render helpers → the three seed/startup calls (`addPoleZeroPoint(...)`, `renderPoleZeroCanvas()`, `updateAndFetch()`) → `showTab`/`initTabs` → the trailing `initTabs();` call.

- [ ] **Step 6: Commit**

```bash
git add static/pole-zero-editor.js
git commit -m "feat: derive transfer function from placed poles/zeros and render its step response"
```

---

### Task 5: Click-to-place, select, delete, clear, and gain interaction

**Files:**
- Modify: `static/pole-zero-editor.js`

**Interfaces:**
- Consumes: `pzSvg`, `dataToPixel`, `pixelToData`, `addPoleZeroPoint`, `renderPoleZeroCanvas`, `pzPoles`, `pzZeros`, `pzSelectedId`, `pzPlacementMode`, `pzGain`, `updateAndFetch` — all from Tasks 3-4. DOM elements `place-pole-btn`, `place-zero-btn`, `delete-selected-btn`, `clear-all-btn`, `gain-input` from Task 2.
- Produces: `findPoleZeroMarkerAt(px, py) -> point|null`, `selectPoleZeroPoint(id)`, `clearPoleZeroSelection()`, `deletePoleZeroSelected()`, `clearAllPoleZero()`, `updateDeleteButtonState()`. This is the final task — nothing downstream depends on it.

- [ ] **Step 1: Add selection/deletion state functions to `static/pole-zero-editor.js`**

Insert directly after the `computeTransferFunctionCoefficients` function (i.e. between the polynomial math and the `editorTfNumerator` element lookups added in Task 4):

```javascript
function findPoleZeroMarkerAt(px, py) {
  const allPoints = [...pzPoles, ...pzZeros];
  let closest = null;
  let closestDistance = Infinity;

  allPoints.forEach((point) => {
    const { x, y } = dataToPixel(point.real, point.imag);
    const distance = Math.hypot(px - x, py - y);
    if (distance <= 16 && distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  });

  return closest;
}

function selectPoleZeroPoint(id) {
  pzSelectedId = id;
}

function clearPoleZeroSelection() {
  pzSelectedId = null;
}

function deletePoleZeroSelected() {
  if (pzSelectedId === null) return;
  const selectedPoint = pzPoles.find((p) => p.id === pzSelectedId) || pzZeros.find((z) => z.id === pzSelectedId);
  if (!selectedPoint) return;

  const idsToRemove = new Set([selectedPoint.id]);
  if (selectedPoint.pairId !== null) idsToRemove.add(selectedPoint.pairId);

  pzPoles = pzPoles.filter((p) => !idsToRemove.has(p.id));
  pzZeros = pzZeros.filter((z) => !idsToRemove.has(z.id));
  pzSelectedId = null;
}

function clearAllPoleZero() {
  pzPoles = [];
  pzZeros = [];
  pzSelectedId = null;
}
```

- [ ] **Step 2: Verify the hit-testing and deletion math directly with Node**

```bash
node -e '
const PZ_CENTER = 240, PZ_PX_PER_UNIT = 40;
function dataToPixel(re, im) { return { x: PZ_CENTER + re * PZ_PX_PER_UNIT, y: PZ_CENTER - im * PZ_PX_PER_UNIT }; }

let pzPoles = [{ id: 1, real: -0.5, imag: 1.94, pairId: 2 }, { id: 2, real: -0.5, imag: -1.94, pairId: 1 }];
let pzZeros = [{ id: 3, real: -2, imag: 0, pairId: null }];

function findPoleZeroMarkerAt(px, py) {
  const allPoints = [...pzPoles, ...pzZeros];
  let closest = null, closestDistance = Infinity;
  allPoints.forEach((point) => {
    const { x, y } = dataToPixel(point.real, point.imag);
    const distance = Math.hypot(px - x, py - y);
    if (distance <= 16 && distance < closestDistance) { closest = point; closestDistance = distance; }
  });
  return closest;
}

// Click exactly on point id=1 pixel location -> should find it
console.log("hit on marker 1:", findPoleZeroMarkerAt(220, 162.4));
// Click far from everything -> should find nothing
console.log("miss (empty space):", findPoleZeroMarkerAt(400, 400));

let pzSelectedId = 1;
function deletePoleZeroSelected() {
  if (pzSelectedId === null) return;
  const selectedPoint = pzPoles.find((p) => p.id === pzSelectedId) || pzZeros.find((z) => z.id === pzSelectedId);
  if (!selectedPoint) return;
  const idsToRemove = new Set([selectedPoint.id]);
  if (selectedPoint.pairId !== null) idsToRemove.add(selectedPoint.pairId);
  pzPoles = pzPoles.filter((p) => !idsToRemove.has(p.id));
  pzZeros = pzZeros.filter((z) => !idsToRemove.has(z.id));
  pzSelectedId = null;
}
deletePoleZeroSelected();
console.log("poles after deleting id=1 (should remove both 1 and 2):", pzPoles);
console.log("zeros untouched:", pzZeros);
'
```
Expected: `hit on marker 1` returns the `{id:1,...}` point object; `miss (empty space)` returns `null`; after deleting the selected id=1, `pzPoles` is an empty array (both paired points removed together) and `pzZeros` still has its one entry, untouched.

- [ ] **Step 3: Add `updateDeleteButtonState`, the click handler, and button wiring**

Insert directly after the `updateAndFetch` function (i.e. right before the `addPoleZeroPoint("pole", -0.5, 1.94);` seed line):

```javascript
const placePoleBtn = document.getElementById("place-pole-btn");
const placeZeroBtn = document.getElementById("place-zero-btn");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const clearAllBtn = document.getElementById("clear-all-btn");
const gainInput = document.getElementById("gain-input");

function updateDeleteButtonState() {
  deleteSelectedBtn.disabled = pzSelectedId === null;
}

function handlePoleZeroCanvasClick(event) {
  const rect = pzSvg.getBoundingClientRect();
  const scaleX = PZ_VIEWBOX / rect.width;
  const scaleY = PZ_VIEWBOX / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;

  const hit = findPoleZeroMarkerAt(px, py);
  if (hit) {
    selectPoleZeroPoint(hit.id);
  } else {
    const { re, im } = pixelToData(px, py);
    addPoleZeroPoint(pzPlacementMode, re, im);
    clearPoleZeroSelection();
  }
  renderPoleZeroCanvas();
  updateDeleteButtonState();
  updateAndFetch();
}

pzSvg.addEventListener("click", handlePoleZeroCanvasClick);

placePoleBtn.addEventListener("click", () => {
  pzPlacementMode = "pole";
  placePoleBtn.classList.add("active");
  placeZeroBtn.classList.remove("active");
});

placeZeroBtn.addEventListener("click", () => {
  pzPlacementMode = "zero";
  placeZeroBtn.classList.add("active");
  placePoleBtn.classList.remove("active");
});

deleteSelectedBtn.addEventListener("click", () => {
  deletePoleZeroSelected();
  renderPoleZeroCanvas();
  updateDeleteButtonState();
  updateAndFetch();
});

clearAllBtn.addEventListener("click", () => {
  clearAllPoleZero();
  renderPoleZeroCanvas();
  updateDeleteButtonState();
  updateAndFetch();
});

let pzDebounceTimer = null;

gainInput.addEventListener("input", () => {
  pzGain = Number(gainInput.value);
  clearTimeout(pzDebounceTimer);
  pzDebounceTimer = setTimeout(updateAndFetch, 300);
});
```

Note the debounce timer is named `pzDebounceTimer`, distinct from `app.js`'s own `debounceTimer` — both files share the same global scope (loaded as separate `<script>` tags on one page), so a same-named `let` in both files would be a `SyntaxError` (redeclaration). Do not rename this to match `app.js`.

- [ ] **Step 4: Verify**

```bash
pytest test_app.py -v
```
Expected: unaffected, all passing (67 tests).

```bash
python app.py &
sleep 1
# Confirm the reused endpoint still rejects an improper transfer function
# the way this tab can trigger it (more zeros placed than poles) --
# e.g. two zeros, one pole: numerator order 2 > denominator order 1.
curl -s -X POST http://localhost:5000/api/response -H "Content-Type: application/json" \
  -d '{"num":[1,0,1],"den":[1,2],"response_type":"step","amplitude":1}' \
  | python -c "import sys,json; d=json.load(sys.stdin); print('error' in d, d.get('error',''))"
kill %1
```
Expected: `True` followed by the existing "Transfer function must be proper..." message — confirming this tab's one reachable error case is already handled for free by the unmodified backend.

Read the full `static/pole-zero-editor.js` file end to end and confirm:
- Every `addEventListener` call references an element defined earlier in the file (no forward references).
- `handlePoleZeroCanvasClick`'s empty-space branch calls `addPoleZeroPoint` with `pzPlacementMode` (not a hardcoded `"pole"`).
- The file's very last statement is still `initTabs();`.

Also do a manual pass in the browser (`python app.py`, open `http://localhost:5000`):
1. Confirm the Explorer tab looks and behaves exactly as before this feature (presets, inputs, charts, metrics, decomposition, stability badge, static pole-zero map all unchanged).
2. Click "Pole-Zero Editor" — confirm the default conjugate pole pair, its `G(s)` fraction, and its step response chart all appear.
3. Click empty canvas space on the real axis — confirm a single pole appears (no mirror).
4. Click empty canvas space off-axis — confirm both the clicked point and its mirror appear, and the chart/fraction update.
5. Click "Place zero", click empty space — confirm a zero (circle) appears in the accent color.
6. Click an existing marker — confirm the selection ring appears and "Delete selected" becomes enabled; click it — confirm the point (and its pair, if any) disappears.
7. Click "Clear all" — confirm the canvas empties and the chart/fraction update accordingly (denominator `1`, i.e. `G(s) = K`).
8. Adjust the Gain (K) field — confirm the step response's steady-state value scales accordingly.
9. Place enough zeros to exceed the pole count — confirm the editor's own error banner appears with the backend's "must be proper" message.

- [ ] **Step 5: Commit**

```bash
git add static/pole-zero-editor.js
git commit -m "feat: wire click-to-place, select, delete, clear, and gain interaction for the pole-zero editor"
```
