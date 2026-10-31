function safeCall(callback) {
  try {
    return callback();
  } catch {
    return undefined;
  }
}

export function browserFeedbackAdapters() {
  return {
    supportsWake: () => Boolean(globalThis.navigator?.wakeLock?.request),
    requestWake: () => globalThis.navigator.wakeLock.request("screen"),
    speak: (text) => {
      const speech = globalThis.speechSynthesis;
      const Utterance = globalThis.SpeechSynthesisUtterance;
      if (!speech || !Utterance) return false;
      const voice = speech.getVoices?.().find((candidate) => candidate.localService);
      if (!voice) return false;
      const utterance = new Utterance(text);
      utterance.voice = voice;
      speech.speak(utterance);
      return true;
    },
    cancelSpeech: () => globalThis.speechSynthesis?.cancel(),
  };
}

/**
 * Owns the browser-only feedback resources for one timer. Every wake request
 * receives a generation, so an old promise can only release its own sentinel.
 */
/**
 * @param {ReturnType<typeof browserFeedbackAdapters>} adapters
 * @param {(status: string) => void} onStatus
 */
export function createFeedbackLifecycle(adapters = browserFeedbackAdapters(), onStatus = () => {}) {
  let generation = 0;
  let sentinel = null;
  let releaseListener = null;
  let optedIn = false;
  let running = false;

  const setStatus = (status) => onStatus(status);
  const releaseSentinel = (value, listener) => {
    if (value && listener) value.removeEventListener?.("release", listener);
    const release = safeCall(() => value?.release?.());
    release?.catch?.(() => {});
  };

  function release(nextStatus = optedIn ? "ready" : "off") {
    generation += 1;
    const current = sentinel;
    const currentListener = releaseListener;
    sentinel = null;
    releaseListener = null;
    releaseSentinel(current, currentListener);
    setStatus(nextStatus);
  }

  function acquire() {
    if (!optedIn || !running) return;
    if (!safeCall(() => adapters.supportsWake?.())) {
      setStatus("unsupported");
      return;
    }
    const requestGeneration = ++generation;
    setStatus("requested");
    Promise.resolve(safeCall(() => adapters.requestWake?.()))
      .then((nextSentinel) => {
        if (!nextSentinel) {
          if (requestGeneration === generation && optedIn && running) setStatus("denied");
          return;
        }
        if (requestGeneration !== generation || !optedIn || !running) {
          releaseSentinel(nextSentinel);
          return;
        }
        sentinel = nextSentinel;
        releaseListener = () => {
          if (sentinel !== nextSentinel) return;
          sentinel = null;
          releaseListener = null;
          if (optedIn && running) setStatus("released");
        };
        sentinel.addEventListener?.("release", releaseListener, { once: true });
        setStatus("active");
      })
      .catch(() => {
        if (requestGeneration === generation && optedIn && running) setStatus("denied");
      });
  }

  return {
    setRunning(nextRunning) {
      running = nextRunning;
      if (running) acquire();
      else release(optedIn ? "ready" : "off");
    },
    setWakeOptIn(nextOptedIn) {
      optedIn = nextOptedIn;
      if (!optedIn) release("off");
      else if (running) acquire();
      else if (safeCall(() => adapters.supportsWake?.())) setStatus("ready");
      else setStatus("unsupported");
    },
    cue(text, { voice, sound, beep }) {
      if (!sound) return;
      const spoken = voice && safeCall(() => adapters.speak?.(text));
      if (!spoken) safeCall(beep);
    },
    cancelSpeech() {
      safeCall(() => adapters.cancelSpeech?.());
    },
    stop() {
      this.cancelSpeech();
      release(optedIn ? "ready" : "off");
    },
    dispose() {
      optedIn = false;
      running = false;
      this.cancelSpeech();
      release("off");
    },
  };
}

/** Vibration patterns in milliseconds. Short, distinct and well under a second. */
export const HAPTIC_PATTERNS = {
  hang: [200],
  rest: [90, 70, 90],
  finish: [300, 120, 300, 120, 300],
};

const BUSY_PHASES = ["prep", "work", "rest", "test"];

/**
 * Which pattern a change from one timer phase to the next should play, or null.
 * Starting from idle or done is the user's own tap, so it stays silent.
 */
export function hapticKindFor(prev, next) {
  if (!BUSY_PHASES.includes(prev)) return null;
  if (next === "done") return "finish";
  if (next === "rest") return "rest";
  if (next === "work" || next === "test") return "hang";
  return null;
}

export function supportsVibrate(nav = globalThis.navigator) {
  return typeof nav?.vibrate === "function";
}

/** Plays a pattern when the browser can. Returns whether a call was made. */
export function vibrateFor(kind, nav = globalThis.navigator) {
  const pattern = HAPTIC_PATTERNS[kind];
  if (!pattern || !supportsVibrate(nav)) return false;
  return safeCall(() => {
    nav.vibrate(pattern);
    return true;
  }) === true;
}
