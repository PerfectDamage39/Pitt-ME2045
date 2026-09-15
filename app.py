import cmath
import math
import re
import warnings

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


def validate_duration(duration):
    try:
        duration_f = float(duration)
    except (TypeError, ValueError):
        raise ValueError("Duration must be a number")
    if not math.isfinite(duration_f) or duration_f <= 0:
        raise ValueError("Duration must be a positive number")
    return duration_f


def fixed_time_window(duration):
    """Simulation time array spanning exactly [0, duration], for callers
    (like the 2nd-Order System tab) that pin the chart's x-axis to a fixed
    range and need the response data to fill it rather than stopping
    wherever `control`'s own auto-duration heuristic decides to.
    """
    num_points = int(min(2000, max(300, duration * 100)))
    return np.linspace(0, duration, num_points)


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


def compute_response(num, den, response_type, amplitude=1.0, duration=None):
    if response_type not in ("step", "impulse"):
        raise ValueError("response_type must be 'step' or 'impulse'")
    amplitude_f = validate_amplitude(amplitude)
    num_f, den_f = validate_coefficients(num, den)
    sys = control.TransferFunction(num_f, den_f)
    stability = classify_stability(den_f)
    stable = stability == "stable"

    if duration is not None:
        T = fixed_time_window(validate_duration(duration))
    elif not stable:
        T = capped_time_window(den_f)
    else:
        T = None

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


ROOT_LOCUS_PRESETS = [
    {"name": "K/(s(s+2))", "poles": "0, -2", "zeros": ""},
    {"name": "K(s+1)/(s(s+2))", "poles": "0, -2", "zeros": "-1"},
    {"name": "K/((s+2)(s+4))", "poles": "-2, -4", "zeros": ""},
    {"name": "4 poles, 1 zero", "poles": "-1, -2, -3, -4", "zeros": "-0.2"},
    {"name": "4 poles, 3 zeros", "poles": "-1, -2, -3, -4", "zeros": "-0.2, -1±1j"},
]

_BARE_J = re.compile(r"(?<![0-9.])j")


def parse_complex_list(text, label):
    """Parse a comma-separated list of real/complex numbers.

    Accepts what students actually write: '0', '-2', '-1+1j', '-1-2i',
    a bare 'j' meaning 1j, and '-1±1j' as shorthand for the conjugate
    pair '-1+1j, -1-1j' (conjugates always come as a pair, so typing
    both halves separately is just an opportunity to mistype one).
    """
    if text is None:
        return []
    if not isinstance(text, str):
        raise ValueError(f"{label} must be text")

    values = []
    for raw in text.split(","):
        entry = raw.strip()
        if not entry:
            continue
        halves = entry.split("±") if "±" in entry else [entry]
        if len(halves) > 2:
            raise ValueError(f"Could not read '{entry}' in {label}")
        if len(halves) == 2:
            candidates = [f"{halves[0]}+{halves[1]}", f"{halves[0]}-{halves[1]}"]
        else:
            candidates = halves

        for candidate in candidates:
            cleaned = candidate.replace(" ", "").replace("i", "j").replace("J", "j")
            cleaned = _BARE_J.sub("1j", cleaned)
            try:
                parsed = complex(cleaned)
            except ValueError:
                raise ValueError(f"Could not read '{entry}' in {label} as a number")
            if not (math.isfinite(parsed.real) and math.isfinite(parsed.imag)):
                raise ValueError(f"{label} must contain only finite numbers")
            values.append(parsed)

    return values


def _as_points(values):
    return [{"real": float(v.real), "imag": float(v.imag)} for v in values]


def polynomial_from_roots(roots):
    """Monic polynomial with the given roots, as real coefficients.

    Root lists that are closed under conjugation give a real polynomial;
    tiny imaginary residue from the multiplication is numerical noise.
    """
    if not roots:
        return np.array([1.0])
    coeffs = np.poly(np.asarray(roots, dtype=complex))
    return np.real_if_close(coeffs, tol=1000).astype(float)


