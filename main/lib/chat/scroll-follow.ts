/**
 * Scroll-follow model for the chat list.
 * ======================================
 * Pure helpers (unit-tested) + the policy: follow the live edge only
 * while the reader is already at the bottom. Scrolling up breaks follow
 * implicitly (no yank); a pill button jumps back with smooth motion.
 * Smooth motion runs only for user-initiated jumps and streaming follow;
 * everything else snaps.
 */

/** Pixels from the bottom that still count as "at the end". */
export const FOLLOW_END_BAND_PX = 40;

export interface ScrollGeometry {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

/** True when the viewport sits within the end band (handles fresh/empty lists). */
export function computeIsAtEnd(geometry: ScrollGeometry, bandPx = FOLLOW_END_BAND_PX): boolean {
    const { scrollTop, scrollHeight, clientHeight } = geometry;
    if (scrollHeight <= clientHeight) return true;
    return scrollHeight - scrollTop - clientHeight <= bandPx;
}

/** Motion for programmatic jumps: smooth for user gestures, instant while streaming. */
export function resolveJumpBehavior(isStreaming: boolean, prefersReducedMotion: boolean): ScrollBehavior {
    if (prefersReducedMotion) return "auto";
    return isStreaming ? "auto" : "smooth";
}

/** Auto-follow only while a generation streams AND the reader is at the end. */
export function shouldAutoFollow(isLoading: boolean, isAtEnd: boolean): boolean {
    return isLoading && isAtEnd;
}
