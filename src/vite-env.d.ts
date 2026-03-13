/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARBISCAN_API_KEY?: string
  readonly VITE_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
