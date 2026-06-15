
const BASE_SCENARIO_ID = "base";

const SCENARIO_DATA = {
  councilName: "Albury City Council · 2026",
  ratingYear: "2026-27",
  ratePeg: 0.036,
  lastUpdated: "2026-05-26",
  categories: [
    { id: "residential",            name: "Residential" },
    { id: "residential-village",    name: "Residential - Village" },
    { id: "residential-transition", name: "Residential - Transition" },
    { id: "residential-rural",      name: "Residential - Rural" },
    { id: "farmland",               name: "Farmland" },
    { id: "business",               name: "Business" },
    { id: "business-village",       name: "Business - Village" },
    { id: "business-transition",    name: "Business - Transition" },
    { id: "cbd-promo-A",            name: "Business - CBD Promotional Zone A" },
    { id: "cbd-promo-B",            name: "Business - CBD Promotional Zone B" },
    { id: "cbd-promo-C",            name: "Business - CBD Promotional Zone C" },
  ],
  base: {
    "residential":            { baseAmount: 304.00, adValorem: 0.00542614 },
    "residential-village":    { baseAmount: 304.00, adValorem: 0.00461222 },
    "residential-transition": { baseAmount: 304.00, adValorem: 0.00542614 },
    "residential-rural":      { baseAmount: 304.00, adValorem: 0.00379830 },
    "farmland":               { baseAmount: 304.00, adValorem: 0.00217045 },
    "business":               { baseAmount: 798.00, adValorem: 0.00910834 },
    "business-village":       { baseAmount: 436.00, adValorem: 0.00455417 },
    "business-transition":    { baseAmount: 798.00, adValorem: 0.00910834 },
    "cbd-promo-A":            { baseAmount: 798.00, adValorem: 0.00092293 + 0.00910834}, // base business rate + promo rate
    "cbd-promo-B":            { baseAmount: 798.00, adValorem: 0.00042028 + 0.00910834},
    "cbd-promo-C":            { baseAmount: 798.00, adValorem: 0.00027888 + 0.00910834},
  },
  scenarios: [
    {
      id: "base",
      name: "Scenario 1 - No SRV",
      increases: [0.036, 0.036, 0.036],
    },
    {
      id: "srv-40",
      name: "Scenario 2 - SRV of 40% over 3 years",
      increases: [0.14, 0.13, 0.13],
    },
    {
      id: "srv-42",
      name: "Scenario 3 - SRV of 42% over 2 years",
      increases: [0.21, 0.21],
    },
  ],
};

const els = {
  form:           document.getElementById("rates-form"),
  category:       document.getElementById("category"),
  landValue:      document.getElementById("land-value"),
  result:         document.getElementById("result"),
  councilName:    document.getElementById("council-name"),
  cadenceToggle:  document.getElementById("cadence-toggle"),
  noticeHelp:      document.getElementById("notice-help"),
  noticeHelpOpen:  document.getElementById("notice-help-open"),
  noticeHelpClose: document.getElementById("notice-help-close"),
};

const state = {
  data: null,
  hasResult: false,
  cadence: "annual", // "annual" | "weekly" — display cadence for dollar figures
};

/* ---------- Init ---------- */

function init() {
  state.data = SCENARIO_DATA;

  if (state.data.councilName) els.councilName.textContent = state.data.councilName;

  populateCategories(state.data.categories);

  els.form.addEventListener("submit", onSubmit);
  els.category.addEventListener("change", onCategoryChange);
  els.landValue.addEventListener("input", onLandValueInput);
  els.cadenceToggle.addEventListener("click", onCadenceClick);

  els.noticeHelpOpen.addEventListener("click", () => els.noticeHelp.showModal());
  els.noticeHelpClose.addEventListener("click", () => els.noticeHelp.close());
  els.noticeHelp.addEventListener("click", onNoticeHelpClick);
}

/* ---------- Notice help dialog ---------- */

// Close on backdrop click. The inner panel covers the dialog's entire
// content box, so a click whose target is the <dialog> itself can only
// have landed on the backdrop.
function onNoticeHelpClick(e) {
  if (e.target === els.noticeHelp) els.noticeHelp.close();
}

/* ---------- Land value input formatting ---------- */

// The land-value box is a text input so we can render thousands separators.
// On each keystroke we strip everything but digits, re-insert commas, and
// keep the caret at the same position relative to the surrounding digits.
function onLandValueInput() {
  const el = els.landValue;
  const digitsBeforeCaret = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;

  const digits = el.value.replace(/\D/g, "");
  const formatted = digits ? Number(digits).toLocaleString("en-AU") : "";
  el.value = formatted;

  // Restore the caret just after the same number of digits as before.
  let pos = 0, seen = 0;
  while (pos < formatted.length && seen < digitsBeforeCaret) {
    if (/\d/.test(formatted[pos])) seen++;
    pos++;
  }
  el.setSelectionRange(pos, pos);
}

