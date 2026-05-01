import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idlJson from "../idl/taxpay.json";
import {
  PROGRAM_ID,
  BUSINESS_SEED,
  TAX_RECORD_SEED,
  calcTaxSplit,
} from "../utils/constants";

// ─────────────────────────────────────────────────────────────
//  PDA HELPERS
// ─────────────────────────────────────────────────────────────

export function deriveBusinessPDA(ownerPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BUSINESS_SEED), ownerPubkey.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveTaxRecordPDA(
  businessPDA: PublicKey,
  txIndex: number
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(BigInt(txIndex));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TAX_RECORD_SEED), businessPDA.toBuffer(), countBuf],
    PROGRAM_ID
  );
}

export function buildSolanaPayUrl(
  recipientPubkey: PublicKey,
  amountSol: number,
  productName: string,
  businessName: string
): string {
  const amount = amountSol.toFixed(9).replace(/\.?0+$/, "");
  const label = encodeURIComponent(businessName);
  const message = encodeURIComponent(productName);
  const memo = encodeURIComponent(productName.slice(0, 32));
  const query = `amount=${amount}&label=${label}&message=${message}&memo=${memo}`;
  return `solana:${recipientPubkey.toBase58()}?${query}`;
}

// ─────────────────────────────────────────────────────────────
//  HOOK
// ─────────────────────────────────────────────────────────────

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // ── Provider ──────────────────────────────────────────────
  const provider = useMemo(() => {
    if (!wallet?.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  // ── Program ───────────────────────────────────────────────
  const program = useMemo(() => {
    if (!provider) return null;
    try {
      const p = new Program(idlJson as any, provider);
      console.log("✅ Program ready. Methods:", Object.keys(p.methods));
      console.log("✅ Program ID:", p.programId.toBase58());
      return p;
    } catch (e) {
      console.error("❌ Program init failed:", e);
      return null;
    }
  }, [provider]);

  // ── Initialize Business ───────────────────────────────────
  const initializeBusiness = async (
    businessName: string,
    taxRateBps: number,
    governmentWallet: PublicKey
  ) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");

    const [businessPDA] = deriveBusinessPDA(wallet.publicKey);

    console.log("📝 initializeBusiness →", {
      businessPDA: businessPDA.toBase58(),
      owner: wallet.publicKey.toBase58(),
      governmentWallet: governmentWallet.toBase58(),
      taxRateBps,
    });

    const tx = await (program.methods as any)
      .initializeBusiness(businessName, new BN(taxRateBps))
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
        governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("✅ Business initialized. Tx:", tx);
    return { tx, businessPDA };
  };

  // ── Fetch Business Account ────────────────────────────────
  const fetchBusiness = async (ownerPubkey?: PublicKey) => {
    if (!program) return null;
    const owner = ownerPubkey ?? wallet.publicKey;
    if (!owner) return null;
    try {
      const [businessPDA] = deriveBusinessPDA(owner);
      const account = await (program.account as any).businessAccount.fetch(
        businessPDA
      );
      return { account, businessPDA };
    } catch {
      console.warn("No business account found for:", owner.toBase58());
      return null;
    }
  };

  // ── Pay with Tax ──────────────────────────────────────────
  // FIX: Removed `owner` from accounts entirely.
  //
  // The old contract had `owner: Signer` in PayWithTax which meant
  // the business owner had to co-sign every customer payment.
  // This made QR code payments impossible — a customer scanning a QR
  // only signs with their own wallet, not the business owner's wallet.
  //
  // The new contract only requires the customer (payer) to sign.
  // The business_owner is just a recipient AccountInfo, verified on-chain
  // via `address = business_account.owner` constraint.
  const payWithTax = async (
    businessOwnerPubkey: PublicKey,
    totalLamports: number,
    productName: string,
    invoiceIpfsHash: string = ""
  ) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");

    // ── 1. Derive business PDA from owner ─────────────────
    const [businessPDA] = deriveBusinessPDA(businessOwnerPubkey);

    // ── 2. Fetch on-chain state ───────────────────────────
    let businessData: any;
    try {
      businessData = await (program.account as any).businessAccount.fetch(
        businessPDA
      );
    } catch {
      throw new Error(
        "Business not initialized. Go to Setup tab and register first."
      );
    }

    // ── 3. Calc split for return value only ───────────────
    const split = calcTaxSplit(
      totalLamports,
      businessData.taxRateBps.toNumber()
    );

    console.log("💸 payWithTax →", {
      businessPDA: businessPDA.toBase58(),
      payer: wallet.publicKey.toBase58(),         // customer — the one signing
      businessOwner: businessOwnerPubkey.toBase58(), // just a recipient, no signature needed
      govWallet: businessData.governmentWallet.toBase58(),
      txIndex: businessData.transactionCount.toNumber(),
      split,
    });

    const tx = await (program.methods as any)
      .payWithTax(
        new BN(totalLamports),
        invoiceIpfsHash.slice(0, 64),
        productName.slice(0, 64)
      )
      .accounts({
        businessAccount: businessPDA,
        // taxRecord omitted — Anchor auto-derives from seeds ✅
        payer: wallet.publicKey,               // customer signs ✅
        businessOwner: businessOwnerPubkey,    // just receives funds, no signature ✅
        // owner field removed — no longer exists in contract ✅
        governmentWallet: businessData.governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("✅ Payment processed. Tx:", tx);

    const txIndex = businessData.transactionCount.toNumber();
    const [taxRecordPDA] = deriveTaxRecordPDA(businessPDA, txIndex);

    return { tx, taxRecordPDA, split };
  };

  // ── Fetch All Tax Records ─────────────────────────────────
  const fetchTaxRecords = async (businessOwnerPubkey?: PublicKey) => {
    if (!program) return [];
    const owner = businessOwnerPubkey ?? wallet.publicKey;
    if (!owner) return [];
    try {
      const [businessPDA] = deriveBusinessPDA(owner);
      const bizData = await (program.account as any).businessAccount.fetch(
        businessPDA
      );
      const count = bizData.transactionCount.toNumber();
      const records = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const [recordPDA] = deriveTaxRecordPDA(businessPDA, i);
          try {
            const rec = await (program.account as any).taxRecord.fetch(recordPDA);
            return { ...rec, pda: recordPDA };
          } catch {
            return null;
          }
        })
      );
      return records.filter(Boolean);
    } catch {
      return [];
    }
  };

  // ── Update Tax Rate ───────────────────────────────────────
  const updateTaxRate = async (newTaxRateBps: number) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
    const [businessPDA] = deriveBusinessPDA(wallet.publicKey);
    const tx = await (program.methods as any)
      .updateTaxRate(new BN(newTaxRateBps))
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    console.log("✅ Tax rate updated:", tx);
    return tx;
  };

  // ── Update Government Wallet ──────────────────────────────
  const updateGovernmentWallet = async (newGovWallet: PublicKey) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
    const [businessPDA] = deriveBusinessPDA(wallet.publicKey);
    const tx = await (program.methods as any)
      .updateGovernmentWallet(newGovWallet)
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    console.log("✅ Gov wallet updated:", tx);
    return tx;
  };

  return {
    program,
    provider,
    deriveBusinessPDA,
    deriveTaxRecordPDA,
    buildSolanaPayUrl,
    initializeBusiness,
    fetchBusiness,
    payWithTax,
    fetchTaxRecords,
    updateTaxRate,
    updateGovernmentWallet,
  };
}