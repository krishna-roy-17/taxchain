import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createNft,
  mplTokenMetadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  generateSigner,
  percentAmount,
  publicKey as umiPublicKey,
  signerIdentity,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { clusterApiUrl } from "@solana/web3.js";
import { lamportsToSol, bpsToPercent } from "./constants";

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────
export interface NFTReceiptParams {
  wallet:          any;
  receiptNumber:   number;
  businessName:    string;
  productName:     string;
  totalLamports:   number;
  taxLamports:     number;
  netLamports:     number;
  taxRateBps:      number;
  timestamp:       number;
  txRecordPDA:     string;
  txSignature:     string;
  payerWallet:     string;
  businessWallet:  string;
  govWallet:       string;
}

export interface NFTReceiptResult {
  mintAddress: string;
  metadataUri: string;
  explorerUrl: string;
}

// ─────────────────────────────────────────────────────────────
//  UPLOAD METADATA TO IPFS
// ─────────────────────────────────────────────────────────────
async function uploadToIPFS(metadata: object): Promise<string> {
  const jwt = import.meta.env.VITE_PINATA_JWT;

  if (!jwt || jwt === "paste_your_pinata_jwt_here") {
    console.warn("⚠ No Pinata JWT — using placeholder metadata URI");
    return "https://arweave.net/taxchain-receipt-demo";
  }

  try {
    const res = await fetch(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: { name: "TaxChain Receipt NFT" },
        }),
      }
    );

    if (!res.ok) throw new Error(`Pinata error: ${res.status}`);
    const data = await res.json();
    return `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
  } catch (e) {
    console.error("IPFS upload failed:", e);
    return "https://arweave.net/taxchain-receipt-demo";
  }
}

// ─────────────────────────────────────────────────────────────
//  BUILD NFT METADATA
// ─────────────────────────────────────────────────────────────
function buildNFTMetadata(p: NFTReceiptParams) {
  const totalSol  = lamportsToSol(p.totalLamports);
  const taxSol    = lamportsToSol(p.taxLamports);
  const netSol    = lamportsToSol(p.netLamports);
  const taxPct    = bpsToPercent(p.taxRateBps);
  const date      = new Date(p.timestamp * 1000).toLocaleString();
  const receiptNo = String(p.receiptNumber).padStart(4, "0");

  return {
    name:        `TaxChain Receipt #${receiptNo}`,
    symbol:      "TXRCPT",
    description: `Official blockchain tax receipt. Payment of ${totalSol.toFixed(4)} SOL to ${p.businessName}. Tax of ${taxSol.toFixed(4)} SOL (${taxPct}%) automatically collected.`,
    image:       `https://placehold.co/600x600/0d0d14/6c47ff?text=TaxChain%0AReceipt+%23${receiptNo}`,
    external_url: "https://taxchain.app",
    attributes: [
      { trait_type: "Receipt Number",    value: `#${receiptNo}` },
      { trait_type: "Business",          value: p.businessName },
      { trait_type: "Product",           value: p.productName || "Payment" },
      { trait_type: "Total Paid",        value: `${totalSol.toFixed(6)} SOL` },
      { trait_type: "Tax Collected",     value: `${taxSol.toFixed(6)} SOL` },
      { trait_type: "Net to Business",   value: `${netSol.toFixed(6)} SOL` },
      { trait_type: "Tax Rate",          value: `${taxPct}%` },
      { trait_type: "Date",              value: date },
      { trait_type: "Network",           value: "Solana Devnet" },
      { trait_type: "Verified",          value: "true" },
      { trait_type: "TxRecord PDA",      value: p.txRecordPDA },
      { trait_type: "Transaction",       value: p.txSignature },
      { trait_type: "Government Wallet", value: p.govWallet },
    ],
    properties: {
      category: "receipt",
      files: [],
      creators: [{ address: p.businessWallet, share: 100 }],
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  MAIN: MINT NFT RECEIPT
// ─────────────────────────────────────────────────────────────
export async function mintNFTReceipt(
  params: NFTReceiptParams
): Promise<NFTReceiptResult> {
  console.log("🧾 Starting NFT receipt minting...");

  // 1. Build + upload metadata
  const metadata    = buildNFTMetadata(params);
  console.log("📋 Metadata built:", metadata.name);

  console.log("📤 Uploading to IPFS...");
  const metadataUri = await uploadToIPFS(metadata);
  console.log("✅ Metadata URI:", metadataUri);

  // 2. Setup UMI with wallet adapter identity
  //    walletAdapterIdentity wraps the adapter so UMI can sign transactions
  const umi = createUmi(clusterApiUrl("devnet"))
    .use(mplTokenMetadata())
    .use(walletAdapterIdentity(params.wallet));

  // 3. Generate a fresh mint keypair
  const mint = generateSigner(umi);
  console.log("🔑 Mint address:", mint.publicKey);

  // 4. Mint the NFT
  //    - The NFT is minted to `tokenOwner` (the customer's wallet)
  //    - `isMutable: false` locks the receipt permanently
  //    - `sellerFeeBasisPoints: 0` = no royalties
  console.log("⛏ Minting NFT to:", params.payerWallet);

  try {
    const tx = await createNft(umi, {
      mint,
      name:                 metadata.name,
      symbol:               metadata.symbol,
      uri:                  metadataUri,
      sellerFeeBasisPoints: percentAmount(0),
      // FIX: use `tokenOwner` correctly — this IS supported in
      // mpl-token-metadata v3+ for directing the initial token account
      tokenOwner:           umiPublicKey(params.payerWallet),
      isMutable:            false,
      isCollection:         false,
    }).sendAndConfirm(umi, {
      // Increase commitment + preflight checks for devnet reliability
      send: { skipPreflight: false },
      confirm: { commitment: "confirmed" },
    });

    // `tx.signature` is a Uint8Array — convert to base58 string for logging
    const bs58 = await import("bs58");
    const sigString = bs58.default.encode(tx.signature);

    const mintAddress = mint.publicKey.toString();
    const explorerUrl = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;

    console.log("✅ NFT minted successfully!");
    console.log("   Mint:", mintAddress);
    console.log("   Tx sig:", sigString);
    console.log("   Explorer:", explorerUrl);

    return { mintAddress, metadataUri, explorerUrl };

  } catch (err: any) {
    // UMI wraps errors — unwrap for readable message
    const msg = err?.cause?.message ?? err?.message ?? String(err);
    console.error("❌ NFT mint failed:", msg);
    throw new Error(`NFT minting failed: ${msg}`);
  }
}