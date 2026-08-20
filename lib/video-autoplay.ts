/**
 * Start a video the moment it mounts, muting it if that is the only way in.
 *
 * Browsers only let a video start on its own while muted unless the page has
 * earned enough media engagement, and a rejected `autoPlay` leaves the viewer
 * staring at a frozen poster with no hint that a tap is needed. Trying sound
 * first and falling back to muted keeps audio wherever it is allowed.
 *
 * Use as a ref callback: `<video ref={playOrPlayMuted} ... />` — keyed on the
 * media id so a new item in the same viewer re-runs it.
 */
export function playOrPlayMuted(el: HTMLVideoElement | null): void {
  if (!el) return;
  void el.play().catch(() => {
    el.muted = true;
    void el.play().catch(() => {
      /* no codec, or the tab is hidden — the controls still work */
    });
  });
}
