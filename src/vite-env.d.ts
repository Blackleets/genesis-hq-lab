/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PORT?: string;
  readonly VITE_TITLE?: string;
  readonly VITE_FIXTURES_PATH?: string;
  readonly VITE_GENESIS_READONLY_BASE?: string;
  readonly VITE_USE_LIVE_TILE_OFFICE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
