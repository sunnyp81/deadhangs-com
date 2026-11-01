import { trackTrainingEvent } from "./training-events.js";

/** Returns a function that reports the first call only. Autoplay never calls it. */
export function createFirstInteractionTracker(track) {
  let sent = false;
  return () => {
    if (sent) return false;
    sent = true;
    track();
    return true;
  };
}

const firstInteraction = createFirstInteractionTracker(() =>
  trackTrainingEvent("feature_used", { feature: "demo_loop_played" }),
);

function setState(loop, svg, button, playing) {
  if (playing) svg.unpauseAnimations();
  else svg.pauseAnimations();
  button.textContent = playing ? "Pause animation" : "Play animation";
  button.setAttribute("aria-pressed", playing ? "false" : "true");
  loop.classList.toggle("is-paused", !playing);
}

/** Upgrade each loop from its static start and end frames to the animated figure with a Pause button. */
export function initDemoLoops(root = document, win = window) {
  const reduce = win.matchMedia("(prefers-reduced-motion: reduce)");
  root.querySelectorAll("[data-hf-loop]").forEach((loop) => {
    const svg = loop.querySelector(".hf-live svg");
    const button = loop.querySelector(".hf-toggle");
    if (!svg || !button || typeof svg.pauseAnimations !== "function") return;
    let playing = true;
    const apply = () => {
      if (reduce.matches) {
        svg.pauseAnimations();
        loop.classList.remove("is-live");
        button.hidden = true;
        return;
      }
      loop.classList.add("is-live");
      button.hidden = false;
      setState(loop, svg, button, playing);
    };
    button.addEventListener("click", () => {
      playing = !playing;
      setState(loop, svg, button, playing);
      firstInteraction();
    });
    if (reduce.addEventListener) reduce.addEventListener("change", apply);
    apply();
  });
}
