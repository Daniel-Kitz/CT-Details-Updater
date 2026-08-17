/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KEY?: string;
  readonly VITE_BASE_URL?: string;
  readonly VITE_USERNAME?: string;
  readonly VITE_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
