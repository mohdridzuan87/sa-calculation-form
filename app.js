/* SA Calculation Form app - UI, local storage, PDF export */
(function () {
  "use strict";
  var STORE = "sacalc.forms.v1";
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- number helpers ---------- */
  function num(v) {
    var n = parseFloat(String(v === undefined || v === null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function money(n) {
    var neg = n < 0, s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return neg ? "-" + s : s;
  }
  function rm(n) { return n < 0 ? "(RM " + money(-n) + ")" : "RM " + money(n); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function fmtDate(s) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (s || ""); }

  /* ---------- calculations (same as the Excel form) ---------- */
  function compute(d) {
    return { totalSelling: num(d.otr) + num(d.ins) };
  }

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; } }
  function saveAll(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); return true; }
    catch (e) { toast("Could not save - phone storage is full."); return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var forms = load();
  var current = null;

  /* ---------- schema ---------- */
  var T = function (key, label, o) { return Object.assign({ key: key, label: label, type: "text" }, o || {}); };
  var M = function (key, label) { return { key: key, label: label, money: true }; };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SECTIONS = [
    { title: "1. Customer & vehicle", open: true, fields: [
      T("customer", "Customer"), T("sa", "SA"), T("month", "Month", { type: "select", options: [""].concat(MONTHS) }), T("regno", "Reg No"),
      T("regdate", "Reg Date", { type: "date" }), T("model", "Model")] },
    { title: "2. Pricing", open: true, fields: [
      M("otr", "OTR Price w/out Insurance"), M("ins", "Insurance"), { calc: "totalSelling", label: "TOTAL SELLING PRICE", big: true },
      M("loan", "Less Loan Amount"), M("sppn", "Less SPPN/MLM"), M("booking", "Less Booking"),
      M("dp1", "Less Downpayment - 1"), M("dp2", "Less Downpayment - 2"), M("dp3", "Less Downpayment - 3"),
      M("extra", "Less Extra Discounting"), M("broker_claims", "Broker Claims")] },
    { title: "3. Broker details", fields: [
      T("b_name", "Name"), T("b_ic", "IC"), T("b_bank", "Bank"),
      T("b_acct", "Account", { mode: "numeric" }), { hint: "Include front/back IC and bank statement." }] }
  ];
  /* SA Entitlement, OM Approval and Contributions are filled by the manager on the printed PDF, so they are not in the app. */

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function fieldEl(f) {
    if (f.sub) return el("div", { class: "sub", text: f.sub });
    if (f.hint) return el("div", { class: "hint", text: f.hint });
    if (f.calc) return el("div", { class: "calc" + (f.big ? " big" : "") }, [el("span", { text: f.label }), el("span", { id: "c_" + f.calc, text: "-" })]);
    if (f.money) {
      return el("div", { class: "money" }, [el("div", { class: "lbl", text: f.label }),
        el("input", { "data-k": f.key, type: "text", inputmode: "decimal", placeholder: "0.00", class: "mny" })]);
    }
    if (f.type === "select") {
      var sel = el("select", { "data-k": f.key });
      f.options.forEach(function (o) { sel.appendChild(el("option", { value: o, text: o || "- select -" })); });
      return el("label", { class: "f" }, [el("span", { text: f.label }), sel]);
    }
    var input = el("input", { "data-k": f.key, type: f.type });
    if (f.type === "text") { input.setAttribute("autocapitalize", "characters"); input.className = "caps"; }
    if (f.mode) input.setAttribute("inputmode", f.mode);
    return el("label", { class: "f" }, [el("span", { text: f.label }), input]);
  }
  function buildForm() {
    var form = $("form"); form.innerHTML = "";
    SECTIONS.forEach(function (s) {
      var d = el("details", { class: "sec" }, [el("summary", { text: s.title }), el("div", { class: "sec-body" }, s.fields.map(fieldEl))]);
      if (s.open) d.open = true;
      form.appendChild(d);
    });
    form.addEventListener("input", onInput);
  }

  function emptyForm() { return { regdate: "" }; }
  function fillForm(data) {
    document.querySelectorAll("#form [data-k]").forEach(function (i) {
      var v = data[i.getAttribute("data-k")]; v = v === undefined || v === null ? "" : v;
      if (i.tagName === "SELECT" && v && !Array.prototype.some.call(i.options, function (o) { return o.value === v; })) i.appendChild(el("option", { value: v, text: v }));
      i.value = v;
      if (i.className === "mny" && v) i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    refreshCalc();
  }
  function onInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k || !current) return;
    var t = e.target;
    if (t.className === "mny") {
      var pos = t.selectionStart, before = t.value.slice(0, pos).replace(/[^0-9.]/g, "").length;
      var raw = t.value.replace(/[^0-9.]/g, ""), dot = raw.indexOf(".");
      if (dot >= 0) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "").slice(0, 2);
      var ip = dot >= 0 ? raw.slice(0, dot) : raw, fp = dot >= 0 ? raw.slice(dot) : "";
      var out = ip.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fp;
      if (out !== t.value) {
        t.value = out;
        var n = 0, np = 0; while (np < out.length && n < before) { if (/[0-9.]/.test(out[np])) n++; np++; }
        try { t.setSelectionRange(np, np); } catch (x) { /* ignore */ }
      }
    }
    if (t.tagName === "INPUT" && t.type === "text" && t.className === "caps") {
      var up = t.value.toUpperCase();
      if (up !== t.value) { var p = t.selectionStart; t.value = up; try { t.setSelectionRange(p, p); } catch (x) { /* ignore */ } }
    }
    current.data[k] = t.value; refreshCalc(); scheduleSave();
  }
  function refreshCalc() {
    if (!current) return;
    var c = compute(current.data);
    ["totalSelling"].forEach(function (k) { var n = $("c_" + k); if (n) n.textContent = rm(c[k]); });
    $("dueVal").textContent = rm(c.totalSelling);
  }
  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrent, 300); }
  function saveCurrent() {
    if (!current) return;
    current.updated = Date.now();
    var i = forms.findIndex(function (o) { return o.id === current.id; });
    if (i < 0) forms.unshift(current); else forms[i] = current;
    saveAll(forms);
  }

  /* ---------- views ---------- */
  function showList() {
    saveCurrent(); current = null;
    $("listView").hidden = false; $("editView").hidden = true; $("editBar").hidden = true;
    $("backBtn").hidden = true; $("title").textContent = "SA Calculations";
    renderList(); window.scrollTo(0, 0);
  }
  function renderList() {
    forms.sort(function (a, b) { return b.updated - a.updated; });
    var box = $("orderList"); box.innerHTML = ""; $("emptyMsg").hidden = forms.length > 0;
    forms.forEach(function (o) {
      var d = o.data, c = compute(d);
      var info = el("div", { class: "info" }, [
        el("div", { class: "name", text: d.customer || "(no customer yet)" }),
        el("div", { class: "meta", text: [d.model, d.regno, d.month].filter(Boolean).join(" | ") || "Draft" }),
        el("div", { class: "amt", text: "Total selling price: " + rm(c.totalSelling) })]);
      var dup = el("button", { class: "small", text: "Copy" });
      var del = el("button", { class: "small danger", text: "Delete" });
      var card = el("div", { class: "order" }, [info, el("div", { class: "acts" }, [dup, del])]);
      info.addEventListener("click", function () { openForm(o.id); });
      dup.addEventListener("click", function () {
        var cp = { id: uid(), updated: Date.now(), data: JSON.parse(JSON.stringify(o.data)) };
        forms.unshift(cp); saveAll(forms); renderList(); toast("Copied");
      });
      del.addEventListener("click", function () {
        if (!confirm("Delete the form for " + (d.customer || "this customer") + "? This cannot be undone.")) return;
        forms = forms.filter(function (x) { return x.id !== o.id; }); saveAll(forms); renderList();
      });
      box.appendChild(card);
    });
  }
  function openForm(id) {
    var o = forms.find(function (x) { return x.id === id; }); if (!o) return;
    current = o;
    $("listView").hidden = true; $("editView").hidden = false; $("editBar").hidden = false;
    $("backBtn").hidden = false; $("title").textContent = "Calculations Form";
    fillForm(o.data); window.scrollTo(0, 0); location.hash = "#edit";
  }
  function newForm() {
    var o = { id: uid(), updated: Date.now(), data: emptyForm() };
    var last = forms[0] && forms[0].data;
    if (last && last.sa) o.data.sa = last.sa;
    o.data.month = MONTHS[new Date().getMonth()];
    forms.unshift(o); saveAll(forms); openForm(o.id);
  }

  /* ---------- PDF (A4 portrait, laid out like the paper form) ---------- */
  function buildPdf(d) {
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var c = compute(d), L = 20, R = 190;
    function lab(t, x, y, bold) { doc.setFont("helvetica", bold === false ? "normal" : "bold"); doc.setFontSize(9.5); doc.text(t, x, y); }
    function line(x1, x2, y, val, right) {
      if (typeof val === "string") val = val.toUpperCase();
      doc.setDrawColor(90); doc.setLineWidth(0.2); doc.line(x1, y + 1.2, x2, y + 1.2);
      if (val) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); if (right) doc.text(String(val), x2 - 1, y, { align: "right" }); else doc.text(String(val), x1 + 1, y); }
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("CALCULATIONS FORM", 105, 18, { align: "center" });
    var head = [["CUSTOMER", d.customer], ["SA", d.sa], ["MONTH", d.month], ["REG NO", d.regno], ["REG DATE", fmtDate(d.regdate)], ["MODEL", d.model]];
    head.forEach(function (h, i) { var y = 32 + i * 8; lab(h[0], L, y); lab(":", 52, y); line(55, R, y, h[1]); });
    var rows = [["OTR PRICE W/OUT INSURANCE", d.otr], ["INSURANCE", d.ins], ["TOTAL SELLING PRICE", c.totalSelling], ["LESS LOAN AMOUNT", d.loan],
      ["LESS SPPN/MLM", d.sppn], ["LESS BOOKING", d.booking], ["LESS DOWNPAYMENT - 1", d.dp1], ["LESS DOWNPAYMENT - 2", d.dp2],
      ["LESS DOWNPAYMENT - 3", d.dp3], ["LESS EXTRA DISCOUNTING", d.extra], ["BROKER CLAIMS", d.broker_claims]];
    rows.forEach(function (r, i) {
      var y = 90 + i * 8, v = (r[1] === "" || r[1] === undefined) ? "" : money(num(r[1]));
      lab(r[0], L, y); lab(":", 85, y); line(88, R, y, v, true);
    });
    lab("SA ENTITLEMENT", L, 190); doc.setFontSize(7); doc.text("*PLS DON'T FILL IN", 52, 190);
    var cols = ["BODY COMM", "HP", "INSURANCE", "MI", "VI", "TOTAL"];
    var cw = 28.3, x0 = L;
    cols.forEach(function (h, i) {
      var x = x0 + i * cw;
      doc.setFillColor(217, 225, 242); doc.rect(x, 194, cw, 8, "FD"); doc.rect(x, 202, cw, 9, "S");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(h, x + cw / 2, 199.3, { align: "center" });
    });
    lab("OM APPROVAL", 95, 224); lab(":", 125, 224); line(128, R, 224, "");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text("BROKER DETAILS", L, 238); doc.line(L, 239, L + 28, 239);
    [["NAME", d.b_name], ["IC", d.b_ic], ["BANK", d.b_bank], ["ACCOUNT", d.b_acct]].forEach(function (r, i) {
      var y = 246 + i * 8; lab(r[0], L, y); lab(":", 52, y); line(55, 102, y, r[1]);
    });
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.text("*INCLUDE FRONT/BACK IC AND BANK STATEMENT", L, 281);
    [["SA CONTRIBUTION", ""], ["COMP. CONTRIBUTION", ""], ["OTHERS", ""]].forEach(function (r, i) {
      var y = 255 + i * 8.5;
      doc.setDrawColor(0); doc.rect(108, y, 52, 8.5, "S"); doc.rect(160, y, 30, 8.5, "S");
      lab(r[0], 110, y + 5.6);
      if (r[1] !== "" && r[1] !== undefined && num(r[1]) !== 0) { doc.setFont("helvetica", "normal"); doc.text(money(num(r[1])), 188.5, y + 5.6, { align: "right" }); }
    });
    return doc;
  }
  function fileName(d) {
    var s = (d.customer || "customer").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return "SA_Calculation_" + s + "_" + (d.month || today()).replace(/[^A-Za-z0-9]+/g, "") + ".pdf";
  }
  function openSheet() {
    saveCurrent();
    var blob, name;
    try { blob = buildPdf(current.data).output("blob"); name = fileName(current.data); } catch (e) { toast("Could not create PDF: " + e.message); return; }
    var url = URL.createObjectURL(blob), body = $("sheetBody"); body.innerHTML = "";
    body.appendChild(el("div", { class: "fname", text: name + "  (" + Math.round(blob.size / 1024) + " KB, A4 1 page)" }));
    body.appendChild(el("a", { class: "primary act", href: url, download: name, text: "Download PDF" }));
    var file = null; try { file = new File([blob], name, { type: "application/pdf" }); } catch (e) { /* old browser */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      var sh = el("button", { class: "primary act sec2", type: "button", text: "Share (WhatsApp, Email, Drive...)" });
      sh.addEventListener("click", function () { navigator.share({ files: [file], title: name }).catch(function (e) { if (e.name !== "AbortError") toast("Share failed: " + e.message); }); });
      body.appendChild(sh);
    }
    body.appendChild(el("a", { class: "primary act sec2", href: url, target: "_blank", rel: "noopener", text: "Open / Print" }));
    $("sheet").hidden = false; $("sheet").dataset.url = url;
  }
  function closeSheet() {
    $("sheet").hidden = true; var u = $("sheet").dataset.url;
    if (u) setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  var toastTimer;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600); }

  /* ---------- wire up ---------- */
  buildForm();
  $("newBtn").addEventListener("click", newForm);
  $("backBtn").addEventListener("click", function () { if (location.hash === "#edit") history.back(); else showList(); });
  $("pdfBtn").addEventListener("click", openSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (e) { if (e.target.id === "sheet") closeSheet(); });
  window.addEventListener("hashchange", function () { if (location.hash !== "#edit" && current) showList(); });
  window.addEventListener("pagehide", saveCurrent);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveCurrent(); });
  if (location.hash === "#edit") history.replaceState(null, "", location.pathname);
  showList();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(function () {});
  window.__sa = { buildPdf: buildPdf, forms: function () { return forms; } };
})();
