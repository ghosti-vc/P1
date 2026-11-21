// SoloLatino: películas, series, anime y doramas en Latino desde sololatino.net (basado en Cine TV, solo esa fuente).
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const enc = encodeURIComponent;
const e2 = (s) => enc(s).replace(/~/g, "%7E");

function log(...a) { try { kino.log(...a); } catch { /* sin registro */ } }
function tr(es, en) { return kino.lang === "en-US" ? en : es; }
function dec(s) { try { return decodeURIComponent(s); } catch { return String(s || ""); } }
function msg(e) { return String((e && e.message) || e).slice(0, 80); }
function decodeEnt(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function text(s) { return decodeEnt(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); }
function abs(base, u) { if (!u) return ""; try { return new URL(u, base).href; } catch { return ""; } }
function pathOf(u) { return String(u).replace(/^https?:\/\/[^/]+/, ""); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function attrs(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tag))) out[(m[1] || m[3]).toLowerCase()] = decodeEnt(m[2] != null ? m[2] : m[4]);
  return out;
}
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_STILL = "https://image.tmdb.org/t/p/w300";
function tmdb(p, base) { return !p ? undefined : /^https?:/.test(p) ? p : p.startsWith("/") ? (base || TMDB_IMG) + p : undefined; }


const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64bin(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  let out = "", bits = 0, acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64.indexOf(s[i]); bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
  }
  return out;
}
function b64utf8(s) { try { return decodeURIComponent(b64bin(s).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")); } catch { return b64bin(s); } }
function b64enc(str) {
  const bytes = unescape(encodeURIComponent(str));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1), c = bytes.charCodeAt(i + 2);
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : "=") + (i + 2 < bytes.length ? B64[c & 63] : "=");
  }
  return out;
}

// ---- Red (con cookies a mano para los sitios que las piden) -------------------------------------
const jars = {};
function jarSave(u, r) {
  let sc = "";
  try { sc = (r.headers && (r.headers.get ? r.headers.get("set-cookie") : r.headers["set-cookie"])) || ""; } catch { /* sin cabecera */ }
  if (!sc) return;
  const j = jars[hostOf(u)] || (jars[hostOf(u)] = {});
  String(sc).split(/,(?=\s*[^;,\s]+=)/).forEach((c) => {
    const kv = c.split(";")[0].trim();
    const i = kv.indexOf("=");
    if (i > 0) j[kv.slice(0, i)] = kv.slice(i + 1);
  });
}
function jarHeader(u) { const j = jars[hostOf(u)]; return j ? Object.keys(j).map((k) => k + "=" + j[k]).join("; ") : ""; }

