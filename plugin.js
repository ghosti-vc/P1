// Kino plugin: Kimera (kimeraweb.com) — películas y series.
// El sitio sirve el video en un HLS aparte del audio: el video va sin sonido y cada idioma
// (latino, inglés) en su propio playlist, así que se entregan como audioTracks.

const BASE = "https://kimeraweb.com";
const CDN = "https://cloudcdn.sbs";
const TYPES = "movies|series|dramas|animes|donghuas|shorts";
const AS_SERIES = new Set(["series", "dramas", "animes", "donghuas", "shorts"]);
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "es-CO,es;q=0.9",
};
const LINK = new RegExp('(?:href|data-href)="(?:https?:\\/\\/kimeraweb\\.com)?\\/(' + TYPES + ')\\/([^"]+)"', "gi");
const BARE = new RegExp('\\/(' + TYPES + ')\\/([a-z0-9][a-z0-9-]*-\\d+)', "gi");

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // la línea se pierde, el resultado no
  }
}

async function body(answer) {
  if (typeof answer.text === "function") return await answer.text();
  if (typeof answer.json === "function") return JSON.stringify(await answer.json());
  return "";
}

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function text(value) {
  const plain = decode(String(value || "").replace(/<[^>]*>/g, " "));
  const flat = typeof plain.normalize === "function" ? plain.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : plain;
  return flat.toLowerCase().replace(/\s+/g, " ").trim();
}

function attr(attrs, name) {
  const found = new RegExp(name + '="([^"]*)"').exec(attrs);
  return found ? found[1] : "";
}

function https(value) {
  let url = String(value || "");
  if (url.startsWith("/")) url = CDN + url;
  return url.startsWith(CDN + "/") ? url : undefined;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function json(html, key) {
  const found = new RegExp('<script type="application/json"[^>]*(?:id="' + key + '"|data-element="' + key + '")[^>]*>([\\s\\S]*?)<\\/script>').exec(html);
  if (!found) return null;
  try {
    return JSON.parse(found[1]);
  } catch {
    return null;
  }
}

function splitRef(ref) {
  const at = String(ref || "").indexOf("|");
  if (at === -1) return [String(ref || ""), ""];
  return [ref.slice(0, at), ref.slice(at + 1)];
}

// Cada aparición de una ficha es una tarjeta: su portada y su título se buscan en la ventana que
// llega hasta la aparición siguiente, así que el orden del HTML no importa. Si no hay enlaces
// completos se buscan rutas sueltas.
function cards(html) {
  const out = [];
  let links = [];
  let match;
  LINK.lastIndex = 0;
  while ((match = LINK.exec(html))) links.push({ type: match[1].toLowerCase(), full: match[2], end: match.index + match[0].length });
  if (!links.length) {
    BARE.lastIndex = 0;
    while ((match = BARE.exec(html))) links.push({ type: match[1].toLowerCase(), full: match[2], end: match.index + match[0].length });
  }
  links = links.map((link, i) => ({ ...link, i })).sort((a, b) => a.end - b.end || a.i - b.i);
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const path = link.full.split("/")[0];
    const numbered = /(\d+)$/.exec(path);
    if (!numbered) continue;
    const stop = i + 1 < links.length ? links[i + 1].end : link.end + 2000;
    const window = html.slice(link.end, Math.min(stop, link.end + 2000));
    const wide = html.slice(link.end, Math.min(html.length, link.end + 2600));
    const image = /<img([^>]*)>/i.exec(window);
    let poster = image ? https(attr(image[1], "data-src")) || https(attr(image[1], "src")) : undefined;
    if (!poster) {
      const background = /url\((['"]?)(https?:\/\/[^)'"]+)\1\)/i.exec(window);
      if (background) poster = https(background[2]);
    }
    let title = image ? decode(attr(image[1], "alt")) : "";
    if (!title) {
      const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(wide);
      if (caption) title = text(caption[1]);
    }
    if (!title) {
      const twin = new RegExp('(?:href|data-href)="[^"]*' + escapeRegExp(path) + '"[^>]*>([\\s\\S]{1,200}?)<\\/a>', "i").exec(wide);
      if (twin) title = text(twin[1]);
    }
    title = title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    const id = (AS_SERIES.has(link.type) ? "s" : "m") + numbered[1];
    out.push({
      id,
      ref: numbered[1] + "|/" + link.type + "/" + path,
      title,
      kind: AS_SERIES.has(link.type) ? "series" : "movie",
      poster,
    });
  }
  return out;
}

function collect(html) {
  const items = [];
  const seen = new Set();
  for (const card of cards(html)) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    items.push(card);
    if (items.length >= 30) break;
  }
  return items;
}

function sections(html) {
  const marks = [];
  const re = /<h2\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) marks.push(match.index + match[0].length);
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1] : html.length;
    out.push({ head: text(html.slice(from, Math.min(to, from + 300))), body: html.slice(from, to) });
  }
  return out;
}

