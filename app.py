import math

from flask import Flask, render_template, jsonify, request
import numpy as np
from scipy.signal import residue
import control

app = Flask(__name__)


def _finite(x):
    x = float(x)
    return x if math.isfinite(x) else None

PRESETS = [
    {"name": "Underdamped", "num": [1], "den": [1, 1, 4]},
    {"name": "Critically damped", "num": [1], "den": [1, 4, 4]},
    {"name": "Overdamped", "num": [1], "den": [1, 5, 4]},
    {"name": "Unstable", "num": [1], "den": [1, -1, 4]},
]


def validate_coefficients(num, den):
    if not isinstance(num, list) or not isinstance(den, list) or len(num) == 0 or len(den) == 0:
        raise ValueError("Numerator and denominator must be non-empty lists of numbers")
    try:
        num_f = [float(x) for x in num]
        den_f = [float(x) for x in den]
    except (TypeError, ValueError):
        raise ValueError("Numerator and denominator must contain only numbers")
    if all(c == 0 for c in num_f):
        raise ValueError("Numerator cannot be all zero")
    if all(c == 0 for c in den_f):
        raise ValueError("Denominator cannot be all zero")
    if len(num_f) > len(den_f):
        raise ValueError(
            "Transfer function must be proper (numerator order <= denominator order)"
        )
    return num_f, den_f


_STABILITY_EPS = 1e-8


def classify_stability(den):
    """Classify a denominator's poles as 'stable', 'marginal', or 'unstable'.

    'marginal' covers poles on (or numerically indistinguishable from) the
    imaginary axis -- e.g. an undamped mechanical system -- which neither
    decay nor diverge, and shouldn't be lumped in with truly unstable
    (growing) systems.
    """
    roots = np.roots(den)
    if np.any(roots.real > _STABILITY_EPS):
        return "unstable"
    if np.any(roots.real > -_STABILITY_EPS):
        return "marginal"
    return "stable"


def is_stable(den):
    return classify_stability(den) == "stable"


def capped_time_window(den):
    """Pick a simulation duration for a non-decaying system (marginal or
    unstable), since `control`'s automatic window only makes sense for
    systems that settle.

    Unstable (growing) systems: enough time to show clear divergence,
    scaled to how fast the fastest-growing mode grows.

    Marginal (sustained oscillation) systems: enough time to show several
    full cycles of the *slowest* mode, since a fixed short window can cut
    off before completing even one cycle of a low-frequency oscillation.
    """
    roots = np.roots(den)
    growth_rates = [r.real for r in roots if r.real > _STABILITY_EPS]
    if growth_rates:
        max_growth = max(growth_rates)
        t_final = min(max(5.0 / max_growth, 1.0), 20.0)
    else:
        omegas = [abs(r.imag) for r in roots if abs(r.imag) > _STABILITY_EPS]
        if omegas:
            slowest_period = 2 * math.pi / min(omegas)
            t_final = min(max(4 * slowest_period, 1.0), 60.0)
        else:
            t_final = 5.0
    num_points = int(min(2000, max(300, t_final * 100)))
    return np.linspace(0, t_final, num_points)


def compute_poles_zeros(num_f, den_f):
    """Poles and zeros of G(s) = num_f/den_f, as {"real": float, "imag": float}
    points. A structural property of the transfer function itself --
    independent of response_type and amplitude.
    """
    poles = [{"real": float(r.real), "imag": float(r.imag)} for r in np.roots(den_f)]
    zeros = [{"real": float(r.real), "imag": float(r.imag)} for r in np.roots(num_f)]
    return {"poles": poles, "zeros": zeros}


def validate_amplitude(amplitude):
    try:
        amplitude_f = float(amplitude)
    except (TypeError, ValueError):
        raise ValueError("Amplitude must be a number")
    if not math.isfinite(amplitude_f) or amplitude_f <= 0:
        raise ValueError("Amplitude must be a positive number")
    return amplitude_f


def compute_metrics(sys, t, y, response_type, stable, amplitude):
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
            "rise_time": _finite(info["RiseTime"]),
            "settling_time": _finite(info["SettlingTime"]),
            "overshoot_pct": _finite(info["Overshoot"]),
            "peak": _finite(amplitude * info["Peak"]),
            "peak_time": _finite(info["PeakTime"]),
            "steady_state": _finite(amplitude * info["SteadyStateValue"]),
        }
    # y is already scaled by amplitude, so these read straight off it.
    idx = int(np.argmax(np.abs(y)))
    return {
        "rise_time": None,
        "settling_time": None,
        "overshoot_pct": None,
        "peak": _finite(y[idx]),
        "peak_time": _finite(t[idx]),
        "steady_state": _finite(y[-1]),
    }