def closed_loop_denominator(num, den, gain):
    """Characteristic polynomial den(s) + K*num(s)."""
    padded = np.concatenate([np.zeros(len(den) - len(num)), np.asarray(num, dtype=float)])
    return np.asarray(den, dtype=float) + gain * padded


def compute_asymptotes(poles, zeros):
    """Rules 5-6: angles (2n+1)*180/(n_p-n_z) about the centroid."""
    order = len(poles) - len(zeros)
    if order <= 0:
        return None
    centroid = (sum(p.real for p in poles) - sum(z.real for z in zeros)) / order
    angles = [(2 * n + 1) * 180.0 / order for n in range(order)]
    return {"angles": angles, "centroid": float(centroid), "count": order}


def compute_real_axis_segments(poles, zeros):
    """Rule 4: the locus covers real-axis stretches with an odd number of
    real poles and zeros (counted with multiplicity) strictly to the right.

    Each segment is {"from": right end, "to": left end}, where a null left
    end means the segment runs to negative infinity.
    """
    reals = [p.real for p in poles if abs(p.imag) <= _STABILITY_EPS]
    reals += [z.real for z in zeros if abs(z.imag) <= _STABILITY_EPS]
    if not reals:
        return []

    distinct = sorted(set(round(r, 9) for r in reals), reverse=True)
    segments = []
    passed = 0
    for i, value in enumerate(distinct):
        passed += sum(1 for r in reals if round(r, 9) == value)
        if passed % 2 == 1:
            left = distinct[i + 1] if i + 1 < len(distinct) else None
            segments.append({"from": float(value), "to": None if left is None else float(left)})
    return segments


def _on_real_axis_segment(value, segments):
    for seg in segments:
        left = seg["to"]
        if value <= seg["from"] + 1e-9 and (left is None or value >= left - 1e-9):
            return True
    return False


def compute_breakaway_points(num, den, segments):
    """Points where branches meet and leave (or rejoin) the real axis.

    On the locus K(s) = -den(s)/num(s), and branches break away exactly
    where dK/ds = 0, i.e. den'(s)num(s) - den(s)num'(s) = 0.
    """
    expr = np.polysub(np.polymul(np.polyder(den), num), np.polymul(den, np.polyder(num)))
    expr = np.trim_zeros(np.asarray(expr, dtype=float), "f")
    if len(expr) < 2:
        return []

    points = []
    for root in np.roots(expr):
        if abs(root.imag) > 1e-6:
            continue
        s = float(root.real)
        if not _on_real_axis_segment(s, segments):
            continue
        num_at = float(np.polyval(num, s))
        if abs(num_at) < 1e-12:
            continue
        gain = -float(np.polyval(den, s)) / num_at
        if gain <= 1e-9:
            continue
        if any(abs(s - p["real"]) < 1e-6 for p in points):
            continue
        points.append({"real": s, "imag": 0.0, "gain": gain})

    return sorted(points, key=lambda p: p["real"], reverse=True)


def _max_real_part(num, den, gain):
    return float(np.roots(closed_loop_denominator(num, den, gain)).real.max())


def compute_jw_crossing(num, den, search_ceiling=1e7):
    """Smallest positive K at which a closed-loop pole reaches the
    imaginary axis -- the maximum stable gain (lecture Section 9).

    Returns None when the loop never crosses over within the search
    range, or when it is already unstable at K=0.
    """
    if _max_real_part(num, den, 0.0) > _STABILITY_EPS:
        return None

    lo = 0.0
    hi = None
    probe = 1e-3
    while probe <= search_ceiling:
        if _max_real_part(num, den, probe) > 0:
            hi = probe
            break
        lo = probe
        probe *= 1.6
    if hi is None:
        return None

    for _ in range(200):
        mid = (lo + hi) / 2
        if _max_real_part(num, den, mid) > 0:
            hi = mid
        else:
            lo = mid

    roots = np.roots(closed_loop_denominator(num, den, lo))
    crossing = max(roots, key=lambda r: r.real)
    return {"gain": float(lo), "omega": float(abs(crossing.imag))}


