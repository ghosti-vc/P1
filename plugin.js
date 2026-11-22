// Kino plugin: Kimera (kimeraweb.com) — películas y series.
// El sitio sirve el video en un HLS aparte del audio: el video va sin sonido y cada idioma
// (latino, inglés) en su propio playlist, así que se entregan como audioTracks.

const BASE = "https://kimeraweb.com";
const CDN = "https://cloudcdn.sbs";
const TYPES = "movies|series|dramas|animes|donghuas|shorts";
const AS_SERIES = new Set(["series", "dramas", "animes", "donghuas", "shorts"]);
const CARD = new RegExp('<a href="https:\\/\\/kimeraweb\\.com\\/(' + TYPES + ')\\/([^"]+)"[^>]*>\\s*<img([^>]*)>', "g");

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // la línea se pierde, el resultado no
  }
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
  const url = String(value || "");
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

// Un bloque de tarjetas del HTML: enlace a la ficha + su portada. El título va en el alt o,
// cuando la tarjeta no lo trae, en el pie o en el enlace que la acompaña.
function cards(html) {
  const out = [];
  CARD.lastIndex = 0;
  let match;
  while ((match = CARD.exec(html))) {
    const type = match[1];
    const path = match[2].split("/")[0];
    const numbered = /(\d+)$/.exec(path);
    if (!numbered) continue;
    const poster = https(attr(match[3], "data-src")) || https(attr(match[3], "src"));
    let title = decode(attr(match[3], "alt"));
    if (!title) {
      const after = html.slice(match.index + match[0].length, match.index + match[0].length + 900);
      const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(after);
      const twin = new RegExp('<a href="[^"]*' + escapeRegExp(path) + '"[^>]*>([\\s\\S]{1,200}?)<\\/a>').exec(after);
      title = caption ? text(caption[1]) : twin ? text(twin[1]) : "";
    }
    title = title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    const id = (AS_SERIES.has(type) ? "s" : "m") + numbered[1];
    out.push({
      id,
      ref: numbered[1] + "|/" + type + "/" + path,
      title,
      kind: AS_SERIES.has(type) ? "series" : "movie",
      poster,
    });
  }
  return out;
}

function sections(html) {
  const marks = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let match;
  while ((match = re.exec(html))) marks.push({ at: match.index + match[0].length, head: text(match[1]) });
  return marks.map((mark, i) => ({
    head: mark.head,
    body: html.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : html.length),
  }));
}

const ROWS = [
  { id: "estrenos", title: "Últimos estrenos", keys: ["ultimos estrenos"] },
  { id: "populares", title: "Populares del día", keys: ["populares"] },
  { id: "agregados", title: "Últimos títulos agregados", keys: ["ultimos titulos"] },
  { id: "episodios", title: "Últimos episodios", keys: ["ultimos episodios"] },
];

export async function home() {
  const answer = await kino.fetch(BASE + "/");
  if (!answer.ok) throw kino.error("unavailable", "inicio " + answer.status);
  const html = answer.text();
  const found = sections(html);
  const rows = [];
  for (const row of ROWS) {
    const section = found.find((one) => row.keys.some((key) => one.head.includes(key)));
    if (!section) continue;
    const items = [];
    const seen = new Set();
    for (const card of cards(section.body)) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      items.push(card);
      if (items.length >= 30) break;
    }
    if (items.length) rows.push({ id: row.id, title: row.title, items });
  }
  if (!rows.length) throw kino.error("unavailable", "inicio sin filas");
  return rows;
}

async function seriesInfo(id, path) {
  const info = { title: "", poster: undefined };
  try {
    const answer = await kino.fetch(BASE + path);
    if (answer.ok) {
      const data = json(answer.text(), "title-data");
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
    const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=" + page);
    if (!answer.ok) break;
    const data = answer.json();
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
  const answer = await kino.fetch(BASE + "/api/titles/" + encodeURIComponent(id) + "/content?sort=asc&page=1");
  if (!answer.ok) return null;
  const data = answer.json();
  for (const season of data.seasons || []) {
    const items = season.items || [];
    if (items.length) return items[0].url || null;
  }
  return null;
}

export async function resolve(ref) {
  let [id, path] = splitRef(ref);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + ref);
  // Una serie se abre por su primer episodio; un episodio ya trae su ruta de reproducción.
  if (!path.includes("/watch/")) {
    const first = await firstEpisode(id);
    if (!first) throw kino.error("not_found", "sin episodios " + id);
    path = first;
  }
  const answer = await kino.fetch(BASE + path);
  if (answer.status === 404) throw kino.error("not_found", "watch 404");
  if (!answer.ok) throw kino.error("unavailable", "watch " + answer.status);
  const data = json(answer.text(), "content-data");
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
  return { url, mime: "application/vnd.apple.mpegurl", audioTracks, subtitles };
}