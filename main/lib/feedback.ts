/**
 * First-response feedback trigger (pure, shared)
 * ==============================================
 * Decides whether the "how was your first answer?" popup should open
 * after a generation completes. Exactly-once per browser (persisted
 * `feedbackPrompted` flag) and only for genuine first answers — never
 * for errors, empty streams, or follow-up turns.
 */

export interface FirstFeedbackState {
    /** Persisted flag: popup already shown once. */
    prompted: boolean;
    /** Completed assistant messages with non-empty content in the store. */
    assistantCount: number;
    /** The just-finished message errored (refusal, abort, exception). */
    isError: boolean;
    /** The just-finished generation produced visible content. */
    hasContent: boolean;
}

export function shouldPromptFirstFeedback(state: FirstFeedbackState): boolean {
    if (state.prompted) return false;
    if (state.isError) return false;
    if (!state.hasContent) return false;
    return state.assistantCount === 1;
}