def choose_gain_ceiling(num, den, crossing):
    """Top of the gain slider: far enough past the interesting behaviour
    to see where the branches are heading.
    """
    if crossing is not None and crossing["gain"] > 0:
        return crossing["gain"] * 2.0

    spread = max([abs(r) for r in np.roots(den)] + [1.0])
    gain = 1.0
    for _ in range(80):
        reach = max(abs(r) for r in np.roots(closed_loop_denominator(num, den, gain)))
        if reach > 5 * spread:
            return gain
        gain *= 2.0
    return gain


ROOT_LOCUS_SAMPLES = 400


def compute_root_locus(poles_text, zeros_text):
    return compute_root_locus_from_points(
        parse_complex_list(poles_text, "Poles"),
        parse_complex_list(zeros_text, "Zeros"),
    )


def compute_root_locus_from_points(poles, zeros):
    if not poles:
        raise ValueError("Enter at least one open-loop pole")
    if len(zeros) > len(poles):
        raise ValueError(
            "Loop gain must be proper (no more open-loop zeros than poles)"
        )

    num = polynomial_from_roots(zeros)
    den = polynomial_from_roots(poles)

    crossing = compute_jw_crossing(num, den)
    ceiling = choose_gain_ceiling(num, den, crossing)
    gains = np.concatenate(
        [[0.0], np.logspace(math.log10(ceiling) - 4, math.log10(ceiling), ROOT_LOCUS_SAMPLES)]
    )

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        locus = control.root_locus_map(control.TransferFunction(num, den), gains)
    loci = np.asarray(locus.loci)

    branches = [
        [{"real": float(p.real), "imag": float(p.imag)} for p in loci[:, i]]
        for i in range(loci.shape[1])
    ]

    segments = compute_real_axis_segments(poles, zeros)

    return {
        "poles": _as_points(poles),
        "zeros": _as_points(zeros),
        "num": [float(c) for c in num],
        "den": [float(c) for c in den],
        "gains": [float(g) for g in gains],
        "branches": branches,
        "asymptotes": compute_asymptotes(poles, zeros),
        "real_axis_segments": segments,
        "breakaway_points": compute_breakaway_points(num, den, segments),
        "jw_crossing": crossing,
    }


COMPENSATOR_PRESETS = [
    {"name": "K/(s(s+4)(s+6))", "poles": "0, -4, -6", "zeros": "", "overshoot": 30, "target_ts": 1.99},
    {"name": "K/(s(s+2))", "poles": "0, -2", "zeros": "", "overshoot": 20, "target_ts": 2.0},
    {"name": "K/(s(s+1)(s+5))", "poles": "0, -1, -5", "zeros": "", "overshoot": 25, "target_ts": 3.0},
]


def zeta_from_overshoot(percent_overshoot):
    """Damping ratio that produces a given percent overshoot, from
    PO = 100*exp(-zeta*pi/sqrt(1-zeta^2)) solved for zeta.
    """
    try:
        po = float(percent_overshoot)
    except (TypeError, ValueError):
        raise ValueError("Percent overshoot must be a number")
    if not math.isfinite(po) or po <= 0 or po >= 100:
        raise ValueError("Percent overshoot must be between 0 and 100")
    ln_po = math.log(po / 100.0)
    return -ln_po / math.sqrt(math.pi**2 + ln_po**2)


def _angle_deg(s, point):
    """Angle of the vector running from a pole/zero up to the test point."""
    return math.degrees(cmath.phase(s - point))


def loop_angle_at(s, poles, zeros):
    """Total angle of the loop gain: zero angles add, pole angles subtract.

    Deliberately left unwrapped -- the running total is what gets compared
    against -180, and wrapping each term would destroy the monotonic
    behaviour the zeta-ray search depends on.
    """
    return sum(_angle_deg(s, z) for z in zeros) - sum(_angle_deg(s, p) for p in poles)


