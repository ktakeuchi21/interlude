import type { Supplement } from "./supplements";
export type EmbedControls = { pause: () => void; destroy: () => void };
type Callbacks = { ready: () => void; playing: () => void; paused: () => void; ended: () => void; buffering: () => void; error: (message: string) => void; duration: (seconds: number) => void };
type YouTubePlayer = { pauseVideo(): void; destroy(): void; getDuration(): number; getVideoUrl(): string; getIframe(): HTMLIFrameElement };
type YouTubeAPI = { Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
type SpotifyController = { pause(): void; destroy(): void; addListener(name: string, handler: (event: { data: { isPaused?: boolean; isBuffering?: boolean; duration?: number; playingURI?: string } }) => void): void };
type SpotifyAPI = { createController(element: HTMLElement, options: Record<string, unknown>, callback: (controller: SpotifyController) => void): void };
declare global { interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void; onSpotifyIframeApiReady?: (api: SpotifyAPI) => void; interludeSpotifyAPI?: Promise<SpotifyAPI> } }
let youtube: Promise<YouTubeAPI> | undefined;
function youtubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtube) youtube = new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement("script"), previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => fail(), 20_000);
    function fail() { clearTimeout(timer); script.remove(); window.onYouTubeIframeAPIReady = previous; youtube = undefined; reject(new Error("The video player could not load.")); }
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); window.onYouTubeIframeAPIReady = previous; if (window.YT?.Player) resolve(window.YT); else fail(); };
    script.src = "https://www.youtube.com/iframe_api"; script.async = true; script.onerror = fail; document.head.appendChild(script);
  });
  return youtube;
}
function spotifyAPI() {
  // Spotify initializes once per document. Keep its handle through hot reloads.
  if (!window.interludeSpotifyAPI) window.interludeSpotifyAPI = new Promise<SpotifyAPI>((resolve, reject) => {
    const script = document.createElement("script"), previous = window.onSpotifyIframeApiReady;
    const timer = setTimeout(() => fail(), 20_000);
    function fail() { clearTimeout(timer); script.remove(); window.onSpotifyIframeApiReady = previous; window.interludeSpotifyAPI = undefined; reject(new Error("The podcast player could not load.")); }
    window.onSpotifyIframeApiReady = api => { clearTimeout(timer); previous?.(api); window.onSpotifyIframeApiReady = previous; resolve(api); };
    script.src = "https://open.spotify.com/embed/iframe-api/v1"; script.async = true; script.onerror = fail; document.head.appendChild(script);
  });
  return window.interludeSpotifyAPI;
}
/** Mount only after the learner chooses a supplement. No automatic playback. */
export function mountEmbed(element: HTMLElement, item: Supplement, callbacks: Callbacks): EmbedControls {
  let disposed = false, controls: EmbedControls | undefined;
  const ready = () => { clearTimeout(timer); if (!disposed) callbacks.ready(); };
  const fail = (message: string) => { clearTimeout(timer); if (!disposed) callbacks.error(message); };
  const timer = setTimeout(() => fail("The media provider has not become ready. Close the player or try loading it again."), 30_000);
  if (item.provider === "youtube") void youtubeAPI().then(api => {
    if (disposed) return;
    const player = new api.Player(element, { width: "100%", height: "100%", videoId: item.mediaId, playerVars: { autoplay: 0, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => { if (disposed) return; player.getIframe().title = item.title; ready(); const seconds = player.getDuration(); if (seconds > 0) callbacks.duration(seconds); },
        onStateChange: (event: { data: number }) => {
          if (disposed) return;
          let videoId: string | null = null;
          try { videoId = new URL(player.getVideoUrl()).searchParams.get("v"); } catch {}
          if (videoId && videoId !== item.mediaId) { player.pauseVideo(); fail("The player changed to another video. Reload this supplement to continue."); return; }
          if (event.data === 1) { callbacks.playing(); const seconds = player.getDuration(); if (seconds > 0) callbacks.duration(seconds); }
          else if (event.data === 2) callbacks.paused();
          else if (event.data === 0) callbacks.ended();
          else if (event.data === 3) callbacks.buffering();
        },
        onError: () => fail("This video is unavailable in the embedded player. Your lesson remains available."),
      } });
    controls = { pause: () => player.pauseVideo(), destroy: () => player.destroy() };
  }).catch(() => fail("The video player could not load. Your lesson remains available."));
  else void spotifyAPI().then(api => {
    if (disposed) return;
    api.createController(element, { uri: `spotify:episode:${item.mediaId}`, width: "100%", height: 232 }, player => {
      if (disposed) { player.destroy(); return; }
      controls = { pause: () => player.pause(), destroy: () => player.destroy() };
      player.addListener("ready", ready);
      player.addListener("playback_started", event => { if (!disposed && event.data.playingURI === `spotify:episode:${item.mediaId}`) callbacks.playing(); });
      let lastState: string | undefined;
      player.addListener("playback_update", event => {
        if (disposed) return; const data = event.data;
        if (data.playingURI && data.playingURI !== `spotify:episode:${item.mediaId}`) { player.pause(); fail("The player changed to another episode. Reload this supplement to continue."); return; }
        const state = data.isBuffering ? "buffering" : data.isPaused === false ? "playing" : data.isPaused === true ? "paused" : undefined;
        if (state && state !== lastState) callbacks[state]();
        lastState = state;
        if (data.duration && data.duration > 0) callbacks.duration(data.duration / 1000);
      });
    });
  }).catch(() => fail("The podcast player could not load. Your lesson remains available."));
  return { pause: () => { if (!disposed) try { controls?.pause(); } catch {} }, destroy: () => { if (disposed) return; disposed = true; clearTimeout(timer); try { controls?.destroy(); } catch {} } };
}
