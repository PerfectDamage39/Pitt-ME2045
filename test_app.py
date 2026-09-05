import json
import warnings

import pytest

import numpy as np

from app import (
    app,
    validate_coefficients,
    is_stable,
    classify_stability,
    capped_time_window,
    compute_response,
    validate_amplitude,
    compute_step_components,
    compute_poles_zeros,
    parse_complex_list,
    polynomial_from_roots,
    compute_root_locus,
)


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_index_page_loads(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"ME 2045 Controls Lab" in response.data


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


def test_compute_response_unstable_system_capped_window():
    result = compute_response([1], [1, -1, 4], "step")
    assert result["stable"] is False
    assert result["stability"] == "unstable"
    # den=[1,-1,4] has poles at 0.5 +/- 1.94i -> growth rate 0.5 ->
    # T_final = min(max(5/0.5, 1), 20) = 10.0 exactly
    assert max(result["time"]) == pytest.approx(10.0)
    # all metrics are null when unstable
    for value in result["metrics"].values():
        assert value is None
    # values should not be empty and should show growth
    assert len(result["values"]) > 1


def test_compute_response_unstable_system_impulse_also_capped():
    result = compute_response([1], [1, -1, 4], "impulse")
    assert result["stable"] is False
    assert result["stability"] == "unstable"
    assert max(result["time"]) == pytest.approx(10.0)


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


def test_compute_response_zero_dc_gain_settling_time_is_none_not_nan():
    # num=[1, 0], den=[1, 1, 4] -> s/(s^2+s+4), a differentiator with zero DC
    # gain. control.step_info() returns NaN for SettlingTime here; the
    # metrics helper must convert that to None, never leak a NaN float.
    # control.step_info() itself divides by the (zero) DC gain internally
    # and emits a RuntimeWarning as an unavoidable side effect of computing
    # that NaN -- expected here, not something our code introduces.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        result = compute_response([1, 0], [1, 1, 4], "step")
    assert result["metrics"]["settling_time"] is None

    # The full result must round-trip cleanly through JSON: no NaN token
    # should ever reach json.dumps/jsonify.
    serialized = json.dumps(result)
    assert "NaN" not in serialized
    round_tripped = json.loads(serialized)
    assert round_tripped["metrics"]["settling_time"] is None


def test_response_endpoint_rejects_all_zero_numerator(client):
    resp = client.post(
        "/api/response",
        json={"num": [0], "den": [1, 1, 4], "response_type": "step"},
    )
    assert resp.status_code == 400
    error = resp.get_json()["error"]
    assert "zero" in error.lower()
    assert "reduction" not in error.lower()
    assert "identity" not in error.lower()


def test_validate_amplitude_accepts_positive_number():
    assert validate_amplitude(2) == 2.0
    assert validate_amplitude("0.5") == 0.5


def test_validate_amplitude_rejects_zero():
    with pytest.raises(ValueError, match="positive"):
        validate_amplitude(0)


def test_validate_amplitude_rejects_negative():
    with pytest.raises(ValueError, match="positive"):
        validate_amplitude(-3)


def test_validate_amplitude_rejects_non_numeric():
    with pytest.raises(ValueError, match="number"):
        validate_amplitude("not-a-number")


def test_compute_response_step_scales_values_and_metrics_by_amplitude():
    unit = compute_response([1], [1, 1, 4], "step")
    scaled = compute_response([1], [1, 1, 4], "step", amplitude=2.0)

    assert scaled["values"][-1] == pytest.approx(2.0 * unit["values"][-1])
    assert scaled["metrics"]["peak"] == pytest.approx(2.0 * unit["metrics"]["peak"])
    assert scaled["metrics"]["steady_state"] == pytest.approx(
        2.0 * unit["metrics"]["steady_state"]
    )
    # time-based and percentage metrics are unaffected by amplitude
    assert scaled["metrics"]["rise_time"] == pytest.approx(unit["metrics"]["rise_time"])
    assert scaled["metrics"]["settling_time"] == pytest.approx(
        unit["metrics"]["settling_time"]
    )
    assert scaled["metrics"]["peak_time"] == pytest.approx(unit["metrics"]["peak_time"])
    assert scaled["metrics"]["overshoot_pct"] == pytest.approx(
        unit["metrics"]["overshoot_pct"]
    )


def test_compute_response_impulse_scales_values_and_metrics_by_amplitude():
    unit = compute_response([1], [1, 1, 4], "impulse")
    scaled = compute_response([1], [1, 1, 4], "impulse", amplitude=3.0)

    assert scaled["metrics"]["peak"] == pytest.approx(3.0 * unit["metrics"]["peak"])
    assert scaled["metrics"]["peak_time"] == pytest.approx(unit["metrics"]["peak_time"])


def test_compute_response_default_amplitude_is_one():
    default = compute_response([1], [1, 1, 4], "step")
    explicit = compute_response([1], [1, 1, 4], "step", amplitude=1.0)
    assert default["values"] == pytest.approx(explicit["values"])


def test_compute_response_rejects_invalid_amplitude():
    with pytest.raises(ValueError, match="positive"):
        compute_response([1], [1, 1, 4], "step", amplitude=0)


def test_response_endpoint_accepts_amplitude(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 1, 4], "response_type": "step", "amplitude": 5},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["metrics"]["steady_state"] == pytest.approx(5 * 0.25, abs=0.05 * 5)


