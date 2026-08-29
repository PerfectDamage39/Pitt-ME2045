const numInput = document.getElementById("num-input");
const denInput = document.getElementById("den-input");
const amplitudeInput = document.getElementById("amplitude-input");
const stepBtn = document.getElementById("step-btn");
const impulseBtn = document.getElementById("impulse-btn");
const presetButtons = document.getElementById("preset-buttons");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const stabilityBadge = document.getElementById("stability-badge");
const stabilityBadgeLabel = document.getElementById("stability-badge-label");
const decompositionCard = document.getElementById("decomposition-card");
const decompositionChart = document.getElementById("decomposition-chart");
const decompositionNote = document.getElementById("decomposition-note");
const tfNumerator = document.getElementById("tf-numerator");
const tfDenominator = document.getElementById("tf-denominator");

const SERIES_COLOR_VARS = [
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

let responseType = "step";

function parseCoeffList(text) {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

function updateTransferFunctionPreview() {
  const num = parseCoeffList(numInput.value);
  const den = parseCoeffList(denInput.value);
  if (num.length === 0 || den.length === 0 || num.some(Number.isNaN) || den.some(Number.isNaN)) {
    return;
  }
  tfNumerator.innerHTML = formatPolynomial(num);
  tfDenominator.innerHTML = formatPolynomial(den);
}

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
}

function formatMetric(value, digits = 3) {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function renderResponse(data) {
  const ink = cssVar("--ink-secondary");
  const axis = cssVar("--axis");
  const surface = cssVar("--surface");

  Plotly.react(
    "chart",
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
      hoverlabel: {
        bgcolor: surface,
        bordercolor: axis,
        font: { color: ink },
      },
    },
    { responsive: true, displayModeBar: false }
  );

  document.getElementById("metric-rise-time").textContent = formatMetric(data.metrics.rise_time);
  document.getElementById("metric-settling-time").textContent = formatMetric(data.metrics.settling_time);
  document.getElementById("metric-overshoot").textContent = formatMetric(data.metrics.overshoot_pct, 1);
  document.getElementById("metric-peak").textContent = formatMetric(data.metrics.peak);
  document.getElementById("metric-peak-time").textContent = formatMetric(data.metrics.peak_time);
  document.getElementById("metric-steady-state").textContent = formatMetric(data.metrics.steady_state);

  updateStabilityBadge(data.stability);

  renderDecomposition(data);
  renderPoleZero(data.poles_zeros);
}

function updateStabilityBadge(stability) {
  if (stability === "stable") {
    stabilityBadge.classList.add("hidden");
    return;
  }
  stabilityBadge.classList.remove("hidden");
  if (stability === "marginal") {
    stabilityBadge.classList.add("warning");
    stabilityBadgeLabel.textContent = "Marginally stable";
  } else {
    stabilityBadge.classList.remove("warning");
    stabilityBadgeLabel.textContent = "Unstable";
  }
}

function renderDecomposition(data) {
  const decomposition = data.decomposition;

  if (!decomposition) {
    decompositionCard.classList.add("hidden");
    return;
  }
  decompositionCard.classList.remove("hidden");

  if (!decomposition.components) {
    decompositionChart.classList.add("hidden");
    decompositionNote.classList.remove("hidden");
    decompositionNote.textContent = `This system has ${decomposition.mode_count} independent modes — too many to show clearly as separate components.`;
    return;
  }
  decompositionNote.classList.add("hidden");
  decompositionChart.classList.remove("hidden");

  const ink = cssVar("--ink-secondary");
  const axis = cssVar("--axis");
  const surface = cssVar("--surface");

  const traces = decomposition.components.map((component, i) => ({
    x: data.time,
    y: component.values,
    mode: "lines",
    name: component.label,
    line: { color: cssVar(SERIES_COLOR_VARS[i % SERIES_COLOR_VARS.length]), width: 2 },
    hovertemplate: `${component.label}<br>t = %{x:.3f}s<br><b>%{y:.4g}</b><extra></extra>`,
  }));

  traces.push({
    x: data.time,
    y: data.values,
    mode: "lines",
    name: "Total (sum)",
    line: { color: cssVar("--accent"), width: 2, dash: "dot" },
    hovertemplate: "Total (sum)<br>t = %{x:.3f}s<br><b>%{y:.4g}</b><extra></extra>",
  });

  Plotly.react(
    "decomposition-chart",
    traces,
    {
      margin: { t: 10, r: 20, b: 44, l: 52 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      xaxis: chartAxis("Time (s)", false),
      yaxis: chartAxis("Response", true),
      hovermode: "x",
      hoverlabel: { bgcolor: surface, bordercolor: axis, font: { color: ink } },
      legend: { orientation: "h", y: -0.25, font: { color: ink } },
    },
    { responsive: true, displayModeBar: false }
  );
}

function formatComplex(real, imag) {
  const sign = imag < 0 ? "−" : "+";
  return `${real.toFixed(3)} ${sign} ${Math.abs(imag).toFixed(3)}i`;
}

function renderPoleZero(polesZeros) {
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
    "pole-zero-chart",
    [poleTrace, zeroTrace],
    {
      margin: { t: 10, r: 20, b: 44, l: 52 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      xaxis: chartAxis("Real", true, 2.5, cssVar("--ink-secondary")),
      yaxis: {
        ...chartAxis("Imaginary", true, 2.5, cssVar("--ink-secondary")),
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

async function fetchAndRender() {
  const num = parseCoeffList(numInput.value);
  const den = parseCoeffList(denInput.value);
  const amplitude = Number(amplitudeInput.value);

  try {
    const res = await fetch("/api/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num, den, response_type: responseType, amplitude }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error);
      return;
    }

    clearError();
    renderResponse(data);
  } catch (err) {
    showError("Could not reach the server — is app.py still running?");
  }
}

function loadPreset(preset) {
  numInput.value = preset.num.join(", ");
  denInput.value = preset.den.join(", ");
  updateTransferFunctionPreview();
  fetchAndRender();
}

async function init() {
  try {
    const res = await fetch("/api/presets");
    if (!res.ok) {
      showError("Could not reach the server — is app.py still running?");
      return;
    }
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
  } catch (err) {
    showError("Could not reach the server — is app.py still running?");
  }
}

let debounceTimer = null;

function onCoefficientInputChanged() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchAndRender, 300);
}

numInput.addEventListener("input", onCoefficientInputChanged);
denInput.addEventListener("input", onCoefficientInputChanged);
amplitudeInput.addEventListener("input", onCoefficientInputChanged);

// Unlike the fetch above, the G(s) preview is pure client-side math, so it
// updates immediately on every keystroke rather than waiting on the debounce.
numInput.addEventListener("input", updateTransferFunctionPreview);
denInput.addEventListener("input", updateTransferFunctionPreview);

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

init();
