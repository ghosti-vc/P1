const BASE = "https://pelisjuanita.com/tv/app";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";
const REFERER = "https://localhost/";
const CACHE_KEY = "canales";
const CACHE_MS = 10 * 60 * 1000;

async function traerCanales() {
  const guardado = kino.storage.get(CACHE_KEY);
  if (guardado) {
    try {
      const c = JSON.parse(guardado);
      if (Date.now() - c.t < CACHE_MS && c.lista.length) return c.lista;
    } catch {}
  }
  const r = await kino.fetch(BASE + "/canales_json.php", {
    headers: { "User-Agent": UA, Referer: REFERER, Accept: "application/json" },
    timeoutMs: 15000,
  });
  if (!r.ok) throw kino.error("unavailable", "canales " + r.status, { userMessage: "La lista de canales no responde ahora. Prueba de nuevo en un rato." });
  const texto = r.text();
  let lista;
  try {
    lista = JSON.parse(texto);
  } catch {
    throw kino.error("unavailable", "canales no json", { userMessage: "La lista de canales llegó incompleta. Prueba de nuevo en un rato." });
  }
  if (!Array.isArray(lista) || !lista.length) throw kino.error("not_found", "canales vacio", { userMessage: "No hay canales disponibles en este momento." });
  try {
    kino.storage.set(CACHE_KEY, JSON.stringify({ t: Date.now(), lista }));
  } catch {}
  return lista;
}

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
  const embed = String(c.embed || "").trim();
  return {
    id: "canal:" + slug,
    nombre,
    categoria: String(c.categoria || "").trim(),
    pais: String(c.pais || "").trim(),
    logo: String(c.logo || "").trim(),
    url,
    drm,
    embed,
  };
}

function streamDe(canal) {
  if (canal.url) {
    const s = { url: canal.url, label: "Directo" };
    if (canal.drm) s.drm = canal.drm;
    if (!canal.url.includes(".m3u8")) s.mime = "application/dash+xml";
    return s;
  }
  return null;
}

function enLinea(canal) {
  const s = streamDe(canal);
  if (s) {
    s.headers = { "User-Agent": UA, Referer: REFERER };
  }
  return s;
}

export async function liveCategories() {
  await Promise.resolve();
  const lista = await traerCanales();
  const cuenta = new Map();
  for (const c of lista) {
    const x = limpio(c);
    if (!x) continue;
    const g = x.categoria || "General";
    cuenta.set(g, (cuenta.get(g) || 0) + 1);
  }
  const cats = [];
  let n = 1;
  for (const [g, cuantos] of cuenta) {
    cats.push({ id: "cat:" + n, title: g, genre: "live", _g: g, _n: cuantos });
    n++;
  }
  kino.storage.set("mapa", JSON.stringify(cats.map((c) => ({ id: c.id, g: c._g }))));
  return cats.map((c) => ({ id: c.id, title: c.title, genre: "live" }));
}

function grupoDe(categoryId) {
  const mapa = kino.storage.get("mapa");
  if (mapa) {
    try {
      const f = JSON.parse(mapa).find((m) => m.id === categoryId);
      if (f) return f.g;
    } catch {}
  }
  return null;
}

export async function liveChannels(arg) {
  await Promise.resolve();
  const categoryId = arg && arg.categoryId;
  const lista = await traerCanales();
  const grupo = categoryId ? grupoDe(categoryId) : null;
  const items = [];
  let num = 1;
  for (const c of lista) {
    const x = limpio(c);
    if (!x) continue;
    if (grupo && (x.categoria || "General") !== grupo) continue;
    const it = { id: x.id, title: x.nombre, categoryId, number: num };
    num = num > 9999 ? 1 : num + 1;
    if (x.logo) it.logo = x.logo;
    const s = enLinea(x);
    if (s) it.stream = s;
    if (x.embed || x.url) it.ref = "canal:" + encodeURIComponent(x.nombre) + "|" + x.url + "|" + x.embed;
    items.push(it);
    if (items.length >= 500) break;
  }
  return { items };
}

export async function home() {
  await Promise.resolve();
  const lista = await traerCanales();
  const fila = [];
  for (const c of lista) {
    const x = limpio(c);
    if (!x) continue;
    const it = { kind: "live", id: x.id, title: x.nombre, ref: "canal:" + encodeURIComponent(x.nombre) + "|" + x.url + "|" + x.embed, genre: "live" };
    if (x.logo) it.poster = x.logo;
    fila.push(it);
    if (fila.length >= 60) break;
  }
  return fila.length ? [{ title: "Canales en vivo", genre: "live", items: fila }] : [];
}

export async function search(q) {
  await Promise.resolve();
  const t = String(q || "").trim().toLowerCase();
  if (!t) return [];
  const lista = await traerCanales();
  const out = [];
  for (const c of lista) {
    const x = limpio(c);
    if (!x) continue;
    if (!x.nombre.toLowerCase().includes(t)) continue;
    const it = { kind: "live", id: x.id, title: x.nombre, ref: "canal:" + encodeURIComponent(x.nombre) + "|" + x.url + "|" + x.embed, genre: "live" };
    if (x.logo) it.poster = x.logo;
    out.push(it);
    if (out.length >= 100) break;
  }
  return out;
}

export async function resolve(ref) {
  await Promise.resolve();
  const s = String(ref || "");
  if (!s.startsWith("canal:")) throw kino.error("not_found", "ref");
  const partes = s.slice(6).split("|");
  const nombre = decodeURIComponent(partes[0] || "");
  const url = partes[1] || "";
  const embed = partes[2] || "";

  if (url) {
    const cabeceras = { "User-Agent": UA, Referer: REFERER };
    if (url.includes(".m3u8")) return { url, mime: "application/vnd.apple.mpegurl", headers: cabeceras };
    const lista = await traerCanales().catch(() => []);
    const c = lista.find((x) => String(x.slug) === decodeURIComponent(s.slice(6)).split("|")[0]);
    const drm = c ? limpio(c) && limpio(c).drm : null;
    const st = { url, mime: "application/dash+xml", headers: cabeceras };
    if (drm) st.drm = drm;
    return st;
  }

  if (!embed) throw kino.error("not_found", "sin url", { userMessage: "Este canal no tiene enlace ahora." });

  if (typeof kino.browser !== "object") {
    throw kino.error("unavailable", "sin navegador", { userMessage: "Necesitas actualizar la app para abrir este canal." });
  }
  const destino = embed.startsWith("http") ? embed : BASE + "/" + embed.replace(/^\/+/, "");
  try {
    const cap = await kino.browser.capture(destino, {
      headers: { "User-Agent": UA, Referer: REFERER },
      timeoutMs: 20000,
    });
    const m = (cap.media || []).find((x) => x && x.url);
    if (!m) throw kino.error("not_found", "sin media");
    const out = { url: m.url };
    if (m.mime) out.mime = m.mime;
    if (m.headers && Object.keys(m.headers).length) out.headers = m.headers;
    return out;
  } catch (e) {
    if (e && e.name === "KinoError_not_found") {
      throw kino.error("unavailable", "embed vacio", { userMessage: "El canal " + nombre + " no entrega imagen ahora. Prueba otro." });
    }
    if (e && (e.code === "blocked" || e.code === "timeout" || e.code === "busy")) {
      throw kino.error("unavailable", String(e.code), { userMessage: "El canal " + nombre + " tardó demasiado. Prueba otro." });
    }
    throw e;
  }
}