def test_response_endpoint_defaults_amplitude_when_omitted(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 1, 4], "response_type": "step"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["metrics"]["steady_state"] == pytest.approx(0.25, abs=0.05)


def test_response_endpoint_rejects_invalid_amplitude(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 1, 4], "response_type": "step", "amplitude": -1},
    )
    assert resp.status_code == 400
    assert "positive" in resp.get_json()["error"]


def test_compute_step_components_sum_matches_response_underdamped():
    result = compute_response([1], [1, 1, 4], "step")
    components = compute_step_components([1.0], [1.0, 1.0, 4.0], 1.0, result["time"])
    assert components is not None
    total = np.sum([c["values"] for c in components], axis=0)
    assert total == pytest.approx(result["values"], abs=1e-6)


def test_compute_step_components_sum_matches_response_overdamped():
    result = compute_response([1], [1, 5, 4], "step")
    components = compute_step_components([1.0], [1.0, 5.0, 4.0], 1.0, result["time"])
    assert components is not None
    total = np.sum([c["values"] for c in components], axis=0)
    assert total == pytest.approx(result["values"], abs=1e-6)
    # steady-state + two distinct real poles
    assert len(components) == 3


def test_compute_step_components_sum_matches_response_critically_damped():
    result = compute_response([1], [1, 4, 4], "step")
    components = compute_step_components([1.0], [1.0, 4.0, 4.0], 1.0, result["time"])
    assert components is not None
    total = np.sum([c["values"] for c in components], axis=0)
    assert total == pytest.approx(result["values"], abs=1e-6)
    # steady-state + one repeated real pole, combined into a single trace
    assert len(components) == 2


def test_compute_step_components_underdamped_has_steady_state_and_one_mode():
    result = compute_response([1], [1, 1, 4], "step")
    components = compute_step_components([1.0], [1.0, 1.0, 4.0], 1.0, result["time"])
    # steady-state + one combined complex-conjugate-pair mode
    assert len(components) == 2
    labels = [c["label"] for c in components]
    assert "Steady-state" in labels


def test_compute_step_components_scales_with_amplitude():
    t = [0.0, 0.5, 1.0, 2.0]
    unit = compute_step_components([1.0], [1.0, 1.0, 4.0], 1.0, t)
    scaled = compute_step_components([1.0], [1.0, 1.0, 4.0], 3.0, t)
    for u, s in zip(unit, scaled):
        assert np.array(s["values"]) == pytest.approx(3.0 * np.array(u["values"]))


def test_compute_step_components_unstable_still_sums_correctly():
    result = compute_response([1], [1, -1, 4], "step")
    components = compute_step_components([1.0], [1.0, -1.0, 4.0], 1.0, result["time"])
    assert components is not None
    total = np.sum([c["values"] for c in components], axis=0)
    assert total == pytest.approx(result["values"], abs=1e-3)


def test_compute_step_components_returns_all_modes_uncapped():
    # 8 distinct real poles -> 9 total modes including the steady-state term.
    # compute_step_components itself is uncapped; the response-level cap
    # (MAX_DECOMPOSITION_MODES) is applied by compute_response, not here.
    den = np.poly([-1, -2, -3, -4, -5, -6, -7, -8]).tolist()
    t = np.linspace(0, 5, 50).tolist()
    components = compute_step_components([1.0], den, 1.0, t)
    assert len(components) == 9