MAX_DECOMPOSITION_MODES = 7


def compute_step_components(num_f, den_f, amplitude, t):
    """Partial-fraction decomposition of the step response amplitude*G(s)/s.

    Returns a list of {"label": str, "values": list[float]} dicts whose
    elementwise sum equals the step response at each point in `t`. Uncapped:
    callers that want to limit how many modes are displayed (see
    MAX_DECOMPOSITION_MODES) apply that themselves.
    """
    t = np.asarray(t, dtype=float)

    b = [amplitude * c for c in num_f]
    a = np.convolve(den_f, [1.0, 0.0])  # multiply the denominator by s
    r, p, _k = residue(b, a)

    # scipy orders repeated poles consecutively, with residues ascending by
    # power (r[0] -> power 1, r[1] -> power 2, ...).
    groups = []
    i = 0
    n = len(p)
    while i < n:
        j = i
        while j + 1 < n and abs(p[j + 1] - p[i]) < 1e-6 * max(1.0, abs(p[i])):
            j += 1
        groups.append((p[i], list(r[i : j + 1])))
        i = j + 1

    raw = []
    for pole, residues_ascending in groups:
        y = np.zeros_like(t, dtype=complex)
        for order, res in enumerate(residues_ascending, start=1):
            y = y + res * (t ** (order - 1)) / math.factorial(order - 1) * np.exp(pole * t)
        raw.append((pole, y))

    # Combine complex-conjugate pole pairs into one real trace each.
    used = [False] * len(raw)
    combined = []
    for i, (pole, y) in enumerate(raw):
        if used[i]:
            continue
        if abs(pole.imag) < 1e-8:
            combined.append((pole, y.real))
            used[i] = True
            continue
        partner = None
        for j in range(i + 1, len(raw)):
            if used[j]:
                continue
            other_pole, other_y = raw[j]
            if abs(other_pole - pole.conjugate()) < 1e-6 * max(1.0, abs(pole)):
                partner = j
                break
        if partner is not None:
            combined.append((pole, (y + raw[partner][1]).real))
            used[i] = True
            used[partner] = True
        else:
            combined.append((pole, y.real))
            used[i] = True

    def sort_key(item):
        pole, _ = item
        is_steady_state = abs(pole) < 1e-8
        return (0 if is_steady_state else 1, -pole.real)

    combined.sort(key=sort_key)

    components = []
    for pole, values in combined:
        # Clean up floating-point noise in the real part (e.g. a pole that's
        # mathematically exactly on the imaginary axis, like an undamped
        # system, still comes back from root-finding as ~1e-17, not exactly
        # 0) so labels never show noise like "5.38e-17".
        real_part = 0.0 if abs(pole.real) < 1e-6 * max(1.0, abs(pole)) else pole.real
        if abs(pole) < 1e-8:
            label = "Steady-state"
        elif abs(pole.imag) < 1e-8:
            label = f"Mode: pole at s = {real_part:.3g}"
        else:
            label = f"Mode: poles at s = {real_part:.3g} ± {abs(pole.imag):.3g}i"
        components.append({"label": label, "values": [_finite(v) for v in values]})

    return components


def compute_response(num, den, response_type, amplitude=1.0):
    if response_type not in ("step", "impulse"):
        raise ValueError("response_type must be 'step' or 'impulse'")
    amplitude_f = validate_amplitude(amplitude)
    num_f, den_f = validate_coefficients(num, den)
    sys = control.TransferFunction(num_f, den_f)
    stability = classify_stability(den_f)
    stable = stability == "stable"

    T = None if stable else capped_time_window(den_f)

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

    y_scaled = np.asarray(y) * amplitude_f
    metrics = compute_metrics(sys, t, y_scaled, response_type, stable, amplitude_f)

    decomposition = None
    if response_type == "step":
        components = compute_step_components(num_f, den_f, amplitude_f, t)
        decomposition = {
            "components": components if len(components) <= MAX_DECOMPOSITION_MODES else None,
            "mode_count": len(components),
        }

    return {
        "time": np.asarray(t).tolist(),
        "values": y_scaled.tolist(),
        "stable": stable,
        "stability": stability,
        "metrics": metrics,
        "decomposition": decomposition,
        "poles_zeros": compute_poles_zeros(num_f, den_f),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/presets")
def presets():
    return jsonify(PRESETS)


@app.route("/api/response", methods=["POST"])
def response():
    data = request.get_json(silent=True) or {}
    try:
        result = compute_response(
            data.get("num"),
            data.get("den"),
            data.get("response_type"),
            data.get("amplitude", 1.0),
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True)
