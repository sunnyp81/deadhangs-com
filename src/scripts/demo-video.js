import { trackTrainingEvent } from "./training-events.js";

/** Plays a lazy, muted, looping clip while it is on screen and the visitor has not paused it. */
export function initDemoVideos(root = document, win = window) {
  const reduce = win.matchMedia("(prefers-reduced-motion: reduce)");
  root.querySelectorAll("[data-demo-video]").forEach((fig) => {
    const video = fig.querySelector("video");
    const button = fig.querySelector(".hf-toggle");
    if (!video || !button) return;
    let userPaused = false;
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      trackTrainingEvent("feature_used", { feature: "video_played" });
    };
    const label = () => {
      const playing = !video.paused;
      button.textContent = playing ? "Pause video" : "Play video";
      button.setAttribute("aria-pressed", playing ? "false" : "true");
    };
    button.hidden = false;
    // Under reduced motion the clip stays on its poster until the visitor presses play.
    if (reduce.matches) {
      userPaused = true;
      video.controls = false;
    }
    video.addEventListener("play", () => {
      report();
      label();
    });
    video.addEventListener("pause", label);
    button.addEventListener("click", () => {
      if (video.paused) {
        userPaused = false;
        video.play().catch(() => {});
      } else {
        userPaused = true;
        video.pause();
      }
    });
    label();
    const io = new win.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!userPaused) video.play().catch(() => {});
          } else if (!video.paused) {
            video.pause();
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(video);
  });
}
