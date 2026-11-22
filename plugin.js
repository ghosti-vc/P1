export default {
  name: "Mi HLS",
  apiVersion: 20,

  // Puerta de entrada: otro plugin llama kino.plugins.call("mi.hls", payload)
  onReceiveStream(payload, ctx) {
    const url = payload?.url || payload?.streamUrl;
    if (!url) return ctx.ui.toast("Mi HLS: no se recibió URL");

    ctx.player.playHls({
      url,
      subtitles: payload.subtitles ?? ctx.settings.subtitleUrl,
      headers: payload.headers
    });
    return { ok: true };
  },

  // Modo manual desde los settings del plugin
  async onLaunch(ctx) {
    const url = ctx.settings.hlsUrl;
    if (!url) return ctx.ui.toast("Configura una URL HLS en ajustes");

    ctx.player.playHls({
      url,
      subtitles: ctx.settings.subtitleUrl
    });
  }
};
