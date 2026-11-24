/** Only allow redirects to paths on this site (prevents open-redirect tricks). */
export const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null)
