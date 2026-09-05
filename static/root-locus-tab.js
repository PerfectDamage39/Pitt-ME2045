const rlPolesInput = document.getElementById("rl-poles-input");
const rlZerosInput = document.getElementById("rl-zeros-input");
const rlPresetRow = document.getElementById("rl-presets");
const rlTfNumerator = document.getElementById("rl-tf-numerator");
const rlTfDenominator = document.getElementById("rl-tf-denominator");
const rlGainSlider = document.getElementById("rl-gain-slider");
const rlGainValue = document.getElementById("rl-gain-value");
const rlGainNote = document.getElementById("rl-gain-note");
const rlStabilityBadge = document.getElementById("rl-stability-badge");
const rlErrorBanner = document.getElementById("rl-error-banner");
const rlErrorMessage = document.getElementById("rl-error-message");
const rlProbeCard = document.getElementById("rl-probe-card");
const rlProbeBody = document.getElementById("rl-probe-body");
const rlProbeVerdict = document.getElementById("rl-probe-verdict");
const rlClearProbeBtn = document.getElementById("rl-clear-probe-btn");
const rlToggles = {
  asymptotes: document.getElementById("rl-toggle-asymptotes"),
  segments: document.getElementById("rl-toggle-segments"),
  crossing: document.getElementById("rl-toggle-crossing"),
  breakaway: document.getElementById("rl-toggle-breakaway"),
};

const rlState = {
  locus: null,
  gainIndex: 0,
  probe: null,
};

const RL_ANGLE_TOLERANCE_DEG = 4;

function rlShowError(message) {
  rlErrorMessage.textContent = message;
  rlErrorBanner.classList.remove("hidden");
}

function rlClearError() {
  rlErrorBanner.classList.add("hidden");
}

function rlCurrentGain() {
  if (!rlState.locus) return 0;
  return rlState.locus.gains[rlState.gainIndex];
}

function rlFormatGain(gain) {
  if (gain === 0) return "0";
  if (gain >= 100) return gain.toFixed(0);
  if (gain >= 1) return gain.toFixed(2);
  return gain.toPrecision(2);
}

function rlClosedLoopPoles() {
  if (!rlState.locus) return [];
  return rlState.locus.branches.map((branch) => branch[rlState.gainIndex]);
}

/** Framing for the s-plane. Branches run off to infinity, so the data's own
 *  range is useless — frame on the fixed landmarks instead (poles, zeros,
 *  centroid, breakaway points, and the jw crossing). */
function rlPlotBounds() {
  const locus = rlState.locus;
  let xMin = 0;
  let xMax = 0;
  let yMax = 0;

  [...locus.poles, ...locus.zeros].forEach((p) => {
    xMin = Math.min(xMin, p.real);
    xMax = Math.max(xMax, p.real);
    yMax = Math.max(yMax, Math.abs(p.imag));
  });
  locus.breakaway_points.forEach((p) => {
    xMin = Math.min(xMin, p.real);
    xMax = Math.max(xMax, p.real);
  });
  if (locus.asymptotes) xMin = Math.min(xMin, locus.asymptotes.centroid);
  if (locus.jw_crossing) yMax = Math.max(yMax, locus.jw_crossing.omega);

  const xSpan = Math.max(xMax - xMin, 1);
  // With no complex landmark to set the vertical scale, give the branches
  // leaving the real axis somewhere to go.
  yMax = Math.max(yMax, xSpan * 0.6);

  const pad = Math.max(xSpan, yMax) * 0.15;
  return {
    x: [xMin - pad, xMax + pad],
    y: [-(yMax + pad), yMax + pad],
    reach: Math.max(xSpan, yMax) * 4,
  };
}

function rlAngleContributions(point) {
  const contributions = [];
  rlState.locus.zeros.forEach((z, i) => {
    const dx = point.x - z.real;
    const dy = point.y - z.imag;
    contributions.push({
      kind: "zero",
      label: `Zero at ${formatComplex(z.real, z.imag)}`,
      distance: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      from: z,
      index: i,
    });
  });
  rlState.locus.poles.forEach((p, i) => {
    const dx = point.x - p.real;
    const dy = point.y - p.imag;
    contributions.push({
      kind: "pole",
      label: `Pole at ${formatComplex(p.real, p.imag)}`,
      distance: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      from: p,
      index: i,
    });
  });
  return contributions;
}

