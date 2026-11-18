// Hard bounds for in-memory, audio-derived buffers (AUDIT F8).

// 90 scalar frames at the engine's animation-frame cadence (~1.5 s at 60 Hz),
// not at the throttled UI rate. Activity inference uses the whole window at
// each UI commit (at least 48 ms apart). If this cap grows, consider a ring
// buffer for eviction and profile the cost of inference over the larger window.
export const MAX_RECENT_FRAMES = 90;

// Experiment A captures at the throttled UI rate, not every engine frame.
export const MAX_CAPTURE_FRAMES = 300;

// Roughly one hour at 5 Hz.
export const MAX_SESSION_SAMPLES = 18_000;
export const MAX_SESSION_FINGERPRINT_FRAMES = 180;
