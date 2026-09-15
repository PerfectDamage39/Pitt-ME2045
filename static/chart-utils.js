function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartAxis(titleText, showZeroline, zerolineWidth = 1, zerolineColor = cssVar("--axis")) {
  const muted = cssVar("--ink-muted");
  return {
    title: { text: titleText, font: { color: muted } },
    gridcolor: cssVar("--gridline"),
    gridwidth: 1,
    linecolor: cssVar("--axis"),
    zeroline: showZeroline,
    zerolinecolor: zerolineColor,
    zerolinewidth: zerolineWidth,
    tickfont: { color: muted },
  };
}

/** Size an s-plane chart to its own data, and return ranges that render at a
 *  true 1:1 scale in the resulting box.
 *
 *  These charts need equal units per pixel on both axes, because angles are
 *  read off them geometrically. Plotly's own `scaleanchor` does that by
 *  inflating a range, which in a fixed-height box stretches the real axis far
 *  past anything interesting and squeezes the locus into a narrow band; worse,
 *  which axis it inflates depends on the previous render, so the same inputs
 *  can settle differently depending on how you got there.
 *
 *  Deriving the ranges from the final pixel geometry instead makes the result
 *  exact and order-independent. Callers use the returned ranges and set no
 *  scaleanchor at all.
 *
 *  Returns null when the element has no width yet (it is hidden), in which
 *  case there is nothing to size and the caller should use its own ranges.
 */
function fitSquareAspect(elementId, xRange, yRange, margin, minHeight, maxHeight) {
  const el = document.getElementById(elementId);
  const chromeX = margin.l + margin.r;
  const chromeY = margin.t + margin.b;

  el.style.maxWidth = "";
  el.style.margin = "";

  // Measure the element itself, after clearing any width cap from a previous
  // fit -- the parent's clientWidth would include the card's own padding.
  const available = el.clientWidth;
  if (!available) return null;

  const plotWidth = Math.max(available - chromeX, 40);

  // Grow the box towards the content's own shape. At 1:1 a box wider than the
  // content has to pad the real axis to compensate, so the more portrait the
  // content is, the taller the chart wants to be to keep that padding small.
  const contentAspect = (xRange[1] - xRange[0]) / (yRange[1] - yRange[0]);
  const plotHeight = Math.max(
    Math.min(plotWidth / contentAspect, maxHeight - chromeY),
    minHeight - chromeY,
    40
  );
  el.style.height = `${Math.round(plotHeight + chromeY)}px`;

  const pixelAspect = plotWidth / plotHeight;

  let [x0, x1] = xRange;
  let [y0, y1] = yRange;
  const widthAtScale = (y1 - y0) * pixelAspect;

  if (widthAtScale >= x1 - x0) {
    // The landmarks need less width than the card gives us. Spend the surplus
    // extending the real axis to the left, where the poles sit and where the
    // branches run -- anchoring on the right keeps the origin in view instead
    // of drifting a chunk of empty right-half-plane into the frame.
    x0 = x1 - widthAtScale;
  } else {
    const heightAtScale = (x1 - x0) / pixelAspect;
    const middle = (y0 + y1) / 2;
    y0 = middle - heightAtScale / 2;
    y1 = middle + heightAtScale / 2;
  }

  return { x: [x0, x1], y: [y0, y1] };
}

function formatCoefficientNumber(n) {
  // Round away float noise (e.g. from typed values like "0.1") without
  // showing pointless trailing zeros.
  return String(Math.round(n * 10000) / 10000);
}

function formatPolynomial(coeffs) {
  const degree = coeffs.length - 1;
  const terms = [];

  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const power = degree - i;
    const magnitude = Math.abs(c);

    let powerHtml = "";
    if (power === 1) powerHtml = "s";
    else if (power > 1) powerHtml = `s<sup>${power}</sup>`;

    const showCoefficient = power === 0 || magnitude !== 1;
    const coefficientHtml = showCoefficient ? formatCoefficientNumber(magnitude) : "";

    terms.push({ negative: c < 0, html: coefficientHtml + powerHtml });
  });

  if (terms.length === 0) return "0";

  let html = (terms[0].negative ? "−" : "") + terms[0].html;
  for (let i = 1; i < terms.length; i++) {
    html += (terms[i].negative ? " − " : " + ") + terms[i].html;
  }
  return html;
}


/** Cap for an s-plane chart's height: as much as the content wants, but never
 *  so much that the controls above it get pushed off a short screen. */
function availableChartHeight(hardCap) {
  return Math.min(hardCap, Math.max(340, window.innerHeight - 260));
}

/** Match a companion chart's height to the s-plane chart beside it, so the
 *  grid row's stretched card is filled rather than left half empty. */
function matchChartHeight(targetId, sourceId) {
  const source = document.getElementById(sourceId);
  const target = document.getElementById(targetId);
  if (!source.style.height || !target || !target.data) return;
  if (target.style.height === source.style.height) return;
  target.style.height = source.style.height;
  Plotly.Plots.resize(targetId);
}
