const BOND = JSON.parse(document.getElementById("bond-data").textContent);
const $ = id => document.getElementById(id);

const fmt = (n, d) => {
  d = d === undefined ? 6 : d;
  if (n === null || n === undefined || isNaN(n)) return "";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 4) });
};
const inr = (n, d) => "₹" + fmt(n, d === undefined ? 2 : d);

let lastEdited = "price";
let priceTouched = false;

function bondPayload() {
  return {
    security_name: BOND.security_name || "",
    isin: BOND.isin || null,
    coupon: String(BOND.coupon),
    coupon_frequency: BOND.coupon_frequency || "Annual",
    face_value: String(BOND.face_value),
    maturity: BOND.maturity,
    type: BOND.type || "",
    issuer_category: BOND.issuer_category || "",
    credit_rating: BOND.credit_rating || "",
    offer_yield: BOND.offer_yield,
    offer_price: BOND.offer_price,
    min_investment: BOND.min_investment,
    issue_date: BOND.issue_date || null,
    first_coupon: BOND.first_coupon || null,
    call_date: BOND.call_date || null,
    put_date: BOND.put_date || null,
    day_count: BOND.day_count_used || "",
    coupon_type: BOND.coupon_type || "",
    rating_agency: BOND.rating_agency || "",
    guarantee: BOND.guarantee || "",
    listing: BOND.listing || "",
    issue_size: BOND.issue_size || "",
    mode: BOND.mode || "",
    sector: BOND.sector || "",
    series: BOND.series || "",
    taxable: BOND.taxable || "",
    notes: BOND.notes || "",
    redemptions: (BOND.redemptions_list && BOND.redemptions_list.length) ? JSON.stringify(BOND.redemptions_list) : "",
  };
}

function setRows(id, rows) {
  const tb = $(id).querySelector("tbody");
  tb.innerHTML = rows.map(r => "<tr>" + r.map((c, i) => "<td" + (i > 0 ? ' class="num"' : "") + ">" + c + "</td>").join("") + "</tr>").join("");
}

function recalc(fromField) {
  lastEdited = fromField;
  const err = $("err"); err.textContent = "";
  const mode = lastEdited === "yield" ? "yield_to_price" : "price_to_yield";
  let cleanPrice = parseFloat($("priceIn").value);
  if (fromField === "price" && !priceTouched && BOND.offer_price != null && !isNaN(BOND.offer_price)) {
    cleanPrice = BOND.offer_price;
  }
  const body = {
    mode: mode,
    price: cleanPrice,
    yield: parseFloat($("yieldIn").value),
    settle: $("settleIn").value,
    qty: parseFloat($("qtyIn").value) || 1,
    slab: 30,
    listed: "1",
    price_basis: "clean",
    yield_basis: "xirr",
    bond: bondPayload()
  };
  fetch("/api/calc_full", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok) { err.textContent = res.j.error || "compute failed"; return; }
      render(res.j);
    })
    .catch(function (e) { err.textContent = String(e); });
}

