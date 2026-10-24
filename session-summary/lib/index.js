/**
 * Host half of dsh-session-summary.
 *
 * The whole feature lives in the browser export (`./client`): it reads the
 * session data the native client already holds and navigates with native
 * client services. This entry only makes the package an ordinary Loader row,
 * exactly like DSH's own client-only packages. It registers no routes, tools,
 * model-facing content or storage.
 */
export const name = 'dsh-session-summary';

/** Loader-visible no-op body; the browser half carries the feature. */
export function apply() {}