async function web(url, opt) {
  const o = opt || {};
  const go = async (extra) => {
    const h = Object.assign({ "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9" }, o.headers || {});
    const ck = [jarHeader(url), extra].filter(Boolean).join("; ");
    if (ck) h.Cookie = ck;
    const r = await kino.fetch(url, { method: o.method || "GET", headers: h, body: o.body });
    jarSave(url, r);
    return { r, t: String(await r.text()) };
  };
  let x = await go("");
  if (x.r.status === 503) {
    const m = /document\.cookie\s*=\s*['"]ypg_chal=([0-9]{9,12}\.[a-f0-9]{64});/.exec(x.t);
    if (m) x = await go("ypg_chal=" + m[1]);
  }
  if (!x.r.ok) throw kino.error("unavailable", "web " + x.r.status + " " + hostOf(url));
  return x.t;
}
async function jget(url, referer) {
  const t = await web(url, { headers: { Accept: "application/json, text/plain, */*", Referer: referer || "" } });
  try { return JSON.parse(t); } catch { throw kino.error("unavailable", "json inválido " + hostOf(url)); }
}
async function gqlPost(api, site, query, variables, referer) {
  const t = await web(api, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: site, Referer: referer || site + "/", "x-brand-host": hostOf(site), "x-forwarded-host": hostOf(site) },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  let j;
  try { j = JSON.parse(t); } catch { throw kino.error("unavailable", "graphql inválido"); }
  if (!j || j.errors || !j.data) throw kino.error("unavailable", "graphql: " + msg(j && j.errors && j.errors[0] && j.errors[0].message));
  return j.data;
}

// Datos de Next.js incrustados (self.__next_f.push).
function flight(html) {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { out += JSON.parse(m[1]); } catch { /* trozo ilegible */ } }
  return out;
}
function jsonAt(s, start) {
  const open = s[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function jsonAfter(s, marker) { const i = s.indexOf(marker); return i < 0 ? null : jsonAt(s, i + marker.length); }

// =====================================================================================================
// FUENTES. Cada una ofrece: cats, list(cat, página), search(q), episodes(key), embeds(key, esPelícula)
//   cat: movie | series | anime | dorama | dmovie
//   item: { key, title, year, poster, cat, movie }     episodio: { season, number, key, title, thumb }
//   embed: { url, server, lang }
// =====================================================================================================
const SRC = {};
const nn = (x) => (x == null ? "" : String(x));

// ---- SoloLatino (HTML + API con sesión) ---------------------------------------------------------
{
  const SITE = "https://sololatino.net";
  const PATH = { movie: "/peliculas", series: "/series", anime: "/animes", dorama: "/doramas" };
  function catOf(u) { return /\/(serie|series|tv)\//.test(u) ? "series" : /\/anime\//.test(u) ? "anime" : "movie"; }
  function cards(html) {
    const out = [], seen = new Set();
    (html.match(/<div[^>]*class=["'][^"']*\bcard\b[^"']*["'][\s\S]*?<\/a>[\s\S]*?<\/div>/gi) || []).forEach((b) => {
      const hm = /href=["']([^"']*\/(?:pelicula|peliculas|serie|series|tv|anime)\/[^"']+)["']/i.exec(b);
      if (!hm) return;
      const path = pathOf(abs(SITE, hm[1]));
      if (seen.has(path)) return;
      const tm = /alt=["']([^"']+)["']/i.exec(b) || /class=["']card__title["'][^>]*>([^<]+)</i.exec(b);
      const title = text(tm ? tm[1] : "");
      if (!title) return;
      seen.add(path);
      const img = (/src=["'](https?:\/\/image\.tmdb\.org\/[^"']+)["']/i.exec(b) || /<img[^>]+?src=["'](https?:\/\/[^"']+)["']/i.exec(b) || [])[1] || "";
      const year = text((/class=["']card__year["'][^>]*>([^<]+)</i.exec(b) || [])[1] || "");
      const cat = catOf(path);
      out.push({ key: path, title, year, poster: img && !/no-poster/.test(img) ? img : undefined, cat, movie: cat === "movie" });
    });
    return out;
  }
  const LCACHE = new Map();
  SRC.sl = {
    name: "SoloLatino", cats: ["movie", "series", "anime", "dorama"],
    async list(cat, page) {
      const ck = "l|" + cat + "|" + page;
      const hit = LCACHE.get(ck);
      if (hit && Date.now() - hit.t < 300000) return hit.v;
      const v = await this.list1(cat, page);
      LCACHE.set(ck, { t: Date.now(), v });
      return v;
    },
    async list1(cat, page) {
      const html = await web(SITE + PATH[cat] + (page > 1 ? "?page=" + page : ""), { headers: { Referer: SITE + "/" } });
      let items = cards(html);
      if (cat === "dorama") items = items.map((x) => Object.assign(x, { cat: "dorama", movie: false }));
      else items = items.filter((x) => x.cat === cat);
      return { items, hasNext: items.length >= 12 && new RegExp("[?&]page=" + (page + 1) + "(?!\\d)").test(html) };
    },
    async search(q) {
      const j = await jget(SITE + "/api/search/suggest?q=" + enc(q), SITE + "/");
      return (Array.isArray(j) ? j : []).filter((x) => x && x.url && x.type !== "person" && !/\/persona\//.test(x.url)).map((x) => {
        const path = pathOf(abs(SITE, x.url));
        const cat = catOf(path);
        return { key: path, title: text(x.title || x.name), year: nn(x.year), poster: abs(SITE, x.image || x.poster || x.cover || "") || undefined, cat, movie: cat === "movie" };
      }).filter((x) => x.title);
    },
    async episodes(key) {
      const html = await web(SITE + key, { headers: { Referer: SITE + "/" } });
      const out = [], seen = new Set();
      const re = /<a[^>]+href=["']([^"']+\/temporada-(\d+)\/episodio-(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const path = pathOf(abs(SITE, m[1]));
        if (seen.has(path)) continue;
        seen.add(path);
        const nm = /<p[^>]*class=["'][^"']*text-sm[^"']*font-semibold[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(m[4]);
        const pl = /<p[^>]*class=["'][^"']*line-clamp-2[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(m[4]);
        const th = /<img[^>]+?src=["'](https?:\/\/[^"']+)["']/i.exec(m[4]);
        out.push({ season: Number(m[2]), number: Number(m[3]), key: path, title: text(nm ? nm[1] : ""), thumb: th ? th[1] : undefined, overview: text(pl ? pl[1] : "").slice(0, 400) });
      }
      return out;
    },
    async embeds(key) {
      const url = SITE + key;
      const out = [];
      let html = "";
      try {
        const both = await Promise.all([web(SITE + "/sanctum/csrf-cookie", { headers: { Referer: SITE + "/" } }).catch(() => ""), web(url, { headers: { Referer: SITE + "/" } })]);
        html = both[1];
        const xsrf = dec((jars[hostOf(SITE)] || {})["XSRF-TOKEN"] || "");
        const btns = [];
        const re = /<button[^>]*data-player-token=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;
        let m;
        while ((m = re.exec(html))) btns.push({ t: m[1], label: text(m[2]) });
        const seen = new Set();
        await Promise.all(btns.map(async (b) => {
          try {
            const r = await web(SITE + "/api/player-url", { method: "POST", body: JSON.stringify({ t: b.t }), headers: { "Content-Type": "application/json", Accept: "application/json", "X-XSRF-TOKEN": xsrf, Origin: SITE, Referer: url } });
            const u = (JSON.parse(r) || {}).url;
            if (!u || seen.has(u)) return;
            seen.add(u);
            out.push({ url: u, server: /pelisserieshoy/.test(u) ? "PREMIUM" : b.label || hostOf(u), lang: "Latino", rec: /pelisserieshoy/.test(u) });
          } catch (e) { log("sololatino servidor: " + msg(e)); }
        }));
      } catch (e) { log("sololatino: " + msg(e)); }
      if (!out.length) {
        // Respaldo: reproductor por id de IMDb.
        let mid = "";
        const ep = /\/temporada-(\d+)\/episodio-(\d+)/.exec(key);
        const tt = /(tt\d{7,10})/.exec(html);
        if (ep && tt) mid = tt[1] + "-" + ep[1] + "x" + String(ep[2]).padStart(2, "0");
        else if (!ep && tt) mid = tt[1];
        if (mid) {
          out.push({ url: "https://player.pelisserieshoy.com/f/" + mid, server: "PREMIUM", lang: "Latino", rec: true });
          out.push({ url: "https://embed69.org/f/" + mid, server: "embed69", lang: "Latino" });
        }
      }
      return out;
    },
  };
}


// =====================================================================================================
// ANIME: TioAnime, Latanime, AnimeFLV, AnimeAV1, JKAnime y MonosChinos
// =====================================================================================================
const aTitle = (t) => { const x = text(t); return x.replace(/\s*[-–(\[]?\s*(?:sub\s*)?(?:espa[ñn]ol|latino|castellano)\b.*$/i, "").trim() || x; };
const aNum = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? Math.floor(n) || 1 : 1; };
const aSrv = (u, base) => { let x = nn(u).trim().replace(/\\\//g, "/"); if (x.startsWith("//")) x = "https:" + x; return /^https?:\/\//.test(x) ? x : abs(base, x); };
function aPush(out, seen, url, server, lang) { if (!url || seen.has(url) || !/^https?:/.test(url)) return; seen.add(url); out.push({ url, server: server || hostOf(url), lang }); }
const aPost = (url, form, referer, extra) => web(url, {
  method: "POST", body: Object.keys(form).map((k) => enc(k) + "=" + enc(form[k])).join("&"),
  headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: referer, Origin: abs(url, "/").replace(/\/$/, "") }, extra || {}),
});
const aItem = (key, title, poster) => ({ key, title: aTitle(title), year: "", poster: poster || undefined, cat: "anime", movie: false });

// =====================================================================================================
// MOTOR: unir fuentes, catálogo, búsqueda, capítulos y reproducción
// =====================================================================================================
const ORDER = ["sl"];
const SITE_OF = { sl: "https://sololatino.net" };
const ROWS = [
  { id: "movie", title: ["Películas", "Movies"], genre: "peliculas" },
  { id: "series", title: ["Series", "Series"], genre: "series" },
  { id: "anime", title: ["Anime", "Anime"], genre: "anime" },
  { id: "dorama", title: ["Doramas", "Dramas"], genre: "doramas" },
];
const GENRE = { movie: "peliculas", series: "series", anime: "anime", dorama: "doramas", dmovie: "doramas", cartoon: "series" };
const srcs = () => ORDER.filter((k) => SRC[k]);

// Une los resultados de varias fuentes: el mismo título se vuelve una sola tarjeta con varias fuentes.
function mergeLists(lists) {
  const groups = new Map(), order = [];
  const longest = lists.reduce((n, l) => Math.max(n, l.items.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const it = l.items[i];
      if (!it || !it.title) continue;
      const y = Number(it.year) || 0;
      let k = (it.movie ? "m" : "s") + ":" + norm(it.title);
      if (!k.endsWith(":")) { /* clave válida */ } else continue;
      let g = groups.get(k);
      if (g && it.movie && y && g.y && Math.abs(g.y - y) > 1) { k += ":" + y; g = groups.get(k); }
      if (!g) { g = { movie: !!it.movie, title: it.title, year: it.year || "", y, poster: it.poster, cat: it.cat, alts: [] }; groups.set(k, g); order.push(g); }
      if (!g.poster && it.poster) g.poster = it.poster;
      if (!g.year && it.year) { g.year = it.year; g.y = y; }
      if (!g.alts.some((a) => a.src === l.src)) g.alts.push({ src: l.src, key: it.key });
    }
  }
  return order;
}
const altStr = (alts) => alts.slice(0, 8).map((a) => a.src + "~" + e2(a.key)).join(",");
function parseAlts(s) {
  return String(s || "").split(",").filter(Boolean).map((x) => { const i = x.indexOf("~"); return { src: x.slice(0, i), key: dec(x.slice(i + 1)) }; }).filter((a) => SRC[a.src]);
}
function toCards(groups) {
  return groups.map((g) => ({
    id: "g-" + (g.movie ? "m-" : "s-") + norm(g.title).replace(/ /g, "-").slice(0, 48) + (g.y ? "-" + g.y : ""),
    ref: "g|" + (g.movie ? "m" : "s") + "|" + enc(g.title.slice(0, 80)) + "|" + g.year + "|" + altStr(g.alts),
    title: g.title.slice(0, 200),
    kind: g.movie ? "movie" : "series",
    genres: [GENRE[g.cat] || "peliculas"],
    year: g.y || undefined,
    poster: g.poster ? String(g.poster).replace(/(image\.tmdb\.org\/t\/p\/)(?:w500|w780|w1280|original)\//, "$1w342/") : undefined,
  }));
}

async function listAll(cat, page) {
  const ks = srcs().filter((k) => SRC[k].cats.includes(cat));
  const res = await Promise.allSettled(ks.map((k) => SRC[k].list(cat, page)));
  const lists = [];
  let hasNext = false;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("lista " + ks[i] + "/" + cat + ": " + msg(r.reason)); return; }
    lists.push({ src: ks[i], items: r.value.items || [] });
    if (r.value.hasNext) hasNext = true;
  });
  return { items: toCards(mergeLists(lists)), hasNext, ok: lists.map((l) => l.src + ":" + l.items.length).join(" ") };
}

export async function home() {
  await null;
  const res = await Promise.allSettled(ROWS.map((r) => listAll(r.id, 1)));
  const rows = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("home " + ROWS[i].id + ": " + msg(r.reason)); return; }
    log("home " + ROWS[i].id + " -> " + r.value.ok);
    if (r.value.items.length) rows.push({ id: "row-" + ROWS[i].id, title: tr(ROWS[i].title[0], ROWS[i].title[1]), genre: ROWS[i].genre, ref: ROWS[i].id, items: r.value.items.slice(0, 30) });
  });
  if (!rows.length) throw kino.error("unavailable", "inicio sin resultados", { userMessage: tr("No se pudo cargar el catálogo.", "Could not load the catalog.") });
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const cat = String(ref || "");
  if (!ROWS.some((r) => r.id === cat)) throw kino.error("not_found", "catálogo desconocido");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const p = await listAll(cat, n);
  const out = { items: p.items };
  if (p.hasNext) out.next = String(n + 1);
  return out;
}

export async function search(query) {
  await null;
  const q = String((query && query.q) || "").replace(/[<>"\\]/g, " ").trim().slice(0, 80);
  if (!q) return [];
  const ks = srcs();
  const res = await Promise.allSettled(ks.map((k) => SRC[k].search(q)));
  const lists = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("búsqueda " + ks[i] + ": " + msg(r.reason)); return; }
    lists.push({ src: ks[i], items: (r.value || []).slice(0, 20) });
  });
  const cards = toCards(mergeLists(lists));
  log("búsqueda: " + cards.length + " (" + lists.map((l) => l.src + ":" + l.items.length).join(" ") + ")");
  return cards;
}

// ---- Capítulos ----------------------------------------------------------------------------------
const epCache = new Map();
async function epsOf(a) {
  const k = a.src + "~" + a.key;
  if (!epCache.has(k)) epCache.set(k, SRC[a.src].episodes(a.key).catch((e) => { epCache.delete(k); throw e; }));
  return epCache.get(k);
}

export async function episodes(ref) {
  await null;
  const p = String(ref || "").split("|");
  if (p[0] !== "g" || !p[4]) throw kino.error("not_found", "referencia desconocida");
  const title = dec(p[2]);
  const alts = parseAlts(p[4]);
  if (p[1] === "m") return { series: { title }, episodes: [{ season: 1, number: 1, ref: "p|1|1|" + p[4] + "||" + p[2] + "|" + p[3], title: tr("Película", "Movie") }] };
  const res = await Promise.allSettled(alts.map((a) => epsOf(a)));
  let best = null, bestAlt = null;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { log("capítulos " + alts[i].src + ": " + msg(r.reason)); return; }
    if (!best || r.value.length > best.length) { best = r.value; bestAlt = alts[i]; }
  });
  if (!best || !best.length) throw kino.error("not_found", "sin capítulos", { userMessage: tr("Este título aún no tiene capítulos.", "No episodes yet.") });
  const seen = new Set(), out = [];
  best.slice().sort((a, b) => a.season - b.season || a.number - b.number).forEach((e) => {
    const k = e.season + "x" + e.number;
    if (seen.has(k)) return;
    seen.add(k);
    const o = { season: e.season, number: e.number, ref: "p|" + e.season + "|" + e.number + "|" + p[4] + "|" + bestAlt.src + "~" + e2(e.key) + "|" + p[2] + "|" + p[3], title: e.title || tr("Capítulo ", "Episode ") + e.number };
    if (e.thumb) o.thumbnail = e.thumb;
    if (e.overview) o.overview = e.overview;
    out.push(o);
  });
  log("capítulos: " + out.length + " (" + bestAlt.src + ")");
  return { series: { title }, episodes: out };
}

// ---- Reproducción -------------------------------------------------------------------------------
const BAD_MEDIA = /(?:\.jpe?g|\.png|\.gif|\.webp|\.vtt|\.srt|\/thumbnail|googima|doubleclick|yandex)/i;

function unwrap(u) {
  try {
    const x = new URL(u);
    if (x.hostname === "embedshortener.co") {
      const tok = x.pathname.split("/").pop().split(".")[1];
      const j = JSON.parse(b64utf8(tok));
      const t = b64utf8(String(j.link));
      if (/^https?:\/\//.test(t)) return t;
    }
  } catch { /* se queda tal cual */ }
  return u;
}
const isDirect = (u) => /\.(?:m3u8|mp4)(?:\?|$)/i.test(u) && !BAD_MEDIA.test(u);


// ---- Extracción rápida (sin navegador) ----------------------------------------------------------
function unpackJs(p, a, c, k) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const baseN = (n, b) => { let r = ""; while (n > 0) { r = chars[n % b] + r; n = Math.floor(n / b); } return r || "0"; };
  if (a < 2 || a > 62 || c < 0 || c > 100000) return "";
  const lookup = {};
  for (let i = 0; i < c; i++) { const key = baseN(i, a); lookup[key] = k[i] ? k[i] : key; }
  return p.replace(/\b\w+\b/g, (w) => (w in lookup ? lookup[w] : w));
}
function mediaFromPage(page, referer) {
  const cleaned = decodeEnt(String(page).replace(/\\\//g, "/").replace(/\\u0026/g, "&"));
  const f = /\b(?:var|let|const)\s+links\s*=\s*(\{[^{}]+\})/.exec(cleaned);
  if (f) { try { const l = JSON.parse(f[1]); const r = ["hls4", "hls3", "hls2"].map((k) => l[k]).filter((x) => typeof x === "string" && x).map((x) => abs(referer, x)); if (r.length) return r; } catch { /* sigue */ } }
  const s = /sources?\s*:\s*\[([^\]]+)\]/i.exec(cleaned);
  if (s) { const m = s[1].match(/https?:\/\/[^"'\s,]+(?:\.m3u8|\.mp4)[^"'\s,]*/gi); if (m && m.length) return m; }
  const h = /["']hls["']\s*:\s*["'](https?:\/\/[^"']+)["']/i.exec(cleaned);
  if (h) return [h[1]];
  const m3 = /https?:\/\/[^\s'"<>\\]+\.m3u8(?:\?[^\s'"<>\\]*)?/i.exec(cleaned);
  if (m3) return [m3[0]];
  const mp = /https?:\/\/[^\s'"<>\\]+\.mp4(?:\?[^\s'"<>\\]*)?/i.exec(cleaned);
  return mp ? [mp[0]] : [];
}
const NO_QUICK = /byse|filemoon|mega\.nz|zarato|netu|drive\.google|okhd|ok\.ru|embed69|mp4\.nu/i;
async function quickMedia(url) {
  const h = hostOf(url);
  if (/vidara\.(to|so)$/.test(h)) {
    const code = (/\/(?:e|player)\/([^/?#]+)/.exec(url) || [])[1];
    if (!code) return null;
    const t = await web("https://" + new URL(url).hostname + "/api/stream", { method: "POST", body: JSON.stringify({ filecode: code, device: "web", codecs: [] }), headers: { "Content-Type": "application/json", Accept: "application/json", Referer: url } });
    const d = JSON.parse(t) || {};
    const u = d.streaming_url || d.file || d.url || (d.data && (d.data.streaming_url || d.data.url));
    return u && /^https?:/.test(u) ? { url: u, referer: url } : null;
  }
  if (NO_QUICK.test(h + url)) return null;
  const origin = "https://" + new URL(url).hostname + "/";
  let page = await web(url, { headers: { Referer: origin } });
  const redirect = /window\.location\.href\s*=\s*['"](https?:\/\/[^'"\s]+)['"]/.exec(page);
  if (redirect) page = await web(decodeEnt(redirect[1]), { headers: { Referer: url } });
  if (/countries are not allowed|no longer available as it expired|human to start the video/i.test(page)) return null;
  let src = mediaFromPage(page, url);
  if (!src.length) {
    const re = /eval\(function\(p,a,c,k,e,[a-zA-Z]\)[\s\S]*?\}\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
    let m;
    while ((m = re.exec(page)) && !src.length) src = mediaFromPage(unpackJs(m[1].replace(/\\'/g, "'"), +m[2], +m[3], m[4].split("|")), url);
  }
  const good = src.find((x) => /^https?:/.test(x) && !BAD_MEDIA.test(x));
  return good ? { url: good, referer: url } : null;
}

async function capture(o) {
  const url = unwrap(o.url);
  if (isDirect(url)) return { url, mime: /\.m3u8/i.test(url) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: SITE_OF[o.src] + "/" } };
  try {
    const q = await quickMedia(url);
    if (q) { log("rápido " + hostOf(url)); return { url: q.url, mime: /\.m3u8/i.test(q.url) ? "application/x-mpegurl" : "video/mp4", headers: { Referer: q.referer } }; }
  } catch (e) { log("rápido " + hostOf(url) + ": " + msg(e)); }
  if (!kino.browser || typeof kino.browser.capture !== "function") throw new Error("sin navegador");
  const page = await kino.browser.capture(url, { timeoutMs: 15000, headers: { Referer: SITE_OF[o.src] ? SITE_OF[o.src] + "/" : "https://" + hostOf(url) + "/" } });
  const media = page && Array.isArray(page.media) ? page.media : [];
  log("captura " + o.src + " " + hostOf(url) + ": " + media.length);
  const first = media.find((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url) && !BAD_MEDIA.test(x.url));
  if (!first) throw new Error("sin medios");
  const out = { url: first.url, mime: first.mime || first.mimeType || (/\.m3u8(\?|$)/i.test(first.url) ? "application/x-mpegurl" : "video/mp4") };
  out.headers = first.headers && typeof first.headers === "object" ? first.headers : { Referer: url };
  return out;
}

function firstSuccess(tasks) {
  return new Promise((done) => {
    let pending = tasks.length;
    if (!pending) { done(null); return; }
    tasks.forEach((t) => {
      Promise.resolve(t).then((v) => { if (v) done(v); }, (e) => log("falló: " + msg(e))).then(() => { if (--pending === 0) done(null); });
    });
  });
}

function rank(o) {
  const lang = /latino|\blat\b|mx/i.test(o.lang + " " + o.server) ? 0 : /castell|espa/i.test(o.lang) ? 1 : /sub|vose|kr/i.test(o.lang) ? 3 : 2;
  const h = hostOf(o.url);
  const host = /goodstream|vimeos|unlimplay|voe\.|filemoon|byse|streamwish|vidara|okhd|vidhide|doodstream|ok\.ru/i.test(h) ? 0 : /drive\.google/.test(h) ? 4 : /mega\.nz|zarato|netu/.test(h) ? 6 : 2;
  return lang * 10 + host + (o.rec ? 0 : 1);
}

async function playFrom(opts) {
  const seen = new Set();
  const list = opts.filter((o) => { const u = unwrap(o.url); if (seen.has(u)) return false; seen.add(u); return true; }).sort((a, b) => rank(a) - rank(b));
  log("servidores: " + list.slice(0, 8).map((o) => o.src + "/" + hostOf(o.url) + "/" + (o.lang || "-")).join(" | "));
  for (let i = 0; i < Math.min(list.length, 9); i += 3) {
    const got = await firstSuccess(list.slice(i, i + 3).map((o) => capture(o)));
    if (got) return got;
  }
  return null;
}

async function embedsFor(a, epKey, movie) {
  const list = await SRC[a.src].embeds(movie ? a.key : epKey, movie);
  return list.map((o) => Object.assign({ src: a.src }, o));
}


export async function resolve(ref) {
  await null;
  const p = String(ref || "").split("|");
  let movie, season, number, alts, primary = null, title = "", year = "";
  if (p[0] === "g" && p[1] === "m" && p[4]) { movie = true; alts = parseAlts(p[4]); title = dec(p[2]); year = p[3]; }
  else if (p[0] === "p" && p[3] != null) {
    season = Number(p[1]); number = Number(p[2]); alts = parseAlts(p[3]); title = dec(p[5] || ""); year = p[6] || "";
    if (p[4]) { const i = p[4].indexOf("~"); primary = { src: p[4].slice(0, i), key: dec(p[4].slice(i + 1)) }; } else movie = true;
    title = dec(p[5] || ""); year = p[6] || "";
  } else throw kino.error("not_found", "referencia desconocida");
  if (!alts.length) throw kino.error("not_found", "sin fuentes");

  let got = null;
  if (movie) {
    const res = await Promise.allSettled(alts.map((a) => embedsFor(a, "", true)));
    const opts = [];
    res.forEach((r, i) => { if (r.status === "fulfilled") opts.push(...r.value); else log("servidores " + alts[i].src + ": " + msg(r.reason)); });
    got = await playFrom(opts);
  } else {
    if (primary && SRC[primary.src]) {
      try { got = await playFrom(await embedsFor(primary, primary.key, false)); } catch (e) { log("principal " + primary.src + ": " + msg(e)); }
    }
    if (!got) {
      const others = alts.filter((a) => !primary || a.src !== primary.src);
      const res = await Promise.allSettled(others.map(async (a) => {
        const eps = await epsOf(a);
        const ep = eps.find((e) => e.season === season && e.number === number);
        return ep ? embedsFor(a, ep.key, false) : [];
      }));
      const opts = [];
      res.forEach((r) => { if (r.status === "fulfilled") opts.push(...r.value); });
      got = await playFrom(opts);
    }
  }
  if (got) return got;
  throw kino.error("not_found", "sin video directo", { userMessage: tr("No se pudo obtener el video. Prueba de nuevo.", "Could not get the video. Try again.") });
}