const ROWS = [
  { id: "estrenos", title: "Últimos estrenos", keys: ["ultimos estrenos"] },
  { id: "populares", title: "Populares del día", keys: ["populares"] },
  { id: "agregados", title: "Últimos títulos agregados", keys: ["ultimos titulos"] },
  { id: "episodios", title: "Últimos episodios", keys: ["ultimos episodios"] },
];

async function page(path) {
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (!answer.ok) throw kino.error("unavailable", path + " " + answer.status);
  return await body(answer);
}

// Filas de una página de sección (/movies/, /series/): cada <h2> abre una fila.
function rowsOf(html, prefix, wanted) {
  const found = sections(html);
  const out = [];
  for (const row of wanted) {
    const section = found.find((one) => row.keys.some((key) => one.head.includes(key)));
    if (!section) continue;
    const items = collect(section.body);
    if (items.length) out.push({ id: prefix + row.id, title: (prefix ? row.prefix + " · " : "") + row.title, items });
  }
  return out;
}

const SECTION_ROWS = [
  { id: "mes", title: "Populares del mes", keys: ["populares del mes"] },
  { id: "estrenos", title: "Últimos estrenos", keys: ["ultimos estrenos"] },
  { id: "agregados", title: "Últimos agregados", keys: ["ultimos titulos"] },
  { id: "dia", title: "Populares del día", keys: ["populares del dia"] },
];

export async function home() {
  const [inicio, pelis, series] = await Promise.allSettled([page("/"), page("/movies/"), page("/series/")]);
  if (inicio.status !== "fulfilled") throw inicio.reason;
  const html = inicio.value;
  const found = sections(html);
  const rows = [];
  for (const row of ROWS) {
    const section = found.find((one) => row.keys.some((key) => one.head.includes(key)));
    if (!section) continue;
    const items = collect(section.body);
    if (items.length) rows.push({ id: row.id, title: row.title, items });
  }
  if (pelis.status === "fulfilled") {
    for (const r of rowsOf(pelis.value, "m-", SECTION_ROWS.map((x) => ({ ...x, prefix: "Películas" })))) rows.push(r);
  } else log("home: /movies/ falló");
  if (series.status === "fulfilled") {
    for (const r of rowsOf(series.value, "s-", SECTION_ROWS.map((x) => ({ ...x, prefix: "Series" })))) rows.push(r);
  } else log("home: /series/ falló");
  if (!rows.length) {
    const items = collect(html);
    if (items.length) rows.push({ id: "todo", title: "Kimera", items });
  }
  if (!rows.length) {
    const head = html.slice(0, 110).replace(/\s+/g, " ");
    throw kino.error("unavailable", "vacio len=" + html.length + " h2=" + found.length + " " + head);
  }
  log("home: filas=" + rows.length);
  return rows;
}

