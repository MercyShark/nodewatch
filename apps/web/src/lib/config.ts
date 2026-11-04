export const ARKIV_CHAIN_ID = 7794095;
export const ARKIV_CHAIN_HEX = "0x76edaf";
export const ARKIV_NETWORK = "Rabdi";

// Assumed default; override with VITE_EXPLORER_URL at build time.
export const EXPLORER_URL = (
  import.meta.env.VITE_EXPLORER_URL ?? "https://explorer.rabdi.db-chain.testnet.arkiv.network"
).replace(/\/$/, "");
export const SWARM_GATEWAY = (import.meta.env.VITE_SWARM_GATEWAY ?? "https://api.gateway.ethswarm.org/bzz").replace(
  /\/$/,
  "",
);

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
export const explorerEntity = (key: string) => `${EXPLORER_URL}/entity/${key}`;
export const swarmLink = (ref: string) => `${SWARM_GATEWAY}/${ref}/`;