def loop_magnitude_at(s, poles, zeros):
    magnitude = 1.0
    for z in zeros:
        magnitude *= abs(s - z)
    for p in poles:
        magnitude /= abs(s - p)
    return magnitude


def gain_at(s, poles, zeros):
    """Gain that puts a closed-loop pole at s, from the magnitude criterion."""
    magnitude = loop_magnitude_at(s, poles, zeros)
    if magnitude <= 0:
        raise ValueError("Could not evaluate the loop gain at that point")
    return 1.0 / magnitude


def find_locus_point_on_zeta_ray(poles, zeros, zeta):
    """Walk out along the constant-damping ray until the angle criterion
    closes -- the operating point proportional control alone would give.
    """
    direction = complex(-zeta, math.sqrt(1 - zeta**2))

    radii = np.logspace(-4, 4, 900)
    previous_r = None
    previous_angle = None
    for r in radii:
        angle = loop_angle_at(r * direction, poles, zeros)
        if previous_angle is not None and previous_angle > -180 >= angle:
            lo, hi = previous_r, r
            for _ in range(200):
                mid = (lo + hi) / 2
                if loop_angle_at(mid * direction, poles, zeros) > -180:
                    lo = mid
                else:
                    hi = mid
            return lo * direction
        previous_r = r
        previous_angle = angle

    raise ValueError(
        "The uncompensated locus never crosses that damping ratio — "
        "try a different overshoot spec or plant"
    )


def solve_compensator(sd, deficiency_deg, kind, zero_location=None):
    """Place the compensator so it supplies exactly the missing angle.

    PD contributes a single zero, so its location is forced: one unknown,
    one angle equation. Lead adds a pole as well, which is why the zero can
    be chosen freely and the pole then takes back the surplus -- the
    "infinite number of combinations" the lecture notes point at.
    """
    sigma = -sd.real
    omega_d = sd.imag

    if deficiency_deg <= 0:
        raise ValueError(
            "The target pole needs no added phase — it already sits on (or "
            "inside) the uncompensated locus, so no lead compensator is needed"
        )
    if deficiency_deg >= 180:
        raise ValueError(
            f"The target pole needs {deficiency_deg:.1f}° of phase, which a "
            "single lead section cannot supply"
        )

    if kind == "pd":
        zero = sigma + omega_d / math.tan(math.radians(deficiency_deg))
        return {
            "kind": "pd",
            "zero": float(zero),
            "pole": None,
            "theta_zero": float(deficiency_deg),
            "theta_pole": None,
        }

    if zero_location is None:
        # Any zero inside the PD bound works; start comfortably inside it so
        # the compensator pole lands somewhere finite and readable.
        pd_zero = sigma + omega_d / math.tan(math.radians(deficiency_deg))
        zero_location = 0.8 * pd_zero
    try:
        zero = float(zero_location)
    except (TypeError, ValueError):
        raise ValueError("Compensator zero must be a number")
    if not math.isfinite(zero) or zero <= 0:
        raise ValueError("Compensator zero must be a positive distance from the origin")

    theta_zero = math.degrees(math.atan2(omega_d, zero - sigma))
    theta_pole = theta_zero - deficiency_deg
    if theta_pole <= 0:
        raise ValueError(
            f"A zero at s = -{zero:.3g} only supplies {theta_zero:.1f}°, short of "
            f"the {deficiency_deg:.1f}° needed — move the zero closer to the origin"
        )

    pole = sigma + omega_d / math.tan(math.radians(theta_pole))
    return {
        "kind": "lead",
        "zero": float(zero),
        "pole": float(pole),
        "theta_zero": float(theta_zero),
        "theta_pole": float(theta_pole),
    }