/* ---------- Cadence toggle (annual / weekly) ---------- */

function onCadenceClick(e) {
  const btn = e.target.closest(".cadence-toggle__btn");
  if (!btn) return;
  const cadence = btn.dataset.cadence;
  if (cadence === state.cadence) return;

  state.cadence = cadence;
  for (const b of els.cadenceToggle.querySelectorAll(".cadence-toggle__btn")) {
    const active = b.dataset.cadence === cadence;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (state.hasResult) recalculate();
}

/* ---------- Category change ---------- */

function onCategoryChange() {
  if (state.hasResult) recalculate();
}

/* ---------- Population ---------- */

function populateCategories(categories) {
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    els.category.appendChild(opt);
  }
}

/* ---------- Derived scenario stats ---------- */

function cumulativeMultiplier(increases, throughYear) {
  // throughYear is 1-indexed; default to full schedule
  const upto = throughYear ?? increases.length;
  let m = 1;
  for (let i = 0; i < upto; i++) m *= (1 + increases[i]);
  return m;
}

/* ---------- Calculation ---------- */

/**
 * NSW LG Act 1993 (s.497–500) rates formula:
 *   rates = baseAmount + (landValue × adValoremRate)
 * Subject to minimum rate floor under s.548.
 *
 * Scenario rates are derived from the base rate set by applying the
 * cumulative multiplier of the scenario's per-year increases up to
 * (and including) the selected year. The multiplier is applied uniformly
 * to baseAmount, adValorem, and minimumRate.
 */
function calculateRates({ landValue, baseRates, multiplier }) {
  const baseAmount   = (baseRates.baseAmount ?? 0) * multiplier;
  const adValorem    = baseRates.adValorem * multiplier;
  const minimumRate  = (baseRates.minimumRate ?? 0) * multiplier;

  const adValoremPortion = landValue * adValorem;
  const calculated = baseAmount + adValoremPortion;
  const annual = Math.max(calculated, minimumRate);
  const minimumApplied = annual > calculated;

  return {
    baseAmount,
    adValoremRate: adValorem,
    adValoremPortion,
    calculated,
    minimum: minimumRate,
    minimumApplied,
    annual,
    quarterly: annual / 4,
    weekly: annual / 52,
  };
}

/* ---------- Submission ---------- */

function onSubmit(e) {
  e.preventDefault();
  recalculate();
}



function recalculate() {
  const categoryId = els.category.value;
  const landValue = parseFloat(els.landValue.value.replace(/,/g, ""));

  if (!categoryId || !Number.isFinite(landValue) || landValue < 0) {
    showError("Please select a category and enter a valid land value.");
    return;
  }

  const baseRates = state.data.base[categoryId];
  if (!baseRates) {
    showError(`No base rates configured for category "${categoryId}".`);
    return;
  }

  const calc = (multiplier) =>
    calculateRates({ landValue, baseRates, multiplier });

  const baseScenario = state.data.scenarios.find(s => s.id === BASE_SCENARIO_ID);
  const maxYears = Math.max(...state.data.scenarios.map(s => s.increases.length));

  // Base year = the year before the SRV period, i.e. no increases applied.
  // Derived from the same base rates, so it's identical across all scenarios.
  const baseYear = calc(1);

  // Extend each scenario to the full horizon. Years beyond a scenario's own
  // schedule are filled with the base ("rate peg only") scenario's per-year
  // increases, so a shorter SRV continues at the rate peg afterwards.
  let hasPegFill = false;
  const scenarioResults = state.data.scenarios.map(scenario => {
    const effectiveIncreases = [];
    for (let i = 0; i < maxYears; i++) {
      if (i < scenario.increases.length) {
        effectiveIncreases.push(scenario.increases[i]);
      } else {
        hasPegFill = true;
        effectiveIncreases.push(baseScenario.increases[i] ?? state.data.ratePeg ?? 0);
      }
    }
    return {
      scenario,
      isBase: scenario.id === BASE_SCENARIO_ID,
      effectiveIncreases,
      yearResults: effectiveIncreases.map((_, i) =>
        calc(cumulativeMultiplier(effectiveIncreases, i + 1))
      ),
    };
  });

  const baseEntry = scenarioResults.find(r => r.isBase);
  const categoryName = state.data.categories.find(c => c.id === categoryId).name;

  renderTable({ scenarioResults, baseEntry, baseYear, maxYears, hasPegFill, categoryName, landValue });
}

/* ---------- Rendering ---------- */

const fmtCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

