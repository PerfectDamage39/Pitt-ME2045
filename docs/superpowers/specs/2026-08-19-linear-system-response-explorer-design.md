# Linear System Response Explorer — Design Spec

Date: 2026-08-19

## Purpose

An interactive live-demo tool for a linear control systems course. The
instructor enters transfer function coefficients (or loads a preset) during
lecture and immediately sees the step or impulse response, along with
standard performance metrics (rise time, settling time, overshoot, peak,
steady-state value). Used for live, real-time demonstration in class — not a
batch plotting script and not a student self-serve notebook.

## Non-goals

- No pole-zero map or Bode plot (explicitly out of scope for this iteration).
- No state-space input mode, no PID/closed-loop controller tuning mode.
- No multi-user/session support — single instructor, single browser tab,
  local machine.
- No authentication, no persistence/database — presets are hardcoded, no
  saving of user-entered systems across restarts.

## Architecture

A single local Flask application:

- **Backend** (`app.py`): Python, using the `control` package (the standard
  teaching library for LTI systems, mirrors MATLAB's Control System Toolbox)
  for building transfer functions and computing responses and metrics.
- **Frontend**: one server-rendered HTML page (`templates/index.html`) with
  a hand-written stylesheet (`static/style.css`) and vanilla JS
  (`static/app.js`). Charting via Plotly.js loaded from CDN.

No build step, no JS framework, no database. Run with `python app.py`,
open `http://localhost:5000` in a browser, and project it for the class.

## Components

### `app.py`

- `GET /` — renders `index.html`.
- `POST /api/response` — JSON body `{"num": [..], "den": [..],
  "response_type": "step" | "impulse"}`. Response JSON:
  ```json
  {
    "time": [...],
    "values": [...],
    "stable": true,
    "metrics": {
      "rise_time": 0.5,
      "settling_time": 1.2,
      "overshoot_pct": 12.3,
      "peak": 1.12,
      "peak_time": 0.9,
      "steady_state": 1.0
    }
  }
  ```
  On invalid input, returns HTTP 400 with `{"error": "<message>"}`.

  Metrics for `step` come from `control.step_info()`. Metrics for `impulse`
  are a reduced set: `peak`, `peak_time`, and `steady_state` (final value,
  expected to be ~0 for a stable, strictly proper system) — rise/settling
  time are not well-defined for impulse response and are omitted.

- `GET /api/presets` — returns the list of preset systems (name, num, den)
  so the frontend can build the preset buttons without hardcoding them
  twice.

### `templates/index.html` / `static/app.js` / `static/style.css`

- Numerator and denominator text inputs (comma-separated coefficients,
  highest order first — matches the convention students already know from
  `control.tf`).
- Step / Impulse toggle (radio buttons or a two-state switch).
- Preset button row: Underdamped, Critically damped, Overdamped, Unstable.
  Clicking a preset fills the num/den inputs and triggers a re-plot.
- Plotly chart of the response.
- Metrics panel: labeled numbers, updated on every successful response.
  When a metric is not applicable (e.g. rise/settling time for impulse),
  the field shows "—" instead of a stale or fabricated number.
- Error banner: hidden by default; shown with the backend's error message
  on a 400 response, and cleared on the next successful request. The last
  good chart and metrics remain on screen while an error banner is shown.
- "Unstable" badge: shown when `stable: false` is returned, next to the
  chart title.

## Data flow

1. Page loads → `app.js` calls `/api/presets` to populate preset buttons,
   then triggers a request for the default preset (Underdamped) so the
   chart is populated immediately without user action.
2. User edits an input (debounced ~300ms after last keystroke), clicks a
   preset, or toggles Step/Impulse → `app.js` POSTs current
   num/den/response_type to `/api/response`.
3. Backend parses coefficients into floats, validates them, builds a
   `control.TransferFunction`, computes the response over an
   automatically-selected time window (`control`'s default time vector
   selection), computes metrics, checks pole real parts for stability, and
   returns JSON.
4. `app.js` updates the Plotly trace, the metrics panel, the stability
   badge, and clears/shows the error banner as appropriate.

## Time window selection

- Stable systems: use `control`'s automatic time vector (it sizes the
  window based on system dynamics — no manual tuning needed).
- Unstable systems: cap the simulated time window (e.g., a short fixed
  duration such as 5 time units, or based on the fastest unstable pole) so
  the chart shows the divergence starting without needing an absurd
  y-axis scale. Y-axis is not hard-clipped — the short time window is what
  keeps values readable.

## Error handling

| Condition | Backend behavior | Frontend behavior |
|---|---|---|
| Non-numeric or empty coefficient field | 400, message names the bad field | Red inline error banner; last good plot stays visible |
| Denominator is empty / all zeros | 400, "Denominator cannot be all zero" | Same |
| Improper transfer function (numerator order > denominator order) | 400, "Transfer function must be proper (numerator order ≤ denominator order)" | Same |
| Unstable system | 200, `stable: false`, response computed over a capped time window | Chart renders normally; "Unstable" badge shown next to chart title |
| Unknown `response_type` | 400, "response_type must be 'step' or 'impulse'" | Same |

## Presets

Hardcoded in `app.py`, served via `/api/presets`:

| Name | num | den | Notes |
|---|---|---|---|
| Underdamped | `[1]` | `[1, 1, 4]` (ζ≈0.25, ωn=2) | Default on page load |
| Critically damped | `[1]` | `[1, 4, 4]` (ζ=1, ωn=2) | |
| Overdamped | `[1]` | `[1, 5, 4]` (ζ=1.25, ωn=2) | |
| Unstable | `[1]` | `[1, -1, 4]` | Negative real-part pole demonstration |

## Testing

- Manual (in-browser): load the page, exercise every preset, toggle
  step/impulse on each, enter an invalid field and confirm the error
  banner, enter the unstable preset and confirm the badge appears and the
  chart stays readable.
- `test_app.py` (pytest, using Flask's test client — no server needed):
  - `POST /api/response` with a normal stable system → 200, response has
    `time`, `values`, `metrics`, `stable: true`.
  - `POST /api/response` with the unstable preset → 200, `stable: false`.
  - `POST /api/response` with a malformed body (e.g. non-numeric
    coefficient) → 400 with an `error` field.
  - `GET /api/presets` → 200, returns the 4 presets.

## Dependencies

- `flask`
- `control`
- `numpy` (transitive via `control`, used directly for coefficient parsing)
- Plotly.js via CDN in the HTML (no npm/build step)

## Project layout

```
simulation/
  app.py
  templates/
    index.html
  static/
    app.js
    style.css
  test_app.py
  requirements.txt
  docs/superpowers/specs/2026-08-19-linear-system-response-explorer-design.md
```
