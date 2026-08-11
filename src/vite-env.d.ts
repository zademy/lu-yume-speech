/// <reference types="vite/client" />

/** Build-time version from package.json (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