def test_compute_response_omits_components_when_over_the_cap():
    den = np.poly([-1, -2, -3, -4, -5, -6, -7, -8]).tolist()
    result = compute_response([1], den, "step")
    assert result["decomposition"]["components"] is None
    assert result["decomposition"]["mode_count"] == 9


def test_compute_response_includes_decomposition_for_step():
    result = compute_response([1], [1, 1, 4], "step")
    assert result["decomposition"]["components"] is not None
    assert result["decomposition"]["mode_count"] == 2


def test_compute_response_decomposition_is_none_for_impulse():
    result = compute_response([1], [1, 1, 4], "impulse")
    assert result["decomposition"] is None


def test_response_endpoint_includes_decomposition(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 1, 4], "response_type": "step"},
    )
    data = resp.get_json()
    assert data["decomposition"]["components"] is not None
    assert len(data["decomposition"]["components"]) == 2


def test_response_endpoint_decomposition_null_for_impulse(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 1, 4], "response_type": "impulse"},
    )
    data = resp.get_json()
    assert data["decomposition"] is None


def test_classify_stability_stable_for_negative_real_part_poles():
    assert classify_stability([1, 4, 4]) == "stable"


def test_classify_stability_unstable_for_positive_real_part_pole():
    assert classify_stability([1, -1, 4]) == "unstable"


def test_classify_stability_marginal_for_undamped_two_mass_system():
    # s^4 + 3s^2 + 1 (m=1, k=1 undamped two-mass-two-spring system): all
    # four poles are purely imaginary (no damper -> sustained oscillation,
    # never decays, never diverges).
    assert classify_stability([1, 0, 3, 0, 1]) == "marginal"


def test_classify_stability_marginal_for_pure_integrator():
    # A single pole exactly at the origin (s) is also marginal, not unstable.
    assert classify_stability([1, 0]) == "marginal"


def test_is_stable_matches_classify_stability_stable_case():
    assert is_stable([1, 4, 4]) is True


def test_is_stable_false_for_marginal_case():
    # is_stable stays a strict boolean: only "stable" is True; "marginal"
    # and "unstable" both read as False (metrics stay null for either).
    assert is_stable([1, 0, 3, 0, 1]) is False


def test_capped_time_window_unstable_uses_growth_rate():
    # den=[1,-1,4]: poles at 0.5 +/- 1.94i, growth rate 0.5 ->
    # T_final = min(max(5/0.5, 1), 20) = 10.0
    t = capped_time_window([1, -1, 4])
    assert max(t) == pytest.approx(10.0)


def test_capped_time_window_clamps_very_fast_growth_to_minimum():
    den = np.poly([-1, 100]).tolist()  # growth rate 100 -> 5/100=0.05, clamp to 1.0
    t = capped_time_window(den)
    assert max(t) == pytest.approx(1.0)


def test_capped_time_window_clamps_very_slow_growth_to_maximum():
    den = np.poly([-1, 0.01]).tolist()  # growth rate 0.01 -> 5/0.01=500, clamp to 20.0
    t = capped_time_window(den)
    assert max(t) == pytest.approx(20.0)


def test_capped_time_window_marginal_shows_several_cycles_of_slowest_mode():
    # den=[1,0,3,0,1]: slowest mode omega=0.618 rad/s, period ~10.17s;
    # window should show ~4 cycles of it: T_final = 4*10.166 = 40.665...
    t = capped_time_window([1, 0, 3, 0, 1])
    assert max(t) == pytest.approx(4 * 2 * np.pi / 0.6180339887, rel=1e-3)


def test_capped_time_window_marginal_clamps_very_high_frequency_to_minimum():
    den = [1, 0, 1000]  # omega=31.6 rad/s, period tiny -> clamp to 1.0
    t = capped_time_window(den)
    assert max(t) == pytest.approx(1.0)


def test_capped_time_window_marginal_clamps_very_low_frequency_to_maximum():
    den = [1, 0, 0.001]  # omega=0.0316 rad/s, period huge -> clamp to 60.0
    t = capped_time_window(den)
    assert max(t) == pytest.approx(60.0)


