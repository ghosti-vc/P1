// PelisKimera - Plugin de Kino para kimeraweb.com
// Extrae automáticamente video + audios separados + subtítulos

const BASE = "https://kimeraweb.com";

function cleanText(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

async function fetchHtml(path) {
  const res = await kino.fetch(BASE + path, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9"
    }
  });
  if (!res.ok) throw kino.error("unavailable", "No se pudo cargar la página");
  return res.text();
}

function parseItemsFromHtml(html) {
  const items = [];
  const re = /href="(\/(movies|series|dramas|animes|donghuas)\/([^"]+)-(\d+))"[^>]*>[\s\S]*?<figcaption[^>]*>([^<]+)</gi;
  let m;
  const seen = new Set();

  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const type = m[2];
    const id = m[4];
    const title = cleanText(m[5]);
    if (!title || seen.has(id)) continue;
    seen.add(id);

    let kind = "movie";
    if (type === "series" || type === "dramas") kind = "series";

    items.push({
      id: id,
      ref: path,
      title: title,
      kind: kind
    });
  }
  return items;
}

export async function home() {
  const htmlMovies = await fetchHtml("/movies/");
  const htmlSeries = await fetchHtml("/series/").catch(() => "");

  const populares = parseItemsFromHtml(htmlMovies).slice(0, 18);
  const estrenosMovies = parseItemsFromHtml(htmlMovies);
  const estrenosSeries = parseItemsFromHtml(htmlSeries);

  const seen = new Set(populares.map(i => i.id));
  const estrenos = [...estrenosMovies, ...estrenosSeries]
    .filter(i => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    })
    .slice(0, 30);

  return [
    {
      id: "populares",
      title: "Películas del mes",
      items: populares
    },
    {
      id: "estrenos",
      title: "Estrenos",
      items: estrenos
    }
  ];
}

export async function search(query) {
  const q = (query?.q || "").trim();
  if (!q) return [];

  const html = await fetchHtml("/catalog?q=" + encodeURIComponent(q));
  const items = parseItemsFromHtml(html);

  // Máximo 40 resultados (límite razonable de Kino)
  return items.slice(0, 40);
}

export async function resolve(ref) {
  if (!ref || !ref.startsWith("/")) {
    throw kino.error("not_found");
  }

  const html = await fetchHtml(ref);

  const match = html.match(/<script[^>]*id=["']content-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw kino.error("unavailable", "No se encontró la información de reproducción");
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    throw kino.error("unavailable", "Error al leer los datos de la película");
  }

  const categories = data.playback || data.title?.playback_categories || data.item?.playback_categories || [];
  if (!categories.length) {
    throw kino.error("unavailable", "Este título no tiene servidores disponibles");
  }

  const option = categories[0].playback_options?.[0];
  if (!option || !option.url) {
    throw kino.error("unavailable", "No hay opción de reproducción lista");
  }

  const stream = {
    url: option.url,
    mime: "application/vnd.apple.mpegurl"
  };

  // Audios separados
  if (option.audio_tracks?.length) {
    stream.audioTracks = option.audio_tracks.map(a => ({
      lang: a.language_code || "und",
      url: a.playlist_url,
      label: a.display_name || a.language_code || "Audio"
    }));
  }

  // Subtítulos
  if (option.subtitles?.length) {
    stream.subtitles = option.subtitles.map(s => ({
      lang: s.language_code || "es",
      url: s.url,
      format: "vtt",
      label: s.display_name
    }));
  }

  return stream;
}