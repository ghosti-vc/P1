// Pelisjuanita TV para Kino. Canales en vivo.
// Token: sha256(cert:paquete::seed:minutoEpoch).minutoEpoch

const BASE = "https://pelisjuanita.com/tv/app";
const CERT = "9381e4d77c1d42a3d02472331249bed8e76a8df6af7082214ea8fcfc30aa653d";
const PKG  = "com.pelisjuanita.app";
const UA   = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";
const HDR  = { "User-Agent": UA, Accept: "application/json" };
const CACHE_KEY = "canales";
const CACHE_MS = 10 * 60 * 1000;
const SEED_TTL = 3600000;
const RUTAS = ["canales_json.php", "canales.php", "canales.json"];
const REFS  = ["https://pelisjuanita.com/", "https://localhost/"];

let diag = [];

function enc(v) { return encodeURIComponent(String(v)); }

/* ---------- token ---------- */

async function seed() {
  const guardado = await kino.storage.get("seed");
  const cuando = Number(await kino.storage.get("seed_at")) || 0;
  if (guardado && Date.now() - cuando < SEED_TTL) return guardado;
  let s = "pj_sec_seed_2026_init";
  try {
    const r = await kino.fetch(BASE + "/version.php", { headers: HDR, timeoutMs: 12000 });
    if (r.ok) {
      const j = r.json();
      if (j && j.sec_seed) s = String(j.sec_seed);
    }
  } catch (e) {
    diag.push("version.php red");
  }
  await kino.storage.set("seed", s);
  await kino.storage.set("seed_at", String(Date.now()));
  return s;
}

async function token() {
  const s = await seed();
  const min = Math.floor(Date.now() / 60000);
  const h = await kino.crypto.hash("sha256", CERT + ":" + PKG + "::" + s + ":" + min);
  return "app_version=8&pj_token=" + enc(h + "." + min);
}

/* ---------- canales ---------- */

function limpio(c) {
  const nombre = String((c && c.nombre) || "").trim();
  const slug = String((c && c.slug) || "").trim();
  if (!nombre || !slug) return null;
  const dash = String(c.dash || "").trim();
  const hls = String(c.m3u8 || "").trim();
  const key = String(c.key || "").trim();
  const key2 = String(c.key2 || "").trim();
  let url = "";
  let drm = null;
  if (hls) url = hls;
  else if (dash) {
    url = dash;
    if (/^[0-9a-fA-F]{32}$/.test(key) && /^[0-9a-fA-F]{32}$/.test(key2)) {
      const kid = key.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase();
      drm = [{ type: "clearkey", keys: { [kid]: key2.toLowerCase() } }];
    }
  }
  const logo = String(c.logo || "").trim();
  return {
    slug,
    nombre,
    categoria: String(c.categoria || "").trim(),
    pais: String(c.pais || "").trim(),
    logo: /^https:/i.test(logo) ? logo : "",
    url,
    drm,
    embed: String(c.embed || "").trim()
  };
}

function parsear(texto) {
  let j = null;
  try { j = JSON.parse(texto); } catch (e) { return null; }
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.canales)) return j.canales;
  if (j && Array.isArray(j.datos)) return j.datos;
  if (j && typeof j === "object") {
    const out = [];
    for (const k in j) if (Array.isArray(j[k])) out.push.apply(out, j[k]);
    if (out.length) return out;
  }
  return null;
}

async function probar(ruta, ref, conToken) {
  const sep = ruta.indexOf("?") >= 0 ? "&" : "?";
  let cola = "app_version=8";
  if (conToken) {
    try { cola = await token(); } catch (e) { diag.push("token falla"); }
  }
  const url = BASE + "/" + ruta + sep + cola;
  let r = null;
  try {
    r = await kino.fetch(url, {
      headers: { "User-Agent": UA, Referer: ref, Accept: "application/json" },
      timeoutMs: 10000
    });
  } catch (e) {
    diag.push(ruta + (conToken ? " tok" : " sin") + " red");
    kino.log("prueba " + ruta + " red");
    return null;
  }
  const texto = r.text();
  const ini = String(texto).replace(/\s+/g, " ").slice(0, 90);
  diag.push(ruta + (conToken ? " tok" : " sin") + " " + r.status + " " + String(texto).length + " " + ini);
  kino.log("prueba " + ruta + (conToken ? " tok" : " sin") + " -> " + r.status + " " + ini);
  if (r.status === 403) {
    await kino.storage.set("seed", "");
    await kino.storage.set("seed_at", "0");
  }
  if (!r.ok) return null;
  const lista = parsear(texto);
  if (!lista || !lista.length) return null;
  diag.push("sirve " + ruta);
  return lista;
}