function render(r) {
  const nB = parseFloat($("qtyIn").value) || 1;
  const face = BOND.face_value || 0;
  if (lastEdited === "yield") {
    $("priceIn").value = fmt(r.clean_price, 4);
  } else {
    $("yieldIn").value = fmt(r.xirr_pre, 4);
  }
  $("kYtm").textContent = fmt(r.xirr_pre, 4) + "%";
  $("kYtmS").textContent = "market BEY " + fmt(r.ytm, 4) + "%";
  $("kClean").textContent = fmt(r.clean_price, 4);
  $("kDirty").textContent = "dirty " + fmt(r.dirty_price, 4);
  $("kAcc").textContent = fmt(r.accrued_per100, 4);
  $("kAccS").textContent = r.accrued_days + " days accrued";
  $("kTotal").textContent = inr(r.total, 2);
  $("kTotalS").textContent = nB.toLocaleString("en-IN") + " bond(s) × ₹" + face.toLocaleString("en-IN") + " FV";

  const metrics = [
    ["Investor YTM (XIRR)", fmt(r.xirr_pre, 4) + "%"],
    ["Market BEY (YTM)", fmt(r.ytm, 4) + "%"],
    ["Effective annual yield", fmt(r.effective_annual, 4) + "%"],
    ["Current yield", fmt(r.current_yield, 4) + "%"],
    ["Macaulay duration (yrs)", fmt(r.macaulay, 4)],
    ["Modified duration", fmt(r.modified, 4)],
    ["Convexity", fmt(r.convexity, 4)],
    ["XIRR (post-tax)", fmt(r.xirr_post, 4) + "%"],
    ["Accrued interest /100", fmt(r.accrued_per100, 6) + " (" + r.accrued_days + " days)"],
    ["Clean price /100", fmt(r.clean_price, 6)],
    ["Dirty price /100", fmt(r.dirty_price, 6)],
    ["Principal consideration", inr(r.principal, 2)],
    ["Stamp duty @0.0001%", inr(r.stamp, 6)],
    ["Total settlement amount", inr(r.total, 2)],
  ];
  if (r.ytc && r.ytc.length) {
    metrics.push(["Yield to call", r.ytc.map(function (x) { return x[0] + " → " + fmt(x[1], 4) + "%"; }).join("; ")]);
    if (r.ytw) metrics.push(["Yield to worst", r.ytw.type + " (" + r.ytw.date + ") " + fmt(r.ytw.yield, 4) + "%"]);
  }
  setRows("metrics", metrics);

  setRows("movement", r.movement.map(function (m) {
    return [fmt(m.yield, 4) + "%", fmt(m.price, 4), (m.delta >= 0 ? "+" : "") + fmt(m.delta, 4)];
  }));

  const scale = face / 100 * nB;
  setRows("cfs", r.cashflows.map(function (c) {
    return [c.date, fmt(c.coupon, 4), fmt(c.redemption, 4), fmt(c.total_per_bond, 4), inr(c.total_qty, 2)];
  }));
}

$("priceIn").addEventListener("input", function () { priceTouched = true; recalc("price"); });
$("qPrice").addEventListener("input", function () { priceTouched = true; });
$("yieldIn").addEventListener("input", function () { recalc("yield"); });
$("settleIn").addEventListener("input", function () { recalc(lastEdited); });
$("qtyIn").addEventListener("input", function () { recalc(lastEdited); });

$("quoteForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  const btn = $("quoteBtn"); btn.disabled = true; btn.textContent = "Generating";
  try {
    const payload = {
      slug: BOND.slug,
      client_name: $("qName").value,
      client_contact: $("qContact").value,
      qty: +$("qQty").value || 1,
      price: priceTouched ? (+$("qPrice").value || 0) : (BOND.offer_price != null ? BOND.offer_price : (+$("qPrice").value || 0)),
      price_type: $("qPriceType").value,
      settle: $("qSettle").value,
      slab: (+$("qSlab").value || 30) / 100,
      listed: $("qListed").value,
      notes: $("qNotes").value,
    };
    fetch("/api/quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = "Generate Quote Sheet";
        if (!res.ok) { alert("Error: " + (res.j.error || "quote failed")); return; }
        const data = res.j;
        $("quoteResult").style.display = "block";
        $("quoteNo").textContent = "Quote " + data.quote_no + " generated successfully";
        $("dlXlsx").href = data.xlsx;
        $("dlPdf").href = data.pdf;
        const s = data.summary;
        setRows("quoteSummary", [
          ["Clean price (per ₹100)", fmt(s.clean_price, 4)],
          ["Accrued interest (" + s.accrued_days + " days)", fmt(s.accrued_per100, 6)],
          ["Dirty price (per ₹100)", fmt(s.dirty_price, 4)],
          ["Principal consideration", inr(s.principal, 2)],
          ["Stamp duty @0.0001%", inr(s.stamp, 6)],
          ["TOTAL SETTLEMENT AMOUNT", inr(s.total, 2)],
          ["YTM", fmt(s.ytm, 4) + "%"],
          ["Effective annual yield", fmt(s.effective_annual, 4) + "%"],
          ["XIRR (pre-tax)", fmt(s.xirr_pre, 4) + "%"],
          ["XIRR (post-tax)", fmt(s.xirr_post, 4) + "%"],
        ]);
        $("quoteResult").scrollIntoView({ behavior: "smooth" });
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = "Generate Quote Sheet"; alert("Error: " + e.message); });
  } catch (e) {
    btn.disabled = false; btn.textContent = "Generate Quote Sheet"; alert("Error: " + e.message);
  }
});

recalc("price");
