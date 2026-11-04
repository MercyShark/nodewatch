/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** "1" enables mock mode (fixtures + simulated SSE). Never set in production builds. */
  readonly VITE_MOCK?: string;
  /** Block explorer base URL for Rabdi (tx/address/entity links). */
  readonly VITE_EXPLORER_URL?: string;
  /** Swarm gateway for opening references (public samples only). */
  readonly VITE_SWARM_GATEWAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

interface Window {
  ethereum?: EthereumProvider;
}