const fmtCurrency0 = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const fmt = (n) => fmtCurrency.format(n);
const fmtWhole = (n) => fmtCurrency0.format(n);
const fmtSigned = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;

function renderTable({ scenarioResults, baseEntry, baseYear, maxYears, hasPegFill, categoryName, landValue }) {
  const weekly = state.cadence === "weekly";
  const val = (r) => weekly ? r.weekly : r.annual;
  const amountLabel = weekly ? "Weekly ordinary rates" : "Annual ordinary rates";
  const dollarIncreaseLabel = weekly ? "Weekly increase ($)" : "Annual increase ($)";

  const label = escapeHtml(categoryName);

  const colCount = 1 + 1 + maxYears + 1; // label + base year + years + cumulative

  // Financial year per column. The base year is the rating year; each
  // subsequent year advances one financial year (e.g. "2026-27" → 2026/27,
  // 2027/28, …). offset 0 = base year, 1 = Year 1, etc.
  const fyStart = parseInt(state.data.ratingYear, 10);
  const fyText = (offset) => {
    if (!Number.isFinite(fyStart)) return "";
    const start = fyStart + offset;
    return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
  };
  const fySub = (offset) => {
    const t = fyText(offset);
    return t ? `<span class="tbl__col-sub">${t}</span>` : "";
  };

  // Header
  let yearTh = "";
  for (let y = 1; y <= maxYears; y++) {
    yearTh += `<th class="tbl__col-year">Year ${y}${fySub(y)}</th>`;
  }
  const thead = `<tr>
    <th class="tbl__col-label"></th>
    <th class="tbl__col-baseyear">Base year${fySub(0)}</th>
    ${yearTh}
    <th class="tbl__col-summary">Cumulative<span class="tbl__col-sub">increase vs base year</span></th>
  </tr>`;

  // Body — built as a wide table (desktop) and as stacked cards (mobile)
  // from the same per-scenario values; CSS shows one or the other.
  let tbody = "";
  let cards = "";

  for (const { scenario, isBase, effectiveIncreases, yearResults } of scenarioResults) {
    const srvYears = scenario.increases.length;
    // The cumulative column totals the full horizon (every year column,
    // including peg-filled years) for all scenarios.
    const cumYears = maxYears;
    const cumulativePct = cumulativeMultiplier(effectiveIncreases, cumYears) - 1;
    const groupSub = isBase
      ? "rate peg only"
      : `${fmtPct(cumulativePct)} cumulative`;

    tbody += `<tr class="tbl__group-header${isBase ? "" : " tbl__group-header--srv"}">
      <td colspan="${colCount}">
        <span class="tbl__group-name">${escapeHtml(scenario.name)}</span>
        <span class="tbl__group-sub">${groupSub}</span>
      </td>
    </tr>`;

    // Peg-filled years (beyond the SRV's own schedule) get a marker.
    const isPeg = (y) => !isBase && y > srvYears;
    const pegClass = (y) => isPeg(y) ? " tbl__cell--peg" : "";
    const pegMark = (y) => isPeg(y) ? `<sup class="tbl__peg-mark">*</sup>` : "";

    // Dollar row — base year, each year, cumulative increase vs base year
    let amountCells = "";
    for (let y = 1; y <= maxYears; y++) {
      amountCells += `<td class="tbl__cell${pegClass(y)}">${fmt(val(yearResults[y - 1]))}${pegMark(y)}</td>`;
    }
    const cumulativeAmount = val(yearResults[cumYears - 1]) - val(baseYear);
    tbody += `<tr class="tbl__data-row">
      <td class="tbl__sub-label">${amountLabel}</td>
      <td class="tbl__cell tbl__cell--baseyear">${fmt(val(baseYear))}</td>
      ${amountCells}
      <td class="tbl__cell tbl__cell--cumulative">${fmtSigned(cumulativeAmount)}</td>
    </tr>`;

    // Annual increase (%) row — unaffected by the cadence toggle
    let pctCells = "";
    for (let y = 1; y <= maxYears; y++) {
      pctCells += `<td class="tbl__cell tbl__cell--dim${pegClass(y)}">${fmtPct(effectiveIncreases[y - 1])}${pegMark(y)}</td>`;
    }
    tbody += `<tr class="tbl__data-row tbl__data-row--sub">
      <td class="tbl__sub-label tbl__sub-label--dim">Annual increase (%)</td>
      <td class="tbl__cell tbl__cell--baseyear tbl__cell--na">—</td>
      ${pctCells}
      <td class="tbl__cell tbl__cell--cumulative">${fmtPct(cumulativePct)}</td>
    </tr>`;

    // Dollar increase from the previous year (year 1 compares to base year).
    // Shown for every scenario, including the rate-peg-only base scenario.
    let annualDollarCells = "";
    for (let y = 1; y <= maxYears; y++) {
      const prev = y === 1 ? baseYear : yearResults[y - 2];
      const d = val(yearResults[y - 1]) - val(prev);
      annualDollarCells += `<td class="tbl__cell tbl__cell--diff${pegClass(y)}">${fmtSigned(d)}</td>`;
    }
    const dollarGroupEnd = isBase ? " tbl__data-row--group-end" : "";
    tbody += `<tr class="tbl__data-row tbl__data-row--diff${dollarGroupEnd}">
      <td class="tbl__sub-label">${dollarIncreaseLabel}</td>
      <td class="tbl__cell tbl__cell--baseyear tbl__cell--na">—</td>
      ${annualDollarCells}
      <td class="tbl__cell tbl__cell--na">—</td>
    </tr>`;

    // SRV-only comparison rows
    if (!isBase) {
      // Difference vs the rate-peg-only scenario, year by year
      let diffCells = "";
      for (let y = 1; y <= maxYears; y++) {
        const d = val(yearResults[y - 1]) - val(baseEntry.yearResults[y - 1]);
        diffCells += `<td class="tbl__cell tbl__cell--diff${pegClass(y)}">${fmtSigned(d)}</td>`;
      }
      tbody += `<tr class="tbl__data-row tbl__data-row--diff tbl__data-row--group-end">
        <td class="tbl__sub-label">Difference vs rate peg only</td>
        <td class="tbl__cell tbl__cell--baseyear tbl__cell--na">—</td>
        ${diffCells}
        <td class="tbl__cell tbl__cell--na">—</td>
      </tr>`;
    }

    // Mobile card — same figures, stacked vertically
    let cardYears = "";
    for (let y = 1; y <= maxYears; y++) {
      let metrics = `<div class="scard__metric"><span class="scard__k">Annual increase (%)</span><span class="scard__v">${fmtPct(effectiveIncreases[y - 1])}</span></div>`;
      const prevYear = y === 1 ? baseYear : yearResults[y - 2];
      const annualDollar = val(yearResults[y - 1]) - val(prevYear);
      metrics += `<div class="scard__metric"><span class="scard__k">${dollarIncreaseLabel}</span><span class="scard__v scard__v--diff">${fmtSigned(annualDollar)}</span></div>`;
      if (!isBase) {
        const diff = val(yearResults[y - 1]) - val(baseEntry.yearResults[y - 1]);
        metrics += `<div class="scard__metric"><span class="scard__k">Difference vs rate peg only</span><span class="scard__v scard__v--diff">${fmtSigned(diff)}</span></div>`;
      }
      cardYears += `<li class="scard__year${isPeg(y) ? " scard__year--peg" : ""}">
        <div class="scard__year-top">
          <span class="scard__year-label">Year ${y}${pegMark(y)}<span class="scard__fy">${fyText(y)}</span></span>
          <span class="scard__year-amount">${fmt(val(yearResults[y - 1]))}</span>
        </div>
        <div class="scard__metrics">${metrics}</div>
      </li>`;
    }

    cards += `<article class="scard${isBase ? "" : " scard--srv"}">
      <div class="scard__head">
        <span class="scard__name">${escapeHtml(scenario.name)}</span>
        <span class="scard__sub">${groupSub}</span>
      </div>
      <div class="scard__base">
        <span class="scard__k">Base year<span class="scard__fy">${fyText(0)}</span></span>
        <span class="scard__v">${fmt(val(baseYear))}</span>
      </div>
      <ul class="scard__years">${cardYears}</ul>
      <div class="scard__cumulative">
        <span class="scard__k">Cumulative increase</span>
        <span class="scard__v">${fmtSigned(cumulativeAmount)} · ${fmtPct(cumulativePct)}</span>
      </div>
    </article>`;
  }

  const footnote = hasPegFill
    ? `<p class="tbl__footnote">* Continues at the rate peg after the SRV period ends.</p>`
    : "";

  els.result.className = "result";
  els.result.innerHTML = `
    <p class="result__scenario">${label} · ${fmtWhole(landValue)} land value</p>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    <div class="scards">${cards}</div>
    ${footnote}
  `;

  els.cadenceToggle.hidden = false;
  state.hasResult = true;
  requestAnimationFrame(() => els.result.classList.add("is-revealed"));
}

function showError(message) {
  els.result.className = "result result--empty";
  els.result.innerHTML = `<p class="result__placeholder">${escapeHtml(message)}</p>`;
  els.cadenceToggle.hidden = true;
  state.hasResult = false;
}

/* ---------- Helpers ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- Go ---------- */

init();