const cdPolesInput = document.getElementById("cd-poles-input");
const cdZerosInput = document.getElementById("cd-zeros-input");
const cdOvershootInput = document.getElementById("cd-overshoot-input");
const cdTargetTsInput = document.getElementById("cd-target-ts-input");
const cdPresetRow = document.getElementById("cd-presets");
const cdPdBtn = document.getElementById("cd-pd-btn");
const cdLeadBtn = document.getElementById("cd-lead-btn");
const cdZeroField = document.getElementById("cd-zero-field");
const cdZeroSlider = document.getElementById("cd-zero-slider");
const cdZeroValue = document.getElementById("cd-zero-value");
const cdZeroHint = document.getElementById("cd-zero-hint");
const cdErrorBanner = document.getElementById("cd-error-banner");
const cdErrorMessage = document.getElementById("cd-error-message");
const cdStepsBody = document.getElementById("cd-steps-body");
const cdResultBody = document.getElementById("cd-result-body");

const cdState = {
  design: null,
  kind: "lead",
  zeroLocation: null,
};

function cdShowError(message) {
  cdErrorMessage.textContent = message;
  cdErrorBanner.classList.remove("hidden");
}

function cdClearError() {
  cdErrorBanner.classList.add("hidden");
}

function cdFormat(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
}

function cdPointLabel(point) {
  return formatComplex(point.real, point.imag);
}

function cdRenderSteps() {
  const d = cdState.design;
  const now = d.current;
  const target = d.target;
  const comp = d.compensator;

  const rows = d.contributions
    .map((c) => {
      const sign = c.kind === "zero" ? "+" : "−";
      return `<tr>
        <td>${c.kind === "zero" ? "Zero" : "Pole"} at ${cdPointLabel(c.at)}</td>
        <td class="cd-num">${sign}${Math.abs(c.angle).toFixed(1)}°</td>
      </tr>`;
    })
    .join("");

  cdStepsBody.innerHTML = `
    <ol class="cd-steps">
      <li>
        <b>Where we are now.</b> ${cdFormat(d.zeta * 0 + Number(cdOvershootInput.value), 0)}%
        overshoot fixes ζ = <b>${cdFormat(d.zeta, 3)}</b>. Walking out the ζ ray until the
        angle criterion closes lands on
        <b>s = ${cdPointLabel(now.pole)}</b> at K = <b>${cdFormat(now.gain, 1)}</b>,
        giving T<sub>s</sub> = <b>${cdFormat(now.settling_time)} s</b>.
      </li>
      <li>
        <b>Where we want to be.</b> T<sub>s</sub> = ${cdFormat(target.settling_time)} s fixes the
        real part at ζω<sub>n</sub> = ${cdFormat(target.sigma)}; holding the same overshoot keeps
        us on the ζ ray, fixing ω<sub>d</sub> = ${cdFormat(target.omega_d)}. So
        <b>s<sub>d</sub> = ${cdPointLabel(target.pole)}</b>.
      </li>
      <li>
        <b>How much angle are we short?</b>
        <table class="cd-angle-table"><tbody>${rows}</tbody></table>
        <p class="cd-angle-sum">
          ∠G(s<sub>d</sub>) = <b>${cdFormat(d.plant_angle, 1)}°</b>, but the locus needs −180°.
          The compensator must supply <b>${cdFormat(d.deficiency, 1)}°</b> of lead.
        </p>
      </li>
      <li>
        <b>Place the compensator.</b> ${cdStep4Text(comp)}
      </li>
    </ol>`;
}

function cdStep4Text(comp) {
  if (comp.kind === "pd") {
    return `A PD controller is a lone zero, so there is exactly one answer: the zero must
      supply all ${cdFormat(comp.theta_zero, 1)}° by itself, which puts it at
      <b>s = −${cdFormat(comp.zero, 3)}</b>.`;
  }
  return `The zero at <b>s = −${cdFormat(comp.zero, 2)}</b> contributes
    ${cdFormat(comp.theta_zero, 1)}° — more than needed — so the pole takes back
    ${cdFormat(comp.theta_zero, 1)}° − ${cdFormat(cdState.design.deficiency, 1)}° =
    <b>${cdFormat(comp.theta_pole, 1)}°</b>, which places it at
    <b>s = −${cdFormat(comp.pole, 2)}</b>.`;
}

