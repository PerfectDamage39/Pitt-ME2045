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
