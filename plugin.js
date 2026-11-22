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

// Sonda temporal: primeros bytes del init y del primer segmento, en hexadecimal.
async function sniff(playlist, baseUrl) {
  const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist);
  const first = /^(?!#)(\S.*)$/m.exec(playlist);
  const out = [];
  for (const relative of [init && init[1], first && first[1]]) {
    if (!relative) continue;
    const absolute = new URL(relative, baseUrl).href;
    try {
      const answer = await kino.fetch(absolute, { headers: HEADERS });
      const head = (await answer.text()).slice(0, 8);
      const codes = [];
      for (const character of head) codes.push(character.charCodeAt(0).toString(16));
      out.push(answer.status + ":" + codes.join(",") + ":" + head.replace(/[^\x20-\x7e]/g, "."));
    } catch (error) {
      out.push("err " + error.message);
    }
  }
  log("sniff", out.join(" // "));
}

export async function resolve(ref) {
  let [id, path] = splitRef(ref);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + ref);
  // Un episodio ya trae su ruta; una serie va por su primer capítulo; una película, por su
  // página de reproducción.
  if (!path.includes("/watch/")) {
    const first = await firstEpisode(id);
    path = first || path + "/watch";
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
  try {
    const playlistAnswer = await kino.fetch(url, { headers: HEADERS });
    const playlist = playlistAnswer.ok ? await body(playlistAnswer) : "";
    log("hls", playlist.slice(0, 160).replace(/\s+/g, " "));
    await sniff(playlist, url);
  } catch (error) {
    log("sonda fallo", error.message);
  }
  return { url, mime: "application/vnd.apple.mpegurl", audioTracks, subtitles };
}