def test_compute_response_includes_stability_field_for_all_three_classes():
    stable = compute_response([1], [1, 4, 4], "step")
    marginal = compute_response([1], [1, 0, 3, 0, 1], "step")
    unstable = compute_response([1], [1, -1, 4], "step")
    assert stable["stability"] == "stable"
    assert marginal["stability"] == "marginal"
    assert unstable["stability"] == "unstable"
    assert stable["stable"] is True
    assert marginal["stable"] is False
    assert unstable["stable"] is False


def test_response_endpoint_includes_stability_field(client):
    resp = client.post(
        "/api/response",
        json={"num": [1], "den": [1, 0, 3, 0, 1], "response_type": "step"},
    )
    assert resp.get_json()["stability"] == "marginal"


def test_compute_step_components_cleans_up_near_zero_pole_real_part():
    # For the undamped two-mass system the poles are numerically ~1e-17,
    # not exactly 0. Labels must show a clean "0", never float noise like
    # "5.38e-17".
    result = compute_response([1], [1, 0, 3, 0, 1], "step")
    labels = [c["label"] for c in result["decomposition"]["components"]]
    for label in labels:
        assert "e-" not in label
        assert "e+" not in label


def test_compute_poles_zeros_returns_poles_from_denominator():
    result = compute_poles_zeros([1], [1, 1, 4])
    assert result["zeros"] == []
    assert len(result["poles"]) == 2
    reals = sorted(p["real"] for p in result["poles"])
    assert reals == pytest.approx([-0.5, -0.5])
    imags = sorted(p["imag"] for p in result["poles"])
    assert imags == pytest.approx([-1.9364916731, 1.9364916731])


def test_compute_poles_zeros_returns_zeros_from_numerator():
    result = compute_poles_zeros([1, 2], [1, 1, 4])
    assert len(result["zeros"]) == 1
    assert result["zeros"][0]["real"] == pytest.approx(-2.0)
    assert result["zeros"][0]["imag"] == pytest.approx(0.0)


def test_compute_poles_zeros_empty_zeros_for_constant_numerator():
    result = compute_poles_zeros([1], [1, 4, 4])
    assert result["zeros"] == []


def test_compute_response_includes_poles_and_zeros_for_step():
    result = compute_response([1, 2], [1, 1, 4], "step")
    assert len(result["poles_zeros"]["poles"]) == 2
    assert len(result["poles_zeros"]["zeros"]) == 1


def test_compute_response_includes_poles_and_zeros_for_impulse():
    result = compute_response([1], [1, 1, 4], "impulse")
    assert len(result["poles_zeros"]["poles"]) == 2


def test_compute_response_poles_zeros_unaffected_by_amplitude():
    unit = compute_response([1], [1, 1, 4], "step", amplitude=1.0)
    scaled = compute_response([1], [1, 1, 4], "step", amplitude=7.0)
    assert unit["poles_zeros"] == scaled["poles_zeros"]


def test_response_endpoint_includes_poles_and_zeros(client):
    resp = client.post(
        "/api/response",
        json={"num": [1, 2], "den": [1, 1, 4], "response_type": "step"},
    )
    data = resp.get_json()
    assert len(data["poles_zeros"]["poles"]) == 2
    assert len(data["poles_zeros"]["zeros"]) == 1


# --- Root locus -------------------------------------------------------------
#
# The expected values below are the ones worked out by hand in the ME 2045
# lecture notes ("3 Complex Numbers and Root Locus"), so these tests check the
# tool against the same numbers students are asked to reproduce.


def test_parse_complex_list_reads_reals():
    assert parse_complex_list("0, -2", "Poles") == [0j, complex(-2, 0)]


def test_parse_complex_list_reads_complex_and_normalizes_i():
    assert parse_complex_list("-1+1i, -1-1i", "Zeros") == [complex(-1, 1), complex(-1, -1)]


def test_parse_complex_list_expands_conjugate_shorthand():
    assert parse_complex_list("-1±1j", "Zeros") == [complex(-1, 1), complex(-1, -1)]


def test_parse_complex_list_reads_bare_j():
    assert parse_complex_list("2j, -j", "Poles") == [complex(0, 2), complex(0, -1)]


def test_parse_complex_list_empty_is_empty():
    assert parse_complex_list("", "Zeros") == []
    assert parse_complex_list(None, "Zeros") == []


def test_parse_complex_list_rejects_garbage():
    with pytest.raises(ValueError, match="Could not read"):
        parse_complex_list("-1, banana", "Poles")


