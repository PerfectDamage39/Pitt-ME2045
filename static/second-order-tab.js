const zetaSlider = document.getElementById("zeta-slider");
const zetaValue = document.getElementById("zeta-value");
const omegaNSlider = document.getElementById("omegan-slider");
const omegaNValue = document.getElementById("omegan-value");
const regimeBadge = document.getElementById("regime-badge");
const secondOrderTfNumerator = document.getElementById("second-order-tf-numerator");
const secondOrderTfDenominator = document.getElementById("second-order-tf-denominator");
const secondOrderErrorBanner = document.getElementById("second-order-error-banner");
const secondOrderErrorMessage = document.getElementById("second-order-error-message");

let zeta = Number(zetaSlider.value);
let omegaN = Number(omegaNSlider.value);

function computeSecondOrderCoefficients(z, wn) {
  return { num: [wn * wn], den: [1, 2 * z * wn, wn * wn] };
}

function computeRegime(z) {
  if (Math.abs(z) < 1e-6) return "Undamped";
  if (z < 1) return "Underdamped";
  if (Math.abs(z - 1) < 1e-6) return "Critically damped";
  return "Overdamped";
}

function updateSliderReadouts() {
  zetaValue.textContent = zeta.toFixed(2);
  omegaNValue.textContent = `${omegaN.toFixed(1)} rad/s`;
  regimeBadge.textContent = computeRegime(zeta);
}

function showSecondOrderError(message) {
  secondOrderErrorMessage.textContent = message;
  secondOrderErrorBanner.classList.remove("hidden");
}

function clearSecondOrderError() {
  secondOrderErrorBanner.classList.add("hidden");
}

function renderSecondOrderChart(data) {
  const ink = cssVar("--ink-secondary");
  const axis = cssVar("--axis");
  const surface = cssVar("--surface");

  Plotly.react(
    "second-order-chart",
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
      xaxis: { ...chartAxis("Time (s)", false), range: [0, 15], autorange: false },
      yaxis: { ...chartAxis("Response", true), range: [-0.1, 2.2], autorange: false },
      hovermode: "x",
      hoverlabel: { bgcolor: surface, bordercolor: axis, font: { color: ink } },
    },
    { responsive: true, displayModeBar: false }
  );
}

function renderSecondOrderPoleZero(polesZeros) {
  if (!polesZeros) return;

  const ink = cssVar("--ink-secondary");
  const axis = cssVar("--axis");
  const surface = cssVar("--surface");
  const critical = cssVar("--critical");
  const accent = cssVar("--accent");

  const poleTrace = {
    x: polesZeros.poles.map((p) => p.real),
    y: polesZeros.poles.map((p) => p.imag),
    text: polesZeros.poles.map((p) => `Pole: ${formatComplex(p.real, p.imag)}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Poles",
    marker: { symbol: "x-thin", size: 13, color: critical, line: { width: 2.5, color: critical } },
  };

  const zeroTrace = {
    x: polesZeros.zeros.map((z) => z.real),
    y: polesZeros.zeros.map((z) => z.imag),
    text: polesZeros.zeros.map((z) => `Zero: ${formatComplex(z.real, z.imag)}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Zeros",
    marker: { symbol: "circle-open", size: 11, color: accent, line: { width: 2, color: accent } },
  };

  Plotly.react(
    "second-order-pole-zero-chart",
    [poleTrace, zeroTrace],
    {
      margin: { t: 10, r: 20, b: 44, l: 52 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      xaxis: {
        ...chartAxis("Real", true, 2.5, cssVar("--ink-secondary")),
        range: [-14, 1],
        autorange: false,
      },
      yaxis: {
        ...chartAxis("Imaginary", true, 2.5, cssVar("--ink-secondary")),
        range: [-5.5, 5.5],
        autorange: false,
        scaleanchor: "x",
        scaleratio: 1,
      },
      hovermode: "closest",
      hoverlabel: { bgcolor: surface, bordercolor: axis, font: { color: ink } },
      legend: { orientation: "h", y: -0.2, font: { color: ink } },
    },
    { responsive: true, displayModeBar: false }
  );
}

function updateSecondOrderMetrics(metrics) {
  document.getElementById("second-order-metric-rise-time").textContent = formatMetric(metrics.rise_time);
  document.getElementById("second-order-metric-settling-time").textContent = formatMetric(metrics.settling_time);
  document.getElementById("second-order-metric-overshoot").textContent = formatMetric(metrics.overshoot_pct, 1);
  document.getElementById("second-order-metric-peak").textContent = formatMetric(metrics.peak);
  document.getElementById("second-order-metric-peak-time").textContent = formatMetric(metrics.peak_time);
  document.getElementById("second-order-metric-steady-state").textContent = formatMetric(metrics.steady_state);
}

async function updateSecondOrderAndFetch() {
  updateSliderReadouts();
  const { num, den } = computeSecondOrderCoefficients(zeta, omegaN);
  secondOrderTfNumerator.innerHTML = formatPolynomial(num);
  secondOrderTfDenominator.innerHTML = formatPolynomial(den);

  try {
    const res = await fetch("/api/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num, den, response_type: "step", amplitude: 1, duration: 15 }),
    });

    const data = await res.json();

    if (!res.ok) {
      showSecondOrderError(data.error);
      return;
    }

    clearSecondOrderError();
    renderSecondOrderChart(data);
    renderSecondOrderPoleZero(data.poles_zeros);
    updateSecondOrderMetrics(data.metrics);
  } catch (err) {
    showSecondOrderError("Could not reach the server — is app.py still running?");
  }
}

let secondOrderDebounceTimer = null;

function onSecondOrderSliderInput() {
  zeta = Number(zetaSlider.value);
  omegaN = Number(omegaNSlider.value);
  updateSliderReadouts();
  clearTimeout(secondOrderDebounceTimer);
  secondOrderDebounceTimer = setTimeout(updateSecondOrderAndFetch, 80);
}

zetaSlider.addEventListener("input", onSecondOrderSliderInput);
omegaNSlider.addEventListener("input", onSecondOrderSliderInput);

updateSecondOrderAndFetch();