function rlNormalizeAngle(deg) {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

function rlEvaluateProbe(point) {
  const contributions = rlAngleContributions(point);
  let angleSum = 0;
  let magnitude = 1;
  contributions.forEach((c) => {
    if (c.kind === "zero") {
      angleSum += c.angle;
      magnitude *= c.distance;
    } else {
      angleSum -= c.angle;
      magnitude /= c.distance;
    }
  });

  const normalized = rlNormalizeAngle(angleSum);
  const onLocus = Math.abs(Math.abs(normalized) - 180) <= RL_ANGLE_TOLERANCE_DEG;
  return {
    contributions,
    angleSum,
    normalized,
    magnitude,
    requiredGain: magnitude > 0 ? 1 / magnitude : null,
    onLocus,
  };
}

function rlRenderProbePanel() {
  if (!rlState.probe) {
    rlProbeCard.classList.add("hidden");
    return;
  }

  const point = rlState.probe;
  const result = rlEvaluateProbe(point);

  const rows = result.contributions
    .map((c) => {
      const sign = c.kind === "zero" ? "+" : "−";
      return `<tr>
        <td>${c.label}</td>
        <td class="rl-num">${c.distance.toFixed(3)}</td>
        <td class="rl-num">${sign}${Math.abs(c.angle).toFixed(1)}°</td>
      </tr>`;
    })
    .join("");

  rlProbeBody.innerHTML = `
    <p class="rl-probe-point">Test point <b>s* = ${formatComplex(point.x, point.y)}</b></p>
    <table class="rl-probe-table">
      <thead>
        <tr><th>Contribution</th><th class="rl-num">Distance</th><th class="rl-num">Angle</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="rl-probe-sum">
      &ang;L(s*) = &Sigma;&ang;zeros &minus; &Sigma;&ang;poles =
      <b>${result.normalized.toFixed(1)}°</b>
      &nbsp;&nbsp;|L(s*)| = <b>${result.magnitude.toPrecision(3)}</b>
    </p>`;

  if (result.onLocus) {
    rlProbeVerdict.className = "rl-verdict rl-verdict-pass";
    rlProbeVerdict.innerHTML = `✓ On the locus — the angle is 180°, so s* <b>is</b> a closed-loop pole,
      reached at K = ${rlFormatGain(result.requiredGain)}.`;
  } else {
    rlProbeVerdict.className = "rl-verdict rl-verdict-fail";
    rlProbeVerdict.innerHTML = `✗ Not on the locus — the angle criterion needs 180°, and this point gives
      ${result.normalized.toFixed(1)}°. No value of K makes s* a closed-loop pole.`;
  }

  rlProbeCard.classList.remove("hidden");
}

function rlBuildTraces() {
  const locus = rlState.locus;
  const bounds = rlPlotBounds();
  const accent = cssVar("--accent");
  const critical = cssVar("--critical");
  const muted = cssVar("--ink-muted");
  const traces = [];

  locus.branches.forEach((branch, i) => {
    traces.push({
      x: branch.map((p) => p.real),
      y: branch.map((p) => p.imag),
      mode: "lines",
      name: "Locus",
      legendgroup: "locus",
      showlegend: i === 0,
      hoverinfo: "skip",
      line: { color: cssVar("--series-2"), width: 2 },
    });
  });

  if (rlToggles.segments.checked && locus.real_axis_segments.length) {
    const xs = [];
    const ys = [];
    locus.real_axis_segments.forEach((seg) => {
      const left = seg.to === null ? bounds.x[0] : seg.to;
      xs.push(seg.from, left, null);
      ys.push(0, 0, null);
    });
    traces.push({
      x: xs,
      y: ys,
      mode: "lines",
      name: "Real-axis segments",
      hoverinfo: "skip",
      line: { color: cssVar("--series-4"), width: 7 },
      opacity: 0.45,
    });
  }

  if (rlToggles.asymptotes.checked && locus.asymptotes) {
    const { angles, centroid } = locus.asymptotes;
    const xs = [];
    const ys = [];
    const reach = bounds.reach;
    angles.forEach((deg) => {
      const rad = (deg * Math.PI) / 180;
      xs.push(centroid, centroid + reach * Math.cos(rad), null);
      ys.push(0, reach * Math.sin(rad), null);
    });
    traces.push({
      x: xs,
      y: ys,
      mode: "lines",
      name: "Asymptotes",
      hoverinfo: "skip",
      line: { color: cssVar("--series-5"), width: 1.5, dash: "dash" },
    });
    traces.push({
      x: [centroid],
      y: [0],
      mode: "markers",
      name: `Centroid σ = ${centroid.toFixed(2)}`,
      hovertemplate: `Centroid σ = ${centroid.toFixed(3)}<extra></extra>`,
      marker: { symbol: "square", size: 9, color: cssVar("--series-5") },
    });
  }

  if (rlToggles.breakaway.checked && locus.breakaway_points.length) {
    traces.push({
      x: locus.breakaway_points.map((p) => p.real),
      y: locus.breakaway_points.map((p) => 0),
      text: locus.breakaway_points.map(
        (p) => `Breakaway at s = ${p.real.toFixed(3)}, K = ${rlFormatGain(p.gain)}`
      ),
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: "Breakaway",
      marker: { symbol: "diamond", size: 10, color: cssVar("--series-6") },
    });
  }

  if (rlToggles.crossing.checked && locus.jw_crossing) {
    const { gain, omega } = locus.jw_crossing;
    traces.push({
      x: [0, 0],
      y: [omega, -omega],
      text: [
        `Crosses at ω = ${omega.toFixed(2)}, K = ${rlFormatGain(gain)}`,
        `Crosses at ω = ${omega.toFixed(2)}, K = ${rlFormatGain(gain)}`,
      ],
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: `Kmax = ${rlFormatGain(gain)}`,
      marker: {
        symbol: "circle-open",
        size: 15,
        color: cssVar("--warning"),
        line: { width: 3, color: cssVar("--warning") },
      },
    });
  }

  traces.push({
    x: locus.poles.map((p) => p.real),
    y: locus.poles.map((p) => p.imag),
    text: locus.poles.map((p) => `Open-loop pole: ${formatComplex(p.real, p.imag)}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Open-loop poles",
    marker: { symbol: "x-thin", size: 14, color: critical, line: { width: 2.5, color: critical } },
  });

  if (locus.zeros.length) {
    traces.push({
      x: locus.zeros.map((z) => z.real),
      y: locus.zeros.map((z) => z.imag),
      text: locus.zeros.map((z) => `Open-loop zero: ${formatComplex(z.real, z.imag)}`),
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: "Open-loop zeros",
      marker: { symbol: "circle-open", size: 12, color: accent, line: { width: 2.5, color: accent } },
    });
  }

  const closed = rlClosedLoopPoles();
  traces.push({
    x: closed.map((p) => p.real),
    y: closed.map((p) => p.imag),
    text: closed.map((p) => `Closed-loop pole: ${formatComplex(p.real, p.imag)}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Closed-loop poles",
    marker: {
      symbol: "circle",
      size: 13,
      color: accent,
      line: { width: 2, color: cssVar("--surface") },
    },
  });

  if (rlState.probe) {
    const probe = rlState.probe;
    const result = rlEvaluateProbe(probe);
    const xs = [];
    const ys = [];
    result.contributions.forEach((c) => {
      xs.push(c.from.real, probe.x, null);
      ys.push(c.from.imag, probe.y, null);
    });
    traces.push({
      x: xs,
      y: ys,
      mode: "lines",
      name: "Test-point vectors",
      hoverinfo: "skip",
      line: { color: muted, width: 1.5 },
    });
    traces.push({
      x: [probe.x],
      y: [probe.y],
      text: [`s* = ${formatComplex(probe.x, probe.y)} (∠L = ${result.normalized.toFixed(1)}°)`],
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: "Test point s*",
      marker: {
        symbol: "square",
        size: 12,
        color: result.onLocus ? cssVar("--series-3") : cssVar("--critical"),
      },
    });
  }

  return { traces, bounds };
}

function rlRenderChart() {
  if (!rlState.locus) return;
  const { traces, bounds } = rlBuildTraces();
  const ink = cssVar("--ink-secondary");

  Plotly.react(
    "rl-chart",
    traces,
    {
      margin: { t: 10, r: 20, b: 44, l: 52 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      // Equal aspect matters here: the angle criterion is read geometrically,
      // so a stretched axis would draw every angle wrong.
      xaxis: {
        ...chartAxis("Real", true, 2.5, cssVar("--ink-secondary")),
        range: bounds.x,
        autorange: false,
      },
      yaxis: {
        ...chartAxis("Imaginary", true, 2.5, cssVar("--ink-secondary")),
        range: bounds.y,
        autorange: false,
        scaleanchor: "x",
        scaleratio: 1,
      },
      hovermode: "closest",
      hoverlabel: {
        bgcolor: cssVar("--surface"),
        bordercolor: cssVar("--axis"),
        font: { color: ink },
      },
      legend: { orientation: "h", y: -0.18, font: { color: ink } },
      showlegend: true,
    },
    { responsive: true, displayModeBar: false }
  );
}

function rlRenderResponseChart(data) {
  const ink = cssVar("--ink-secondary");
  Plotly.react(
    "rl-response-chart",
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
        bgcolor: cssVar("--surface"),
        bordercolor: cssVar("--axis"),
        font: { color: ink },
      },
    },
    { responsive: true, displayModeBar: false }
  );
}

function rlClearResponseChart() {
  Plotly.react("rl-response-chart", [], {
    margin: { t: 10, r: 20, b: 44, l: 52 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    xaxis: chartAxis("Time (s)", false),
    yaxis: chartAxis("Response", true),
  });
}

/** Closed-loop transfer function under unity feedback:
 *  K*L(s) / (1 + K*L(s)) = K*num / (den + K*num). */
function rlClosedLoopCoefficients(gain) {
  const { num, den } = rlState.locus;
  const padded = Array(den.length - num.length)
    .fill(0)
    .concat(num);
  return {
    num: num.map((c) => c * gain),
    den: den.map((c, i) => c + gain * padded[i]),
  };
}

function rlUpdateStabilityBadge() {
  const poles = rlClosedLoopPoles();
  const maxReal = Math.max(...poles.map((p) => p.real));
  let label;
  if (maxReal > 1e-8) label = "Unstable";
  else if (maxReal > -1e-8) label = "Marginally stable";
  else label = "Stable";
  rlStabilityBadge.textContent = label;
  rlStabilityBadge.classList.toggle("regime-badge-critical", label === "Unstable");
}

let rlResponseTimer = null;

async function rlFetchResponse() {
  const gain = rlCurrentGain();
  if (gain === 0) {
    rlClearResponseChart();
    rlGainNote.textContent =
      "K = 0: the loop is open, so the closed-loop poles sit exactly on the open-loop poles.";
    return;
  }

  const { num, den } = rlClosedLoopCoefficients(gain);
  try {
    const res = await fetch("/api/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num, den, response_type: "step", amplitude: 1 }),
    });
    const data = await res.json();
    if (!res.ok) {
      rlGainNote.textContent = data.error;
      return;
    }
    rlGainNote.textContent = "";
    rlRenderResponseChart(data);
  } catch (err) {
    rlShowError("Could not reach the server — is app.py still running?");
  }
}

function rlUpdateGain() {
  if (!rlState.locus) return;
  rlGainValue.textContent = `K = ${rlFormatGain(rlCurrentGain())}`;
  rlUpdateStabilityBadge();
  rlRenderChart();
  rlRenderProbePanel();
  clearTimeout(rlResponseTimer);
  rlResponseTimer = setTimeout(rlFetchResponse, 90);
}

async function rlFetchLocus() {
  try {
    const res = await fetch("/api/root-locus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poles: rlPolesInput.value,
        zeros: rlZerosInput.value,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      rlShowError(data.error);
      return;
    }

    rlClearError();
    rlState.locus = data;
    rlState.probe = null;

    rlTfNumerator.innerHTML = formatPolynomial(data.num);
    rlTfDenominator.innerHTML = formatPolynomial(data.den);

    rlGainSlider.max = String(data.gains.length - 1);
    rlState.gainIndex = Math.min(
      Math.round((data.gains.length - 1) / 2),
      data.gains.length - 1
    );
    rlGainSlider.value = String(rlState.gainIndex);

    rlUpdateGain();
  } catch (err) {
    rlShowError("Could not reach the server — is app.py still running?");
  }
}

function rlHandleChartClick(event) {
  const chart = document.getElementById("rl-chart");
  const dragLayer = chart.querySelector(".nsewdrag");
  if (!dragLayer || !chart._fullLayout) return;

  const box = dragLayer.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  ) {
    return;
  }

  rlState.probe = {
    x: chart._fullLayout.xaxis.p2d(event.clientX - box.left),
    y: chart._fullLayout.yaxis.p2d(event.clientY - box.top),
  };
  rlRenderChart();
  rlRenderProbePanel();
}