function cdRenderResult() {
  const comp = cdState.design.compensator;
  const gc =
    comp.kind === "pd"
      ? `K (s + ${cdFormat(comp.zero, 3)})`
      : `K (s + ${cdFormat(comp.zero, 2)}) / (s + ${cdFormat(comp.pole, 2)})`;

  cdResultBody.innerHTML = `
    <div class="cd-result-line">G<sub>c</sub>(s) = <b>${gc}</b>
      &nbsp;&nbsp;K = <b>${cdFormat(comp.gain, 1)}</b></div>`;
}

function cdRayTrace(bounds) {
  const d = cdState.design;
  const zeta = d.zeta;
  const reach = Math.max(Math.abs(bounds.x[0]), bounds.y[1]) * 1.5;
  const dx = -zeta * reach;
  const dy = Math.sqrt(1 - zeta * zeta) * reach;
  return {
    x: [dx, 0, dx],
    y: [dy, 0, -dy],
    mode: "lines",
    name: `ζ = ${cdFormat(zeta, 3)}`,
    hoverinfo: "skip",
    line: { color: cssVar("--series-5"), width: 1.5, dash: "dot" },
  };
}

function cdLocusBounds() {
  const d = cdState.design;
  // Frame on the plant, the compensator zero and the two design points. The
  // compensator pole is deliberately excluded: lead designs push it far out
  // (s = -34 here, -43 in the lecture example), and framing on it would squash
  // everything worth looking at into a corner. It is left off the edge, and
  // the step-by-step panel reports its location anyway.
  const landmarks = [
    ...d.uncompensated.poles,
    ...d.uncompensated.zeros,
    { real: -d.compensator.zero, imag: 0 },
    d.current.pole,
    d.target.pole,
  ];

  let xMin = 0;
  let yMax = 1;
  landmarks.forEach((p) => {
    xMin = Math.min(xMin, p.real);
    yMax = Math.max(yMax, Math.abs(p.imag));
  });

  const pad = Math.max(-xMin, yMax) * 0.12;
  return { x: [xMin - pad, pad], y: [-(yMax + pad), yMax + pad] };
}

// Right margin reserves room for the legend to sit beside the plot rather
// than on top of it; the aspect fitter treats it as chrome.
const CD_LOCUS_MARGIN = { t: 10, r: 150, b: 46, l: 52 };

