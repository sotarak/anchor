/**
 * Full navigation away from the dashboard, for redirects to another origin (an OAuth client's
 * redirect URI, often a loopback URL). A module of its own so tests can replace it.
 */
export function leavePage(url: string): void {
  window.location.assign(url);
}
