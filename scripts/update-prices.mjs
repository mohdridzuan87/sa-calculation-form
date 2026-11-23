// Reads the Toyota Malaysia price list page and writes prices.json (model list + OTR price w/out insurance,
// Peninsular Malaysia, Individual Private). Run monthly by .github/workflows/update-prices.yml.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const URL_PAGE = "https://www.toyota.com.my/en/price-and-model-tools/price-list.html";
const OUT = new URL("../prices.json", import.meta.url);

const res = await fetch(URL_PAGE, { headers: { "User-Agent": "Mozilla/5.0 (compatible; price-list-sync)" } });
if (!res.ok) throw new Error("Toyota page returned HTTP " + res.status);
const html = await res.text();

function arrayAt(pos) {
  const start = html.indexOf("[", pos);
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return JSON.parse(html.slice(start, k + 1)); }
  }
  throw new Error("unterminated array");
}

const models = new Map();
for (const m of html.matchAll(/"gradeLists"\s*:/g)) {
  for (const g of arrayAt(m.index + m[0].length)) {
    if (models.has(g.id)) continue; // first entry = Peninsular Malaysia; later ones are Sabah/Sarawak/Langkawi/Labuan
    const raw = (g.price && g.price.retail) || "";
    const otr = Number(raw.replace(/[^0-9.]/g, ""));
    if (!g.header || !otr) continue;
    models.set(g.id, { id: g.id, name: g.header.trim(), otr, url: g.url || "" });
  }
}
const list = [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
if (list.length < 30) throw new Error("Only " + list.length + " models found - page layout may have changed; prices.json not updated");

let prev = null;
if (existsSync(OUT)) { try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* ignore */ } }
const same = prev && JSON.stringify(prev.models) === JSON.stringify(list);
const today = new Date().toISOString().slice(0, 10);
const out = { updated: same ? prev.updated : today, checked: today, source: URL_PAGE,
  note: "OTR price without insurance, Peninsular Malaysia, Individual Private", models: list };
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(same ? "No price changes" : "Updated", list.length, "models");
