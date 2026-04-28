import { PublicKey, clusterApiUrl } from "@solana/web3.js";

// ─── Program ────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(
  "Bnp8UqAEKSiLBPfNtDdbJjkMFT3YVQ3sMaMBbNw3AuC1"
);

// ─── Network ─────────────────────────────────────────────────
// Change to "mainnet-beta" for production
export const NETWORK = "devnet" as const;
export const RPC_ENDPOINT = clusterApiUrl(NETWORK);

// ─── Government Wallet (Demo) ────────────────────────────────
// Replace with actual government / tax authority wallet for production
export const DEMO_GOVERNMENT_WALLET = new PublicKey(
  "5rHBTazwtrJjzEE2eN6Qypk9cHVPKhiJzUpKZxrC3nCM"
);

// ─── Tax config ───────────────────────────────────────────────
export const DEFAULT_TAX_RATE_BPS = 1300; // 13% (Nepal VAT)
export const LAMPORTS_PER_SOL = 1_000_000_000;

// ─── PDA seeds ───────────────────────────────────────────────
export const BUSINESS_SEED = "business";
export const TAX_RECORD_SEED = "tax_record";

// ─── Helpers ─────────────────────────────────────────────────
export const bpsToPercent = (bps: number) => bps / 100;

export const calcTaxSplit = (
  totalLamports: number,
  taxRateBps: number
): { taxAmount: number; netAmount: number } => {
  const taxAmount = Math.floor(
    (totalLamports * taxRateBps) / (10000 + taxRateBps)
  );
  const netAmount = totalLamports - taxAmount;
  return { taxAmount, netAmount };
};

export const lamportsToSol = (lamports: number) =>
  lamports / LAMPORTS_PER_SOL;

export const solToLamports = (sol: number) =>
  Math.floor(sol * LAMPORTS_PER_SOL);

export const formatSol = (lamports: number, decimals = 6) =>
  lamportsToSol(lamports).toFixed(decimals);

export const shortenAddress = (addr: string, chars = 4) =>
  `${addr.slice(0, chars)}...${addr.slice(-chars)}`;

export const formatTimestamp = (ts: number) =>
  new Date(ts * 1000).toLocaleString();