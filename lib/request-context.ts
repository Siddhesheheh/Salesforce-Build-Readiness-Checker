import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient request context storing an AbortController for active web reviews.
 * Allows the 90-second overall deadline to actively abort underlying Gemini fetches
 * without breaking signatures of existing callers or spies.
 */
export const reviewAbortContext = new AsyncLocalStorage<AbortController>();
