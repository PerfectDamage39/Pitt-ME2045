const tabBtnExplorer = document.getElementById("tab-btn-explorer");
const tabBtnEditor = document.getElementById("tab-btn-editor");
const tabPanelExplorer = document.getElementById("tab-panel-explorer");
const tabPanelEditor = document.getElementById("tab-panel-editor");

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
let pzResponseType = "step";

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

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function renderPoleZeroMarker(point, kind, color) {
  const { x, y } = dataToPixel(point.real, point.imag);

  const selectedPoint = [...pzPoles, ...pzZeros].find((p) => p.id === pzSelectedId);
  const isSelected = selectedPoint && (point.id === selectedPoint.id || point.id === selectedPoint.pairId);

  if (isSelected) {
    pzSvg.appendChild(
      svgEl("circle", { cx: x, cy: y, r: 18, fill: "none", stroke: cssVar("--ink-primary"), "stroke-width": 2 })
    );
  }

  if (kind === "pole") {
    const s = 9;
    pzSvg.appendChild(svgEl("line", { x1: x - s, y1: y - s, x2: x + s, y2: y + s, stroke: color, "stroke-width": 2.5 }));
    pzSvg.appendChild(svgEl("line", { x1: x - s, y1: y + s, x2: x + s, y2: y - s, stroke: color, "stroke-width": 2.5 }));
  } else {
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

  pzPoles.forEach((p) => renderPoleZeroMarker(p, "pole", cssVar("--critical")));
  pzZeros.forEach((z) => renderPoleZeroMarker(z, "zero", cssVar("--accent")));
}

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
      body: JSON.stringify({ num, den, response_type: pzResponseType, amplitude: 1 }),
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

const placePoleBtn = document.getElementById("place-pole-btn");
const placeZeroBtn = document.getElementById("place-zero-btn");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const clearAllBtn = document.getElementById("clear-all-btn");
const gainInput = document.getElementById("gain-input");
const editorStepBtn = document.getElementById("editor-step-btn");
const editorImpulseBtn = document.getElementById("editor-impulse-btn");

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

editorStepBtn.addEventListener("click", () => {
  pzResponseType = "step";
  editorStepBtn.classList.add("active");
  editorImpulseBtn.classList.remove("active");
  updateAndFetch();
});

editorImpulseBtn.addEventListener("click", () => {
  pzResponseType = "impulse";
  editorImpulseBtn.classList.add("active");
  editorStepBtn.classList.remove("active");
  updateAndFetch();
});

let pzDebounceTimer = null;

gainInput.addEventListener("input", () => {
  const value = Number(gainInput.value);
  if (!Number.isFinite(value) || gainInput.value.trim() === "") {
    return;
  }
  pzGain = value;
  clearTimeout(pzDebounceTimer);
  pzDebounceTimer = setTimeout(updateAndFetch, 300);
});

addPoleZeroPoint("pole", -0.5, 1.94);
renderPoleZeroCanvas();
updateAndFetch();

function showTab(name) {
  const showExplorer = name === "explorer";
  tabPanelExplorer.classList.toggle("hidden", !showExplorer);
  tabPanelEditor.classList.toggle("hidden", showExplorer);
  tabBtnExplorer.classList.toggle("active", showExplorer);
  tabBtnEditor.classList.toggle("active", !showExplorer);
  tabBtnExplorer.setAttribute("aria-selected", String(showExplorer));
  tabBtnEditor.setAttribute("aria-selected", String(!showExplorer));

  if (!showExplorer) {
    Plotly.Plots.resize("editor-chart");
  }
}

function initTabs() {
  tabBtnExplorer.addEventListener("click", () => showTab("explorer"));
  tabBtnEditor.addEventListener("click", () => showTab("editor"));
}

initTabs();