async function pedirCanales() {
  diag = [];
  const limite = Date.now() + 16000;
  for (const ref of REFS) {
    for (const ruta of RUTAS) {
      if (Date.now() > limite) { diag.push("tiempo agotado"); return null; }
      const a = await probar(ruta, ref, true);
      if (a) return a;
      if (Date.now() > limite) { diag.push("tiempo agotado"); return null; }
      const b = await probar(ruta, ref, false);
      if (b) return b;
    }
  }
  return null;
}

async function traerCanales() {
  const guardado = await kino.storage.get(CACHE_KEY);
  if (guardado) {
    try {
      const c = JSON.parse(guardado);
      if (c && Date.now() - Number(c.t) < CACHE_MS && Array.isArray(c.lista) && c.lista.length) return c.lista;
    } catch (e) {}
  }
  const crudos = await pedirCanales();
  if (!crudos) {
    diag.push("ninguna ruta respondio lista");
    throw kino.error("unavailable", "canales", {
      userMessage: "La lista de canales no responde ahora. Prueba de nuevo en un rato."
    });
  }
  const lista = [];
  for (const c of crudos) {
    const x = limpio(c);
    if (x) lista.push(x);
  }
  if (!lista.length) {
    diag.push("json con " + crudos.length + " y 0 utiles");
    diag.push("campos: " + Object.keys(crudos[0] || {}).join(","));
    throw kino.error("not_found", "canales vacio", {
      userMessage: "La lista llego con otro formato. Revisa el diagnostico."
    });
  }
  diag.push("utiles " + lista.length);
  try { await kino.storage.set(CACHE_KEY, JSON.stringify({ t: Date.now(), lista })); } catch (e) {}
  return lista;
}

function enLinea(x) {
  if (!x.url) return null;
  const s = { url: x.url, label: "Directo" };
  s.mime = x.url.includes(".m3u8") ? "application/vnd.apple.mpegurl" : "application/dash+xml";
  if (x.drm) s.drm = x.drm;
  s.headers = { "User-Agent": UA, Referer: "https://pelisjuanita.com/" };
  return s;
}

function itemDe(x, numero, categoryId) {
  const it = { kind: "live", id: "canal:" + x.slug, title: x.nombre, ref: "canal:" + x.slug, genre: "live" };
  if (numero) it.number = numero;
  if (categoryId) it.categoryId = categoryId;
  if (x.logo) it.poster = x.logo;
  const s = enLinea(x);
  if (s) it.stream = s;
  return it;
}

function diagItems() {
  const out = [];
  let n = 1;
  for (const d of diag) {
    out.push({ kind: "live", id: "diag:" + n, number: n, title: String(d).slice(0, 110), genre: "live" });
    n++;
    if (n > 14) break;
  }
  if (!out.length) out.push({ kind: "live", id: "diag:0", number: 1, title: "sin intentos", genre: "live" });
  return out;
}

/* ---------- catálogo ---------- */

export async function liveCategories() {
  await kino.sleep(0);
  let lista = [];
  try { lista = await traerCanales(); }
  catch (e) { return [{ id: "cat:diag", title: "PRUEBA", genre: "live" }]; }
  const cuenta = new Map();
  for (const x of lista) {
    const g = x.categoria || "General";
    cuenta.set(g, (cuenta.get(g) || 0) + 1);
  }
  const cats = [];
  for (const [g] of cuenta) {
    cats.push({ id: "cat:" + enc(g), title: g, genre: "live" });
    if (cats.length >= 60) break;
  }
  return cats;
}

export async function liveChannels(arg) {
  await kino.sleep(0);
  const categoryId = (arg && arg.categoryId) || "";
  if (categoryId === "cat:diag") {
    if (!diag.length) {
      try { await traerCanales(); } catch (e) {}
    }
    return { items: diagItems() };
  }
  let lista = [];
  try { lista = await traerCanales(); }
  catch (e) { return { items: diagItems() }; }
  const grupo = categoryId.indexOf("cat:") === 0 ? decodeURIComponent(categoryId.slice(4)) : "";
  const items = [];
  let num = 1;
  for (const x of lista) {
    if (grupo && (x.categoria || "General") !== grupo) continue;
    items.push(itemDe(x, num, categoryId));
    num = num > 9999 ? 1 : num + 1;
    if (items.length >= 500) break;
  }
  return { items };
}