async function rlLoadPresets() {
  try {
    const res = await fetch("/api/root-locus-presets");
    const presets = await res.json();
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-btn";
      button.textContent = preset.name;
      button.addEventListener("click", () => {
        rlPolesInput.value = preset.poles;
        rlZerosInput.value = preset.zeros;
        rlFetchLocus();
      });
      rlPresetRow.appendChild(button);
    });
  } catch (err) {
    /* presets are a convenience; the text inputs still work without them */
  }
}

let rlInputTimer = null;

function rlOnInputChange() {
  clearTimeout(rlInputTimer);
  rlInputTimer = setTimeout(rlFetchLocus, 300);
}

rlPolesInput.addEventListener("input", rlOnInputChange);
rlZerosInput.addEventListener("input", rlOnInputChange);

rlGainSlider.addEventListener("input", () => {
  rlState.gainIndex = Number(rlGainSlider.value);
  rlUpdateGain();
});

Object.values(rlToggles).forEach((toggle) => {
  toggle.addEventListener("change", rlRenderChart);
});

rlClearProbeBtn.addEventListener("click", () => {
  rlState.probe = null;
  rlRenderChart();
  rlRenderProbePanel();
});

document.getElementById("rl-chart").addEventListener("click", rlHandleChartClick);

rlLoadPresets();
rlFetchLocus();
