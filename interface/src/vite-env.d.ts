/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "exemplo" (padrão) ou "api". Ver src/dados/fonte.ts. */
  readonly VITE_FONTE_DADOS?: string;
}