def test_polynomial_from_roots_is_real_for_conjugate_pair():
    coeffs = polynomial_from_roots([complex(-1, 1), complex(-1, -1)])
    assert np.allclose(coeffs, [1, 2, 2])


def test_root_locus_requires_a_pole():
    with pytest.raises(ValueError, match="at least one open-loop pole"):
        compute_root_locus("", "-1")


def test_root_locus_rejects_improper_loop_gain():
    with pytest.raises(ValueError, match="proper"):
        compute_root_locus("-1", "-1, -2")


def test_root_locus_branches_start_at_open_loop_poles():
    """Rule 3 / Section 5: at K=0 the closed-loop poles are the open-loop poles."""
    result = compute_root_locus("0, -2", "")
    start = sorted(branch[0]["real"] for branch in result["branches"])
    assert np.allclose(start, [-2.0, 0.0])


def test_root_locus_simple_example_breakaway():
    """Section 2: K/(s(s+2)) breaks away at s=-1 when K=1."""
    result = compute_root_locus("0, -2", "")
    assert len(result["breakaway_points"]) == 1
    point = result["breakaway_points"][0]
    assert point["real"] == pytest.approx(-1.0)
    assert point["gain"] == pytest.approx(1.0)


def test_root_locus_simple_example_never_goes_unstable():
    assert compute_root_locus("0, -2", "")["jw_crossing"] is None


def test_root_locus_asymptotes_two_pole_example():
    """Section 7: K/((s+2)(s+4)) gives 90/270 degrees about sigma = -3."""
    asymptotes = compute_root_locus("-2, -4", "")["asymptotes"]
    assert asymptotes["angles"] == [90.0, 270.0]
    assert asymptotes["centroid"] == pytest.approx(-3.0)


def test_root_locus_asymptotes_worked_example():
    """Section 8: 4 poles, 1 zero gives 60/180/300 about sigma = -3.27."""
    asymptotes = compute_root_locus("-1, -2, -3, -4", "-0.2")["asymptotes"]
    assert asymptotes["angles"] == [60.0, 180.0, 300.0]
    assert asymptotes["centroid"] == pytest.approx(-3.267, abs=1e-3)


def test_root_locus_maximum_stable_gain_worked_example():
    """Section 9: the locus crosses the imaginary axis at K=275.7, w=5.7."""
    crossing = compute_root_locus("-1, -2, -3, -4", "-0.2")["jw_crossing"]
    assert crossing["gain"] == pytest.approx(275.7, abs=0.5)
    assert crossing["omega"] == pytest.approx(5.707, abs=0.01)


def test_root_locus_real_axis_segments_worked_example():
    """Rule 4 applied to the Section 8 example."""
    segments = compute_root_locus("-1, -2, -3, -4", "-0.2")["real_axis_segments"]
    assert segments == [
        {"from": -0.2, "to": -1.0},
        {"from": -2.0, "to": -3.0},
        {"from": -4.0, "to": None},
    ]


def test_root_locus_characteristic_polynomial_worked_example():
    """Section 9 multiplies the poles out to s^4+10s^3+35s^2+50s+24."""
    result = compute_root_locus("-1, -2, -3, -4", "-0.2")
    assert np.allclose(result["den"], [1, 10, 35, 50, 24])


def test_root_locus_complex_zeros_give_real_numerator():
    """Section 8's full form: zeros at -0.2 and -1+-1j."""
    result = compute_root_locus("-1, -2, -3, -4", "-0.2, -1±1j")
    assert np.allclose(result["num"], [1, 2.2, 2.4, 0.4])
    assert result["asymptotes"]["count"] == 1


def test_root_locus_gain_ceiling_clears_the_crossing():
    result = compute_root_locus("-1, -2, -3, -4", "-0.2")
    assert max(result["gains"]) > result["jw_crossing"]["gain"]


def test_root_locus_endpoint_returns_locus(client):
    resp = client.post("/api/root-locus", json={"poles": "0, -2", "zeros": ""})
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["branches"]) == 2
    assert len(data["gains"]) == len(data["branches"][0])


def test_root_locus_endpoint_reports_errors(client):
    resp = client.post("/api/root-locus", json={"poles": "nope", "zeros": ""})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_root_locus_presets_endpoint(client):
    resp = client.get("/api/root-locus-presets")
    assert resp.status_code == 200
    assert len(resp.get_json()) == 5
