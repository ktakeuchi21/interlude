export const MEDIA_FOCUS_EVENT = "interlude-media-focus";
export function claimMediaFocus(id: string, except?: HTMLMediaElement | null) {
  document.querySelectorAll<HTMLMediaElement>("audio,video").forEach(media => { if (media !== except) media.pause(); });
  window.dispatchEvent(new CustomEvent(MEDIA_FOCUS_EVENT, { detail: id }));
}