// Catálogo: /catalog?q=&type=&tag=&sort=&page= trae las fichas dentro del JSON "catalog-initial-data".
function catalogItems(html) {
  const data = json(html, "catalog-initial-data");
  const out = [];
  if (data && Array.isArray(data.items)) {
    for (const it of data.items) {
      const url = String(it.title_url || "");
      const m = /^\/([a-z]+)\/[^\/]+-(\d+)$/.exec(url);
      if (!m) continue;
      const series = AS_SERIES.has(m[1]);
      out.push({
        id: (series ? "s" : "m") + m[2],
        ref: m[2] + "|" + url,
        title: decode(it.name).slice(0, 200),
        kind: series ? "series" : "movie",
        poster: https(it.vertical_cover_url) || https(it.cover_url),
      });
    }
    return { items: out, hasNext: !!data.has_next, pages: Number(data.pages) || 1 };
  }
  const items = collect(html);
  return { items, hasNext: false, pages: 1 };
}

async function catalog(params, pageNo) {
  const q = Object.keys(params).filter((k) => params[k] !== "" && params[k] != null).map((k) => k + "=" + encodeURIComponent(params[k]));
  q.push("page=" + pageNo);
  return catalogItems(await page("/catalog?" + q.join("&")));
}

export async function search(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const first = await catalog({ q }, 1);
  let items = first.items.slice();
  if (first.pages > 1) {
    const more = [];
    for (let p = 2; p <= Math.min(first.pages, 4); p++) more.push(catalog({ q }, p).catch(() => ({ items: [] })));
    for (const r of await Promise.all(more)) items = items.concat(r.items);
  }
  const seen = new Set();
  items = items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  log("búsqueda '" + q + "': " + items.length + " resultados");
  return items;
}

// Secciones y géneros de "Explorar".
const BROWSE = {
  peliculas: { title: "Películas", params: { type: "movie" } },
  series: { title: "Series", params: { type: "serie" } },
  animes: { title: "Animes", params: { type: "anime" } },
  dramas: { title: "Dramas", params: { type: "drama" } },
  donghuas: { title: "Donghuas", params: { type: "donghua" } },
  agregados: { title: "Últimos agregados", params: { sort: "added" } },
  accion: { title: "Acción", params: { tag: 2 } },
  aventura: { title: "Aventura", params: { tag: 4 } },
  comedia: { title: "Comedia", params: { tag: 1 } },
  drama: { title: "Drama", params: { tag: 11 } },
  terror: { title: "Terror", params: { tag: 21 } },
  ciencia: { title: "Ciencia ficción", params: { tag: 14 } },
  animacion: { title: "Animación", params: { tag: 17 } },
  romance: { title: "Romance", params: { tag: 3 } },
  suspenso: { title: "Suspenso", params: { tag: 18 } },
  crimen: { title: "Crimen", params: { tag: 15 } },
  fantasia: { title: "Fantasía", params: { tag: 5 } },
  familia: { title: "Familia", params: { tag: 13 } },
};

export async function browse(ref, cursor) {
  const def = BROWSE[String(ref || "")];
  if (!def) throw kino.error("not_found", "sección desconocida");
  const n = Math.max(1, parseInt(cursor, 10) || 1);
  const r = await catalog(def.params, n);
  const out = { items: r.items };
  if (r.hasNext && r.items.length) out.next = String(n + 1);
  return out;
}

export async function categories() {
  return Object.keys(BROWSE).map((id) => ({ id, title: BROWSE[id].title, ref: id }));
}

async function seriesInfo(id, path) {
  const info = { title: "", poster: undefined };
  try {
    const answer = await kino.fetch(BASE + path, { headers: HEADERS });
    if (answer.ok) {
      const data = json(await body(answer), "title-data");
      if (data) {
        info.title = decode(data.name).slice(0, 200);
        info.poster = https(data.cover_url);
      }
    }
  } catch (error) {
    log("ficha de serie", id, error.message);
  }
  if (!info.title) info.title = "Serie " + id;
  return info;
}

