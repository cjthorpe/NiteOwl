/// <reference types="vite/client" />

/**
 * Typed access to the Vite-injected `import.meta.env`. Without this, the parser
 * treats `import.meta.env` as `any`, which trips @typescript-eslint's
 * no-unsafe-* rules at every call site. Declaring the env shape here makes the
 * values properly typed (and lets us drop the old `(import.meta as any)` casts).
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
