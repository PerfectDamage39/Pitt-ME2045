# Linear System Response Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Flask + Plotly web app where an instructor enters transfer function coefficients (or clicks a preset), sees the step/impulse response plotted live, and reads off computed performance metrics (rise time, settling time, overshoot, peak, steady-state value).

**Architecture:** Single Flask app (`app.py`) does all the control-systems math using the `control` package and serves one HTML page. The page (`templates/index.html`, `static/style.css`, `static/app.js`) is hand-written HTML/CSS/JS with Plotly.js from CDN for the chart; JS calls `/api/response` and `/api/presets` and re-renders on every change. No build step, no database, no auth.

**Tech Stack:** Python 3, Flask, the `control` package, numpy, Plotly.js (CDN), pytest.

**Spec:** `docs/superpowers/specs/2026-08-19-linear-system-response-explorer-design.md`

## Global Constraints

- Numerator/denominator coefficients are ordered highest power first (matches `control.tf` and `numpy.roots` convention) — every input field, preset, and function in this plan follows that order.
- No pole-zero map, no Bode plot, no state-space input, no PID mode, no auth, no persistence (per spec Non-goals).
- `/api/response` returns HTTP 400 with `{"error": "<message>"}` for any invalid input; HTTP 200 with `"stable": false` (not an error) for unstable systems.
- Metrics dict always has the same 6 keys (`rise_time`, `settling_time`, `overshoot_pct`, `peak`, `peak_time`, `steady_state`); a metric that doesn't apply (impulse rise/settling time, or any metric when unstable) is `null`, never omitted or fabricated.

---

### Task 1: Project scaffolding — Flask app skeleton

**Files:**
- Create: `requirements.txt`
- Create: `app.py`
- Create: `templates/index.html`
- Test: `test_app.py`

**Interfaces:**
- Produces: Flask app instance named `app` in `app.py`, importable as `from app import app`. Route `GET /` renders `templates/index.html`.

- [ ] **Step 1: Write the failing test**

Create `test_app.py`:

```python
import pytest

from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_index_page_loads(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Linear System Response Explorer" in response.data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'` (or similar, since `app.py` doesn't exist yet).

- [ ] **Step 3: Create requirements.txt**

```
Flask>=3.0
control>=0.10
numpy>=1.24
pytest>=8.0
```

Install: `pip install -r requirements.txt`

- [ ] **Step 4: Write minimal app.py**

```python
from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)
```

- [ ] **Step 5: Write minimal templates/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Linear System Response Explorer</title>
  </head>
  <body>
    <h1>Linear System Response Explorer</h1>
    <p>Loading...</p>
  </body>
</html>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest test_app.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add requirements.txt app.py templates/index.html test_app.py
git commit -m "feat: scaffold Flask app skeleton"
```

---

### Task 2: Presets data and `/api/presets` endpoint

**Files:**
- Modify: `app.py`
- Test: `test_app.py`

**Interfaces:**
- Consumes: `app` from Task 1.
- Produces: module-level `PRESETS` list in `app.py` (each item `{"name": str, "num": list[float], "den": list[float]}`), route `GET /api/presets` returning that list as JSON. Later tasks (frontend) rely on this exact shape and on the four preset names below.

- [ ] **Step 1: Write the failing test**

Add to `test_app.py`:

```python
def test_presets_endpoint_returns_four_presets(client):
    response = client.get("/api/presets")
    assert response.status_code == 200
    data = response.get_json()
    assert len(data) == 4
    names = [p["name"] for p in data]
    assert names == [
        "Underdamped",
        "Critically damped",
        "Overdamped",
        "Unstable",
    ]
    for preset in data:
        assert "num" in preset
        assert "den" in preset
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest test_app.py::test_presets_endpoint_returns_four_presets -v`
Expected: FAIL — 404, route doesn't exist.

- [ ] **Step 3: Add PRESETS and the route**

In `app.py`, add near the top (after the `app = Flask(__name__)` line) and add the route below the `index` route:

```python
PRESETS = [
    {"name": "Underdamped", "num": [1], "den": [1, 1, 4]},
    {"name": "Critically damped", "num": [1], "den": [1, 4, 4]},
    {"name": "Overdamped", "num": [1], "den": [1, 5, 4]},
    {"name": "Unstable", "num": [1], "den": [1, -1, 4]},
]
```

```python
from flask import jsonify

@app.route("/api/presets")
def presets():
    return jsonify(PRESETS)
```

(Add `jsonify` to the existing `from flask import ...` line rather than a second import line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest test_app.py -v`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add app.py test_app.py
git commit -m "feat: add presets data and /api/presets endpoint"
```

---

### Task 3: Coefficient validation and stability helpers

**Files:**
- Modify: `app.py`
- Test: `test_app.py`

**Interfaces:**
- Produces:
  - `validate_coefficients(num, den) -> tuple[list[float], list[float]]` — raises `ValueError` with a user-facing message on any invalid input; returns parsed float lists on success.
  - `is_stable(den: list[float]) -> bool` — True iff every root of `den` (via `numpy.roots`) has negative real part.
- These are used by `compute_response` in Task 4.

- [ ] **Step 1: Write the failing tests**

Update the existing `from app import app` line at the top of `test_app.py` to:

```python
from app import app, validate_coefficients, is_stable
```

Then add to `test_app.py`:

```python
def test_validate_coefficients_accepts_valid_lists():
    num, den = validate_coefficients([1], [1, 2, 1])
    assert num == [1.0]
    assert den == [1.0, 2.0, 1.0]


def test_validate_coefficients_rejects_empty_denominator():
    with pytest.raises(ValueError, match="cannot be all zero"):
        validate_coefficients([1], [0, 0])


def test_validate_coefficients_rejects_non_numeric():
    with pytest.raises(ValueError, match="only numbers"):
        validate_coefficients([1], ["a", "b"])


def test_validate_coefficients_rejects_empty_list():
    with pytest.raises(ValueError, match="non-empty"):
        validate_coefficients([], [1])


def test_validate_coefficients_rejects_improper_transfer_function():
    with pytest.raises(ValueError, match="proper"):
        validate_coefficients([1, 2, 3], [1, 1])


def test_is_stable_true_for_negative_real_part_poles():
    assert is_stable([1, 4, 4]) is True


def test_is_stable_false_for_positive_real_part_pole():
    assert is_stable([1, -1, 4]) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest test_app.py -v -k "validate_coefficients or is_stable"`
Expected: FAIL — `ImportError: cannot import name 'validate_coefficients'`

- [ ] **Step 3: Implement the helpers**

Add to `app.py` (below the `PRESETS` list, above the routes):

```python
import numpy as np


def validate_coefficients(num, den):
    if not isinstance(num, list) or not isinstance(den, list) or len(num) == 0 or len(den) == 0:
        raise ValueError("Numerator and denominator must be non-empty lists of numbers")
    try:
        num_f = [float(x) for x in num]
        den_f = [float(x) for x in den]
    except (TypeError, ValueError):
        raise ValueError("Numerator and denominator must contain only numbers")
    if all(c == 0 for c in den_f):
        raise ValueError("Denominator cannot be all zero")
    if len(num_f) > len(den_f):
        raise ValueError(
            "Transfer function must be proper (numerator order <= denominator order)"
        )
    return num_f, den_f


def is_stable(den):
    roots = np.roots(den)
    return bool(np.all(roots.real < 0))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest test_app.py -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add app.py test_app.py
git commit -m "feat: add coefficient validation and stability check helpers"
```

---

### Task 4: `compute_response` for step response (stable systems)

**Files:**
- Modify: `app.py`
- Test: `test_app.py`

**Interfaces:**
- Consumes: `validate_coefficients`, `is_stable` from Task 3.
- Produces: `compute_response(num, den, response_type) -> dict` with keys `time` (list[float]), `values` (list[float]), `stable` (bool), `metrics` (dict with keys `rise_time`, `settling_time`, `overshoot_pct`, `peak`, `peak_time`, `steady_state`). Raises `ValueError` for invalid `response_type` or invalid coefficients (propagated from `validate_coefficients`). This task covers `response_type="step"` on stable systems only; Tasks 5 and 6 extend it.
- Also produces internal helper `compute_metrics(sys, t, y, response_type, stable) -> dict`, used by `compute_response`.

- [ ] **Step 1: Write the failing test**

Add to `test_app.py`:

```python
from app import compute_response


def test_compute_response_step_stable_system():
    result = compute_response([1], [1, 1, 4], "step")
    assert result["stable"] is True
    assert len(result["time"]) == len(result["values"])
    assert len(result["time"]) > 1
    # Step response of a stable system with DC gain 1/4 settles near 0.25
    assert result["values"][-1] == pytest.approx(0.25, abs=0.05)
    metrics = result["metrics"]
    assert metrics["steady_state"] == pytest.approx(0.25, abs=0.05)
    assert metrics["overshoot_pct"] > 0  # underdamped -> some overshoot
    assert metrics["rise_time"] > 0
    assert metrics["settling_time"] > 0
    assert metrics["peak"] > metrics["steady_state"]


def test_compute_response_rejects_unknown_response_type():
    with pytest.raises(ValueError, match="response_type"):
        compute_response([1], [1, 1, 4], "ramp")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest test_app.py -v -k compute_response`
Expected: FAIL — `ImportError: cannot import name 'compute_response'`

- [ ] **Step 3: Implement compute_response and compute_metrics**

Add to `app.py` (below `is_stable`), and add `import control` near the top with the other imports:

```python
import control


def compute_metrics(sys, t, y, response_type, stable):
    if not stable:
        return {
            "rise_time": None,
            "settling_time": None,
            "overshoot_pct": None,
            "peak": None,
            "peak_time": None,
            "steady_state": None,
        }
    if response_type == "step":
        info = control.step_info(sys)
        return {
            "rise_time": float(info["RiseTime"]),
            "settling_time": float(info["SettlingTime"]),
            "overshoot_pct": float(info["Overshoot"]),
            "peak": float(info["Peak"]),
            "peak_time": float(info["PeakTime"]),
            "steady_state": float(info["SteadyStateValue"]),
        }
    idx = int(np.argmax(np.abs(y)))
    return {
        "rise_time": None,
        "settling_time": None,
        "overshoot_pct": None,
        "peak": float(y[idx]),
        "peak_time": float(t[idx]),
        "steady_state": float(y[-1]),
    }


def compute_response(num, den, response_type):
    if response_type not in ("step", "impulse"):
        raise ValueError("response_type must be 'step' or 'impulse'")
    num_f, den_f = validate_coefficients(num, den)
    sys = control.TransferFunction(num_f, den_f)
    stable = is_stable(den_f)

    T = None if stable else np.linspace(0, 5, 500)

    if response_type == "step":
        if T is None:
            t, y = control.step_response(sys)
        else:
            t, y = control.step_response(sys, T=T)
    else:
        if T is None:
            t, y = control.impulse_response(sys)
        else:
            t, y = control.impulse_response(sys, T=T)

    metrics = compute_metrics(sys, t, y, response_type, stable)

    return {
        "time": np.asarray(t).tolist(),
        "values": np.asarray(y).tolist(),
        "stable": stable,
        "metrics": metrics,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest test_app.py -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add app.py test_app.py
git commit -m "feat: compute step response and metrics for stable systems"
```

---

### Task 5: Impulse response support (stable systems)

**Files:**
- Modify: `test_app.py` (no changes needed to `app.py` — `compute_response` already branches on `response_type`; this task is verification-only plus a metrics-shape test)

**Interfaces:**
- Consumes: `compute_response` from Task 4 (already handles `response_type="impulse"` via the branch written in Task 4).

- [ ] **Step 1: Write the failing test**

Add to `test_app.py`:

```python
def test_compute_response_impulse_stable_system():
    result = compute_response([1], [1, 1, 4], "impulse")
    assert result["stable"] is True
    assert len(result["time"]) == len(result["values"])
    metrics = result["metrics"]
    # rise/settling time are not defined for impulse response
    assert metrics["rise_time"] is None
    assert metrics["settling_time"] is None
    assert metrics["overshoot_pct"] is None
    # peak/steady_state are defined
    assert metrics["peak"] != 0
    assert metrics["steady_state"] == pytest.approx(0, abs=0.05)
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pytest test_app.py::test_compute_response_impulse_stable_system -v`

This test may already PASS since Task 4 implemented the full `response_type` branch. That's fine — TDD's "red" step is about confirming the test can fail meaningfully, not a hard requirement when covering an existing implementation. If it fails, proceed to Step 3; if it already passes, skip to Step 4.

- [ ] **Step 3: Fix implementation if the test failed**

If the test failed, re-read the `compute_response` and `compute_metrics` implementation from Task 4 and fix the impulse branch to match the assertions above (e.g., ensure `metrics["rise_time"]` is `None` for impulse — check the `if response_type == "step":` branch in `compute_metrics`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest test_app.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add test_app.py
git commit -m "test: cover impulse response metrics shape"
```

---

### Task 6: Unstable system handling

**Files:**
- Modify: `test_app.py` (verification of Task 4's unstable branch, already implemented via `T = None if stable else np.linspace(0, 5, 500)` and `compute_metrics`'s `if not stable` early return)

**Interfaces:**
- Consumes: `compute_response` from Task 4.

- [ ] **Step 1: Write the failing test**

Add to `test_app.py`:

```python
def test_compute_response_unstable_system_capped_window():
    result = compute_response([1], [1, -1, 4], "step")
    assert result["stable"] is False
    assert max(result["time"]) <= 5.0 + 1e-9
    # all metrics are null when unstable
    for value in result["metrics"].values():
        assert value is None
    # values should not be empty and should show growth
    assert len(result["values"]) > 1


def test_compute_response_unstable_system_impulse_also_capped():
    result = compute_response([1], [1, -1, 4], "impulse")
    assert result["stable"] is False
    assert max(result["time"]) <= 5.0 + 1e-9
```

- [ ] **Step 2: Run tests**

Run: `pytest test_app.py -v -k unstable`

This should already PASS given Task 4's implementation (`T = np.linspace(0, 5, 500)` when `not stable`, and `compute_metrics` returns all-`None` when `not stable`). If it fails, inspect why: the most likely cause is `is_stable` misclassifying the `[1, -1, 4]` denominator (roots of `s^2 - s + 4` have positive real part 0.5, so it must be unstable) — re-check `is_stable`'s comparison direction (`roots.real < 0` for stable).

- [ ] **Step 3: Fix if needed, then run full suite**

Run: `pytest test_app.py -v`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add test_app.py
git commit -m "test: cover unstable system capped time window and null metrics"
```

---

### Task 7: `/api/response` Flask route with error handling

**Files:**
- Modify: `app.py`
- Test: `test_app.py`

**Interfaces:**
- Consumes: `compute_response` from Task 4.
- Produces: `POST /api/response` route. Request body: `{"num": [...], "den": [...], "response_type": "step"|"impulse"}`. Response: 200 with the `compute_response` dict, or 400 with `{"error": "<message>"}`. This is the endpoint the frontend (Tasks 8-9) calls.

- [ ] **Step 1: Write the failing tests**

Add to `test_app.py`:

```python
def test_response_endpoint_valid_step(client):
    resp = client.post("/api/response", json={"num": [1], "den": [1, 1, 4], "response_type": "step"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["stable"] is True
    assert "time" in data and "values" in data and "metrics" in data


def test_response_endpoint_unstable_system(client):
    resp = client.post("/api/response", json={"num": [1], "den": [1, -1, 4], "response_type": "step"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["stable"] is False


def test_response_endpoint_bad_coefficients(client):
    resp = client.post("/api/response", json={"num": [1], "den": ["a", "b"], "response_type": "step"})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_response_endpoint_improper_transfer_function(client):
    resp = client.post("/api/response", json={"num": [1, 2, 3], "den": [1, 1], "response_type": "step"})
    assert resp.status_code == 400
    assert "proper" in resp.get_json()["error"]


def test_response_endpoint_unknown_response_type(client):
    resp = client.post("/api/response", json={"num": [1], "den": [1, 1, 4], "response_type": "ramp"})
    assert resp.status_code == 400
    assert "response_type" in resp.get_json()["error"]


def test_response_endpoint_missing_fields(client):
    resp = client.post("/api/response", json={})
    assert resp.status_code == 400
    assert "error" in resp.get_json()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest test_app.py -v -k response_endpoint`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Add to `app.py`, below the `presets` route. Update the `from flask import ...` line to include `request`:

```python
from flask import Flask, render_template, jsonify, request
```

```python
@app.route("/api/response", methods=["POST"])
def response():
    data = request.get_json(silent=True) or {}
    try:
        result = compute_response(
            data.get("num"), data.get("den"), data.get("response_type")
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
```

Note `compute_response` already raises `ValueError("response_type must be 'step' or 'impulse'")` when `data.get("response_type")` is `None` or invalid (Task 4), and `validate_coefficients` already raises `ValueError` when `data.get("num")`/`data.get("den")` is `None` (fails the `isinstance(num, list)` check in Task 3) — so the missing-fields case is already covered without extra code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest test_app.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app.py test_app.py
git commit -m "feat: add /api/response endpoint with error handling"
```

---

### Task 8: Frontend page skeleton — layout, styling, preset loading, initial chart

**Files:**
- Modify: `templates/index.html`
- Create: `static/style.css`
- Create: `static/app.js`

**Interfaces:**
- Consumes: `GET /api/presets`, `POST /api/response` from Tasks 2 and 7.
- Produces: page structure and element IDs that Task 9 attaches interactivity to: `#num-input`, `#den-input`, `#step-btn`, `#impulse-btn`, `#preset-buttons`, `#chart`, `#unstable-badge`, `#error-banner`, and metric elements `#metric-rise-time`, `#metric-settling-time`, `#metric-overshoot`, `#metric-peak`, `#metric-peak-time`, `#metric-steady-state`. Also produces `renderResponse(data)` (draws chart + metrics + badge) and `loadPreset(preset)` (fills inputs, calls the response endpoint, renders) as functions in `static/app.js`, reused by Task 9.

This task has no automated tests (per spec, frontend is manually verified); each step ends with a manual browser check instead of a pytest run.

- [ ] **Step 1: Write templates/index.html**

Replace the placeholder from Task 1 with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Linear System Response Explorer</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  </head>
  <body>
    <h1>Linear System Response Explorer</h1>

    <div id="preset-buttons" class="preset-row"></div>

    <div class="controls">
      <label>
        Numerator (comma-separated, highest power first)
        <input id="num-input" type="text" value="1" />
      </label>
      <label>
        Denominator (comma-separated, highest power first)
        <input id="den-input" type="text" value="1, 1, 4" />
      </label>
      <div class="toggle-row">
        <button id="step-btn" class="toggle-btn active" type="button">Step</button>
        <button id="impulse-btn" class="toggle-btn" type="button">Impulse</button>
      </div>
    </div>

    <div id="error-banner" class="error-banner hidden"></div>

    <div class="chart-header">
      <span id="unstable-badge" class="unstable-badge hidden">Unstable</span>
    </div>
    <div id="chart"></div>

    <table class="metrics-panel">
      <tr><td>Rise time</td><td id="metric-rise-time">&mdash;</td></tr>
      <tr><td>Settling time</td><td id="metric-settling-time">&mdash;</td></tr>
      <tr><td>Overshoot (%)</td><td id="metric-overshoot">&mdash;</td></tr>
      <tr><td>Peak</td><td id="metric-peak">&mdash;</td></tr>
      <tr><td>Peak time</td><td id="metric-peak-time">&mdash;</td></tr>
      <tr><td>Steady-state value</td><td id="metric-steady-state">&mdash;</td></tr>
    </table>

    <script src="{{ url_for('static', filename='app.js') }}"></script>
  </body>
</html>
```

- [ ] **Step 2: Write static/style.css**

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1rem;
  color: #1a1a1a;
}

.preset-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.preset-row button {
  padding: 0.4rem 0.8rem;
  border: 1px solid #888;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
}

.controls {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 1rem;
}

.controls label {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
  gap: 0.25rem;
}

.controls input {
  padding: 0.4rem;
  font-size: 1rem;
  width: 220px;
}

.toggle-row {
  display: flex;
  gap: 0.25rem;
}

.toggle-btn {
  padding: 0.5rem 1rem;
  border: 1px solid #888;
  background: #f5f5f5;
  cursor: pointer;
}

.toggle-btn.active {
  background: #2b6cb0;
  color: white;
  border-color: #2b6cb0;
}

.error-banner {
  background: #fed7d7;
  color: #822727;
  border: 1px solid #822727;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.error-banner.hidden {
  display: none;
}

.chart-header {
  min-height: 1.5rem;
}

.unstable-badge {
  background: #822727;
  color: white;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.85rem;
}

.unstable-badge.hidden {
  display: none;
}

#chart {
  width: 100%;
  height: 400px;
}

.metrics-panel {
  margin-top: 1rem;
  border-collapse: collapse;
  width: 100%;
  max-width: 400px;
}

.metrics-panel td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #ddd;
}

.metrics-panel td:first-child {
  color: #555;
}

.metrics-panel td:last-child {
  font-weight: 600;
  text-align: right;
}
```

- [ ] **Step 3: Write static/app.js (skeleton + preset loading + initial render)**

```js
const numInput = document.getElementById("num-input");
const denInput = document.getElementById("den-input");
const stepBtn = document.getElementById("step-btn");
const impulseBtn = document.getElementById("impulse-btn");
const presetButtons = document.getElementById("preset-buttons");
const errorBanner = document.getElementById("error-banner");
const unstableBadge = document.getElementById("unstable-badge");

let responseType = "step";

function parseCoeffList(text) {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
}

function formatMetric(value, digits = 3) {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function renderResponse(data) {
  Plotly.react(
    "chart",
    [{ x: data.time, y: data.values, mode: "lines", line: { color: "#2b6cb0" } }],
    {
      margin: { t: 20, r: 20, b: 40, l: 50 },
      xaxis: { title: "Time (s)" },
      yaxis: { title: "Response" },
    },
    { responsive: true }
  );

  document.getElementById("metric-rise-time").textContent = formatMetric(data.metrics.rise_time);
  document.getElementById("metric-settling-time").textContent = formatMetric(data.metrics.settling_time);
  document.getElementById("metric-overshoot").textContent = formatMetric(data.metrics.overshoot_pct, 1);
  document.getElementById("metric-peak").textContent = formatMetric(data.metrics.peak);
  document.getElementById("metric-peak-time").textContent = formatMetric(data.metrics.peak_time);
  document.getElementById("metric-steady-state").textContent = formatMetric(data.metrics.steady_state);

  unstableBadge.classList.toggle("hidden", data.stable);
}

async function fetchAndRender() {
  const num = parseCoeffList(numInput.value);
  const den = parseCoeffList(denInput.value);

  const res = await fetch("/api/response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ num, den, response_type: responseType }),
  });

  const data = await res.json();

  if (!res.ok) {
    showError(data.error);
    return;
  }

  clearError();
  renderResponse(data);
}

function loadPreset(preset) {
  numInput.value = preset.num.join(", ");
  denInput.value = preset.den.join(", ");
  fetchAndRender();
}

async function init() {
  const res = await fetch("/api/presets");
  const presets = await res.json();

  presets.forEach((preset) => {
    const btn = document.createElement("button");
    btn.textContent = preset.name;
    btn.type = "button";
    btn.addEventListener("click", () => loadPreset(preset));
    presetButtons.appendChild(btn);
  });

  const defaultPreset = presets.find((p) => p.name === "Underdamped") || presets[0];
  loadPreset(defaultPreset);
}

init();
```

- [ ] **Step 4: Manually verify in browser**

Run: `python app.py`, open `http://localhost:5000`.

Expected: page loads with title, four preset buttons appear, numerator/denominator inputs are pre-filled with the Underdamped preset's values, and a step-response chart renders automatically with the metrics panel populated (non-"—" values). No console errors in browser devtools.

- [ ] **Step 5: Commit**

```bash
git add templates/index.html static/style.css static/app.js
git commit -m "feat: add frontend page skeleton with preset loading and initial chart render"
```

---

### Task 9: Frontend interactivity — inputs, toggle, debounce, error/unstable states

**Files:**
- Modify: `static/app.js`

**Interfaces:**
- Consumes: `fetchAndRender`, `parseCoeffList`, `renderResponse`, `showError`, `clearError`, `numInput`, `denInput`, `stepBtn`, `impulseBtn`, `responseType` from Task 8.

- [ ] **Step 1: Add debounced input listeners**

Add to the bottom of `static/app.js` (above the `init()` call, or anywhere after the function definitions — but keep the `init();` call as the last line of the file):

```js
let debounceTimer = null;

function onCoefficientInputChanged() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchAndRender, 300);
}

numInput.addEventListener("input", onCoefficientInputChanged);
denInput.addEventListener("input", onCoefficientInputChanged);

stepBtn.addEventListener("click", () => {
  responseType = "step";
  stepBtn.classList.add("active");
  impulseBtn.classList.remove("active");
  fetchAndRender();
});

impulseBtn.addEventListener("click", () => {
  responseType = "impulse";
  impulseBtn.classList.add("active");
  stepBtn.classList.remove("active");
  fetchAndRender();
});
```

Make sure `init();` remains the final statement in the file (move it below this block if it isn't already).

- [ ] **Step 2: Manually verify interactivity in browser**

Run: `python app.py` (restart if already running), open `http://localhost:5000`.

Check each of the following:
1. Type a new denominator (e.g. change `1, 1, 4` to `1, 4, 4`) and wait ~300ms without clicking anything — chart and metrics update automatically, overshoot drops toward 0 (critically damped).
2. Click "Impulse" — chart redraws as an impulse response; Rise time and Settling time show "—"; Peak and Steady-state show numbers.
3. Click "Step" again — chart returns to step response with all six metrics populated.
4. Click each of the four preset buttons — inputs update and chart/metrics update for each.
5. Type an invalid denominator (e.g. `a, b`) — red error banner appears with a message, and the previous chart stays visible (does not clear or blank out).
6. Fix the denominator back to something valid — error banner disappears, chart updates.
7. Click the "Unstable" preset — chart shows a diverging curve over a short time window (not an astronomically large y-axis), and the "Unstable" badge appears next to the chart. Click back to "Underdamped" — badge disappears.

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: add debounced input handling, response-type toggle, and error/unstable UI states"
```

---

### Task 10: README with run instructions

**Files:**
- Create: `README.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Write README.md**

```markdown
# Linear System Response Explorer

A live interactive demo for teaching linear control systems. Enter transfer
function coefficients (or click a preset) and see the step or impulse
response plotted immediately, with rise time, settling time, overshoot,
peak, and steady-state value computed alongside it.

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open `http://localhost:5000` in a browser. For a lecture, project this
browser tab.

## Tests

```bash
pytest test_app.py -v
```

## Notes

- Numerator/denominator coefficients are entered highest power first,
  comma-separated (e.g. `1, 1, 4` for `s^2 + s + 4`).
- Unstable systems are simulated over a short, fixed time window instead of
  the automatic window used for stable systems, and performance metrics are
  not shown (rise time, settling time, etc. aren't well-defined for a
  diverging response).
```

- [ ] **Step 2: Manually verify**

Follow the README's own Setup/Run steps from a clean shell to confirm the instructions are accurate (or re-read them against Tasks 1–9 if the environment is already set up).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and run instructions"
```