function cdRenderLocus() {
  if (!cdState.design) return;
  const d = cdState.design;
  const bounds = cdLocusBounds();
  const ink = cssVar("--ink-secondary");
  const traces = [];

  const fitted =
    fitSquareAspect("cd-locus-chart", bounds.x, bounds.y, CD_LOCUS_MARGIN, 300, availableChartHeight(720)) ||
    bounds;

  d.uncompensated.branches.forEach((branch, i) => {
    traces.push({
      x: branch.map((p) => p.real),
      y: branch.map((p) => p.imag),
      mode: "lines",
      name: "Uncompensated locus",
      legendgroup: "before",
      showlegend: i === 0,
      hoverinfo: "skip",
      line: { color: cssVar("--ink-muted"), width: 1.5, dash: "dash" },
    });
  });

  d.compensated.branches.forEach((branch, i) => {
    traces.push({
      x: branch.map((p) => p.real),
      y: branch.map((p) => p.imag),
      mode: "lines",
      name: "Compensated locus",
      legendgroup: "after",
      showlegend: i === 0,
      hoverinfo: "skip",
      line: { color: cssVar("--series-2"), width: 2 },
    });
  });

  traces.push(cdRayTrace(bounds));

  traces.push({
    x: d.uncompensated.poles.map((p) => p.real),
    y: d.uncompensated.poles.map((p) => p.imag),
    text: d.uncompensated.poles.map((p) => `Plant pole: ${cdPointLabel(p)}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Plant poles",
    marker: {
      symbol: "x-thin",
      size: 13,
      color: cssVar("--critical"),
      line: { width: 2.5, color: cssVar("--critical") },
    },
  });

  if (d.uncompensated.zeros.length) {
    traces.push({
      x: d.uncompensated.zeros.map((z) => z.real),
      y: d.uncompensated.zeros.map((z) => z.imag),
      text: d.uncompensated.zeros.map((z) => `Plant zero: ${cdPointLabel(z)}`),
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: "Plant zeros",
      marker: {
        symbol: "circle-open",
        size: 11,
        color: cssVar("--ink-secondary"),
        line: { width: 2, color: cssVar("--ink-secondary") },
      },
    });
  }

  const comp = d.compensator;
  traces.push({
    x: [-comp.zero],
    y: [0],
    text: [`Compensator zero: s = −${cdFormat(comp.zero, 3)}`],
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Compensator zero",
    marker: {
      symbol: "circle-open",
      size: 15,
      color: cssVar("--accent"),
      line: { width: 3, color: cssVar("--accent") },
    },
  });

  if (comp.pole !== null) {
    traces.push({
      x: [-comp.pole],
      y: [0],
      text: [`Compensator pole: s = −${cdFormat(comp.pole, 2)}`],
      hovertemplate: "%{text}<extra></extra>",
      mode: "markers",
      name: "Compensator pole",
      marker: {
        symbol: "x-thin",
        size: 13,
        color: cssVar("--accent"),
        line: { width: 2.5, color: cssVar("--accent") },
      },
    });
  }

  traces.push({
    x: [d.current.pole.real, d.current.pole.real],
    y: [d.current.pole.imag, -d.current.pole.imag],
    text: [`Uncompensated: ${cdPointLabel(d.current.pole)}`, "Uncompensated"],
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Where we are",
    marker: { symbol: "square", size: 11, color: cssVar("--ink-muted") },
  });

  traces.push({
    x: [d.target.pole.real, d.target.pole.real],
    y: [d.target.pole.imag, -d.target.pole.imag],
    text: [`Target s_d: ${cdPointLabel(d.target.pole)}`, "Target s_d"],
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    name: "Target s_d",
    marker: { symbol: "square", size: 13, color: cssVar("--series-3") },
  });

  Plotly.react(
    "cd-locus-chart",
    traces,
    {
      margin: CD_LOCUS_MARGIN,
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
      xaxis: {
        ...chartAxis("Real", true, 2.5, cssVar("--ink-secondary")),
        range: fitted.x,
        autorange: false,
      },
      yaxis: {
        ...chartAxis("Imaginary", true, 2.5, cssVar("--ink-secondary")),
        range: fitted.y,
        autorange: false,
      },
      hovermode: "closest",
      hoverlabel: {
        bgcolor: cssVar("--surface"),
        bordercolor: cssVar("--axis"),
        font: { color: ink },
      },
      legend: {
        x: 1.02,
        y: 1,
        xanchor: "left",
        yanchor: "top",
        bgcolor: "rgba(0,0,0,0)",
        font: { color: ink, size: 10 },
      },
    },
    { responsive: true, displayModeBar: false }
  );

  // react() reuses the container dimensions captured on the first render,
  // which for a tab that starts hidden are the CSS fallback, not the box we
  // just sized. Force a re-measure so the plot area matches the ranges above.
  Plotly.Plots.resize("cd-locus-chart");
  matchChartHeight("cd-response-chart", "cd-locus-chart");
}

function cdClosedLoop(locus, gain) {
  const { num, den } = locus;
  const padded = Array(den.length - num.length)
    .fill(0)
    .concat(num);
  return {
    num: num.map((c) => c * gain),
    den: den.map((c, i) => c + gain * padded[i]),
  };
}

async function cdFetchResponse(locus, gain, duration) {
  const { num, den } = cdClosedLoop(locus, gain);
  const res = await fetch("/api/response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ num, den, response_type: "step", amplitude: 1, duration }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

function cdNormalize(values) {
  const final = values[values.length - 1];
  if (!final) return values;
  return values.map((v) => v / final);
}

async function cdRenderResponses() {
  const d = cdState.design;
  const duration = Math.max(d.current.settling_time, d.target.settling_time) * 1.6;
  const ink = cssVar("--ink-secondary");

  try {
    const [before, after] = await Promise.all([
      cdFetchResponse(d.uncompensated, d.current.gain, duration),
      cdFetchResponse(d.compensated, d.compensator.gain, duration),
    ]);

    Plotly.react(
      "cd-response-chart",
      [
        {
          x: before.time,
          y: cdNormalize(before.values),
          mode: "lines",
          name: `Before (Ts = ${cdFormat(d.current.settling_time)} s)`,
          line: { color: cssVar("--ink-muted"), width: 2, dash: "dash" },
          hovertemplate: "t = %{x:.2f}s<br>%{y:.3f}<extra>Before</extra>",
        },
        {
          x: after.time,
          y: cdNormalize(after.values),
          mode: "lines",
          name: `After (Ts = ${cdFormat(d.target.settling_time)} s)`,
          line: { color: cssVar("--accent"), width: 2 },
          hovertemplate: "t = %{x:.2f}s<br>%{y:.3f}<extra>After</extra>",
        },
      ],
      {
        margin: { t: 10, r: 20, b: 72, l: 52 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: ink, size: 12 },
        xaxis: { ...chartAxis("Time (s)", false), range: [0, duration], autorange: false },
        yaxis: chartAxis("Response (normalized)", true),
        hovermode: "x",
        hoverlabel: {
          bgcolor: cssVar("--surface"),
          bordercolor: cssVar("--axis"),
          font: { color: ink },
        },
        legend: { orientation: "h", y: -0.3, font: { color: ink } },
      },
      { responsive: true, displayModeBar: false }
    );

    matchChartHeight("cd-response-chart", "cd-locus-chart");
  } catch (err) {
    cdShowError(err.message);
  }
}

function cdSyncZeroControl() {
  const isLead = cdState.kind === "lead";
  cdZeroField.classList.toggle("hidden", !isLead);
  cdPdBtn.classList.toggle("active", !isLead);
  cdLeadBtn.classList.toggle("active", isLead);
}

function cdUpdateZeroSliderRange() {
  const limit = cdState.design.compensator.zero_limit;
  cdZeroSlider.min = String(limit * 0.05);
  cdZeroSlider.max = String(limit * 0.97);
  cdZeroSlider.step = String(limit / 400);
  cdZeroSlider.value = String(cdState.design.compensator.zero);
  cdZeroValue.textContent = `s = −${cdFormat(cdState.design.compensator.zero, 2)}`;
  cdZeroHint.innerHTML = `Must stay inside the PD bound
    <b>s = −${cdFormat(limit, 2)}</b>; nearer it, the pole runs to infinity.`;
}

async function cdFetchDesign() {
  try {
    const res = await fetch("/api/compensator-design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poles: cdPolesInput.value,
        zeros: cdZerosInput.value,
        overshoot: Number(cdOvershootInput.value),
        target_ts: Number(cdTargetTsInput.value),
        kind: cdState.kind,
        zero_location: cdState.zeroLocation,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      cdShowError(data.error);
      return;
    }

    cdClearError();
    cdState.design = data;
    cdState.zeroLocation = data.compensator.zero;

    cdRenderSteps();
    cdRenderResult();
    cdRenderLocus();
    cdRenderResponses();
    if (cdState.kind === "lead") cdUpdateZeroSliderRange();
  } catch (err) {
    cdShowError("Could not reach the server — is app.py still running?");
  }
}

let cdDebounce = null;

function cdScheduleFetch(delay = 300) {
  clearTimeout(cdDebounce);
  cdDebounce = setTimeout(cdFetchDesign, delay);
}

[cdPolesInput, cdZerosInput, cdOvershootInput, cdTargetTsInput].forEach((input) => {
  input.addEventListener("input", () => {
    // The zero bound moves with the specs, so let the backend re-pick it.
    cdState.zeroLocation = null;
    cdScheduleFetch();
  });
});

cdPdBtn.addEventListener("click", () => {
  cdState.kind = "pd";
  cdSyncZeroControl();
  cdFetchDesign();
});

cdLeadBtn.addEventListener("click", () => {
  cdState.kind = "lead";
  cdState.zeroLocation = null;
  cdSyncZeroControl();
  cdFetchDesign();
});

cdZeroSlider.addEventListener("input", () => {
  cdState.zeroLocation = Number(cdZeroSlider.value);
  cdZeroValue.textContent = `s = −${cdFormat(cdState.zeroLocation, 2)}`;
  cdScheduleFetch(90);
});

async function cdLoadPresets() {
  try {
    const res = await fetch("/api/compensator-presets");
    const presets = await res.json();
    presets.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-btn";
      button.textContent = preset.name;
      button.addEventListener("click", () => {
        cdPolesInput.value = preset.poles;
        cdZerosInput.value = preset.zeros;
        cdOvershootInput.value = preset.overshoot;
        cdTargetTsInput.value = preset.target_ts;
        cdState.zeroLocation = null;
        cdFetchDesign();
      });
      cdPresetRow.appendChild(button);
    });
  } catch (err) {
    /* presets are a convenience; the inputs work without them */
  }
}

let cdResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(cdResizeTimer);
  cdResizeTimer = setTimeout(cdRenderLocus, 150);
});

cdSyncZeroControl();
cdLoadPresets();
cdFetchDesign();