export async function home() {
  await kino.sleep(0);
  let lista = [];
  try { lista = await traerCanales(); }
  catch (e) {
    return [{ id: "canales-diag", title: "PRUEBA", genre: "live", items: diagItems() }];
  }
  const fila = [];
  let num = 1;
  for (const x of lista) {
    fila.push(itemDe(x, num));
    num = num > 9999 ? 1 : num + 1;
    if (fila.length >= 60) break;
  }
  if (!fila.length) return [];
  return [{ id: "canales-vivo", title: "Canales en vivo", genre: "live", items: fila }];
}

export async function search(arg) {
  await kino.sleep(0);
  const t = String((arg && (arg.query || arg.q)) || arg || "").trim().toLowerCase();
  if (!t) return { items: [] };
  let lista = [];
  try { lista = await traerCanales(); }
  catch (e) { return { items: diagItems() }; }
  const items = [];
  for (const x of lista) {
    if (x.nombre.toLowerCase().indexOf(t) < 0) continue;
    items.push(itemDe(x, 0));
    if (items.length >= 100) break;
  }
  return { items };
}

/* ---------- reproducción ---------- */

export async function resolve(ref) {
  await kino.sleep(0);
  const s = String(ref || "");
  if (s.indexOf("canal:") !== 0) throw kino.error("not_found", "ref");
  const slug = s.slice(6);

  const lista = await traerCanales();
  const x = lista.find((c) => c.slug === slug);
  if (!x) throw kino.error("not_found", "canal", {
    userMessage: "Ese canal ya no está en la lista."
  });

  const cabeceras = { "User-Agent": UA, Referer: "https://pelisjuanita.com/" };

  if (x.url) {
    if (x.url.includes(".m3u8")) return { url: x.url, mime: "application/vnd.apple.mpegurl", headers: cabeceras };
    const st = { url: x.url, mime: "application/dash+xml", headers: cabeceras };
    if (x.drm) st.drm = x.drm;
    return st;
  }

  if (!x.embed) throw kino.error("not_found", "sin url", {
    userMessage: "Este canal no tiene enlace ahora."
  });

  if (typeof kino.browser !== "object") {
    throw kino.error("unavailable", "sin navegador", {
      userMessage: "Necesitas actualizar la app para abrir este canal."
    });
  }

  const destino = x.embed.startsWith("http") ? x.embed : BASE + "/" + x.embed.replace(/^\/+/, "");
  try {
    const cap = await kino.browser.capture(destino, {
      headers: cabeceras,
      timeoutMs: 20000
    });
    const media = (cap && (cap.media || cap.urls)) || [];
    let m = null;
    for (const c of media) {
      const u = typeof c === "string" ? c : (c && c.url);
      if (!u) continue;
      if (/imasdk|doubleclick|googletag|pubads|prebid/i.test(u)) continue;
      m = { url: u, mime: c && c.mime, headers: c && c.headers };
      break;
    }
    if (!m && cap && cap.url) m = { url: cap.url, mime: cap.mime, headers: cap.headers };
    if (!m) throw kino.error("unavailable", "sin media", {
      userMessage: "El canal " + x.nombre + " no entrega imagen ahora. Prueba otro."
    });
    const out = { url: m.url };
    out.mime = m.mime || (m.url.includes(".m3u8") ? "application/vnd.apple.mpegurl" : undefined);
    out.headers = m.headers && Object.keys(m.headers).length ? m.headers : cabeceras;
    kino.log("canal " + slug + " -> " + String(m.url).slice(0, 140));
    return out;
  } catch (e) {
    const cod = String((e && e.code) || "");
    if (cod === "blocked") throw kino.error("unavailable", "blocked", {
      userMessage: "El canal " + x.nombre + " pide confirmar que eres humano. Prueba otro."
    });
    if (cod === "timeout" || cod === "busy") throw kino.error("unavailable", cod, {
      userMessage: "El canal " + x.nombre + " tardo demasiado. Prueba otro."
    });
    if (cod) throw e;
    throw kino.error("unavailable", "embed", {
      userMessage: "El canal " + x.nombre + " no abre ahora. Prueba otro."
    });
  }
}