export async function episodes(ref) {
  const [id, path] = splitRef(ref);
  if (!id) throw kino.error("not_found", "ref " + ref);
  const series = await seriesInfo(id, path);
  const episodes = [];
  for (let page = 1; page <= 20; page++) {
    const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=" + page, { headers: HEADERS });
    if (!answer.ok) break;
    const data = JSON.parse(await body(answer));
    for (const season of data.seasons || []) {
      const number = Number(season.number) || 1;
      for (const item of season.items || []) {
        const episode = Number(item.number);
        if (!episode || !item.url) continue;
        episodes.push({
          season: number,
          number: episode,
          ref: id + "|" + item.url,
          title: decode(item.name).slice(0, 200) || "Episodio " + episode,
          poster: item.thumbnail_url || series.poster,
        });
      }
    }
    if (!data.has_next) break;
  }
  if (!episodes.length) throw kino.error("not_found", "sin episodios");
  return { series, episodes };
}

async function firstEpisode(id) {
  const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=1", { headers: HEADERS });
  if (!answer.ok) return null;
  const data = JSON.parse(await body(answer));
  for (const season of data.seasons || []) {
    const items = season.items || [];
    if (items.length) return items[0].url || null;
  }
  return null;
}

// Solo para el registro: qué responde la lista HLS (estado, tipo y primeras letras).
async function probe(name, url, headers) {
  try {
    const r = await kino.fetch(url, { headers });
    let ct = "";
    try { ct = r.headers && (typeof r.headers.get === "function" ? r.headers.get("content-type") : r.headers["content-type"]) || ""; } catch {}
    const t = r.ok ? String(await r.text()) : "";
    log("probe " + name + " status=" + r.status + " ct=" + ct + " bytes=" + t.length + " ini=" + t.slice(0, 60).replace(/\s+/g, " "));
  } catch (e) {
    log("probe " + name + " falló " + String((e && e.message) || e).slice(0, 60));
  }
}

export async function resolve(ref) {
  let [id, path] = splitRef(ref);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + ref);
  // Una serie se abre por su primer episodio; un episodio ya trae su ruta de reproducción.
  if (!path.includes("/watch")) {
    if (/^\/movies\//.test(path)) {
      path = path.replace(/\/+$/, "") + "/watch";
    } else {
      const first = await firstEpisode(id);
      if (!first) throw kino.error("not_found", "sin episodios " + id);
      path = first;
    }
  }
  const answer = await kino.fetch(BASE + path, { headers: HEADERS });
  if (answer.status === 404) throw kino.error("not_found", "watch 404");
  if (!answer.ok) throw kino.error("unavailable", "watch " + answer.status);
  const data = json(await body(answer), "content-data");
  const options = [];
  for (const category of (data && data.playback) || []) {
    for (const option of category.playback_options || []) options.push(option);
  }
  const chosen = options.find((one) => one.url && one.ready && one.active) || options.find((one) => one.url && !one.failed);
  if (!chosen) throw kino.error("not_found", "sin servidor", { userMessage: "Este título no tiene ningún servidor disponible ahora." });
  const url = https(chosen.url);
  if (!url) throw kino.error("unavailable", "url rara");
  const audioTracks = [];
  for (const track of chosen.audio_tracks || []) {
    const trackUrl = https(track.playlist_url);
    if (!trackUrl) continue;
    const lang = String(track.language_code || "und").slice(0, 16);
    const label = String(track.display_name || "").slice(0, 40);
    audioTracks.push(label ? { lang, url: trackUrl, label } : { lang, url: trackUrl });
    if (audioTracks.length >= 8) break;
  }
  const subtitles = [];
  for (const track of chosen.subtitles || []) {
    const trackUrl = https(track.url);
    if (!trackUrl) continue;
    subtitles.push({ lang: String(track.language_code || "und").slice(0, 16), url: trackUrl, format: "vtt" });
    if (subtitles.length >= 30) break;
  }
  const headers = { Referer: BASE + "/", Origin: BASE, "User-Agent": HEADERS["User-Agent"] };
  await probe("video", url, headers);
  if (audioTracks[0]) await probe("audio", audioTracks[0].url, headers);
  return { url, mime: "application/vnd.apple.mpegurl", headers, audioTracks, subtitles };
}