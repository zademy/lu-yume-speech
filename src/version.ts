/**
 * Resolved application version.
 *
 * Priority at build time:
 * 1. `VITE_APP_VERSION` — calendar version injected by the container CI build.
 * 2. `__APP_VERSION__` — release-please semver from package.json via Vite `define`.
 *
 * @see vite.config.ts `define`
 * @see Dockerfile `ARG APP_VERSION`
 */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? __APP_VERSION__;