def compute_compensator_design(
    poles_text, zeros_text, percent_overshoot, target_ts, kind, zero_location=None
):
    plant_poles = parse_complex_list(poles_text, "Poles")
    plant_zeros = parse_complex_list(zeros_text, "Zeros")
    if not plant_poles:
        raise ValueError("Enter at least one plant pole")
    if kind not in ("pd", "lead"):
        raise ValueError("Compensator type must be 'pd' or 'lead'")

    try:
        ts_target = float(target_ts)
    except (TypeError, ValueError):
        raise ValueError("Target settling time must be a number")
    if not math.isfinite(ts_target) or ts_target <= 0:
        raise ValueError("Target settling time must be positive")

    zeta = zeta_from_overshoot(percent_overshoot)

    # Step 1 -- where proportional control alone puts us.
    s_now = find_locus_point_on_zeta_ray(plant_poles, plant_zeros, zeta)
    ts_now = 4.0 / abs(s_now.real)

    # Step 2 -- where the spec says we want to be.
    sigma = 4.0 / ts_target
    omega_d = sigma * math.sqrt(1 - zeta**2) / zeta
    sd = complex(-sigma, omega_d)

    # Step 3 -- how much angle the plant is short at that point.
    contributions = [
        {"kind": "zero", "at": _as_points([z])[0], "angle": _angle_deg(sd, z)}
        for z in plant_zeros
    ] + [
        {"kind": "pole", "at": _as_points([p])[0], "angle": _angle_deg(sd, p)}
        for p in plant_poles
    ]
    plant_angle = loop_angle_at(sd, plant_poles, plant_zeros)
    deficiency = -180.0 - plant_angle

    # Step 4 -- place the compensator to supply exactly that.
    compensator = solve_compensator(sd, deficiency, kind, zero_location)
    # PD is the limiting case of lead as the compensator pole runs to
    # infinity, so the PD zero is exactly the upper bound on a lead zero.
    compensator["zero_limit"] = solve_compensator(sd, deficiency, "pd")["zero"]

    compensated_poles = list(plant_poles)
    compensated_zeros = list(plant_zeros) + [complex(-compensator["zero"], 0)]
    if compensator["pole"] is not None:
        compensated_poles = compensated_poles + [complex(-compensator["pole"], 0)]

    compensator["gain"] = gain_at(sd, compensated_poles, compensated_zeros)

    return {
        "zeta": zeta,
        "current": {
            "pole": {"real": float(s_now.real), "imag": float(s_now.imag)},
            "gain": gain_at(s_now, plant_poles, plant_zeros),
            "settling_time": ts_now,
        },
        "target": {
            "pole": {"real": float(sd.real), "imag": float(sd.imag)},
            "settling_time": ts_target,
            "sigma": sigma,
            "omega_d": omega_d,
        },
        "contributions": contributions,
        "plant_angle": plant_angle,
        "deficiency": deficiency,
        "compensator": compensator,
        "uncompensated": compute_root_locus_from_points(plant_poles, plant_zeros),
        "compensated": compute_root_locus_from_points(compensated_poles, compensated_zeros),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/presets")
def presets():
    return jsonify(PRESETS)


@app.route("/api/root-locus-presets")
def root_locus_presets():
    return jsonify(ROOT_LOCUS_PRESETS)


@app.route("/api/compensator-presets")
def compensator_presets():
    return jsonify(COMPENSATOR_PRESETS)


@app.route("/api/compensator-design", methods=["POST"])
def compensator_design():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(
            compute_compensator_design(
                data.get("poles"),
                data.get("zeros"),
                data.get("overshoot"),
                data.get("target_ts"),
                data.get("kind"),
                data.get("zero_location"),
            )
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/root-locus", methods=["POST"])
def root_locus():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(compute_root_locus(data.get("poles"), data.get("zeros")))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/response", methods=["POST"])
def response():
    data = request.get_json(silent=True) or {}
    try:
        result = compute_response(
            data.get("num"),
            data.get("den"),
            data.get("response_type"),
            data.get("amplitude", 1.0),
            data.get("duration"),
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    app.run(debug=True)
