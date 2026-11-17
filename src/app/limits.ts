/**
 * Hard bounds for in-memory, audio-derived buffers (AUDIT F8).
 *
 * These limits keep long-running or stalled sessions from growing without
 * bound. They are intentionally conservative: 90 recent frames is roughly
 * 3.5 seconds at a 25 fps UI commit rate, 300 Experiment A capture frames is
 * roughly 12 seconds, and 18,000 session samples is roughly one hour at 5 Hz.
 */
export const MAX_RECENT_FRAMES = 90;
export const MAX_CAPTURE_FRAMES = 300;
export const MAX_SESSION_SAMPLES = 18_000;
export const MAX_SESSION_FINGERPRINT_FRAMES = 180;
