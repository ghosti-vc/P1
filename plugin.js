function https(value) {
  let url = String(value || "");
  if (url.startsWith("/")) url = CDN + url;
  return /^https:\/\//i.test(url) ? url : undefined;
}

// Un master propio de ~400 bytes en kino.storage, para que ExoPlayer fusione video y audio.
async function publishMaster(video, audio) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  audio.forEach((a, i) => {
    lines.push(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="' + (a.label || a.lang) + '",DEFAULT=' +
      (i === 0 ? "YES" : "NO") + ',AUTOSELECT=YES,LANGUAGE="' + a.lang + '",URI="' + a.url + '"'
    );
  });
  lines.push('#EXT-X-STREAM-INF:BANDWIDTH=6000000,AUDIO="aud"');
  lines.push(video);
  const body = lines.join("\n") + "\n";

  const all = (await kino.storage.get("masters")) || {};
  const keys = Object.keys(all);
  if (keys.length >= 20) delete all[keys[0]];
  const handle = "m" + Date.now().toString(36) + Object.keys(all).length;
  all[handle] = body;
  await kino.storage.set("masters", all);
  return { handle, size: new TextEncoder().encode(body).length };
}

export async function read({ handle, offset, length }) {
  const all = await kino.storage.get("masters");
  const body = all && all[handle];
  if (!body) kino.error("not_found", "master " + handle);
  return { bytes: btoa(body.slice(offset, offset + length)) };
}

export async function resolve(ref) {
  let [id, path] = splitRef(ref);
  if (!id || !path.startsWith("/")) throw kino.error("not_found", "ref " + ref);
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
  const usable = options.filter((one) => one.url && !one.failed);
  const chosen =
    usable.find((one) => one.ready && one.active) ||
    usable.find((one) => /\.m3u8|\.mpd/i.test(String(one.url))) ||
    usable[0];
  if (!chosen) throw kino.error("not_found", "sin servidor", { userMessage: "Este título no tiene ningún servidor disponible ahora." });
  const url = https(chosen.url);
  if (!url) throw kino.error("unavailable", "url rara");

  const subtitles = [];
  for (const track of chosen.subtitles || []) {
    const trackUrl = https(track.url);
    if (!trackUrl) continue;
    subtitles.push({ lang: String(track.language_code || "und").slice(0, 16), url: trackUrl, format: "vtt" });
    if (subtitles.length >= 30) break;
  }
  const headers = { Referer: BASE + "/", Origin: BASE, "User-Agent": HEADERS["User-Agent"] };

  // Qué es de verdad lo que eligió el sitio.
  const list = await kino.fetch(url, { headers });
  if (!list.ok) throw kino.error("unavailable", "playlist " + list.status);
  const manifest = String(await list.text());

  if (/^\s*</.test(manifest)) {
    return { url, mime: "application/dash+xml", headers, subtitles };
  }
  if (/#EXT-X-STREAM-INF/.test(manifest)) {
    // Ya es un master: ExoPlayer elige variante y audio. No metas audioTracks.
    await probe("video", url, headers);
    return { url, mime: "application/vnd.apple.mpegurl", headers, subtitles };
  }

  const audio = [];
  for (const track of chosen.audio_tracks || []) {
    const trackUrl = https(track.playlist_url);
    if (!trackUrl) continue;
    const lang = String(track.language_code || "und").slice(0, 16);
    const label = String(track.display_name || "").slice(0, 40);
    audio.push(label ? { lang, url: trackUrl, label } : { lang, url: trackUrl });
    if (audio.length >= 8) break;
  }
  await probe("video", url, headers);
  if (!audio.length) {
    return { url, mime: "application/vnd.apple.mpegurl", headers, subtitles };
  }
  // Video mudo con el audio aparte: master propio y que el player fusione.
  const master = await publishMaster(url, audio);
  return { source: "plugin", handle: master.handle, size: master.size, mime: "application/vnd.apple.mpegurl", headers, subtitles };
}