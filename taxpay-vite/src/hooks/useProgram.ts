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

  const provider = useMemo(() => {
    if (!wallet?.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    try {
      const p = new Program(idlJson as any, provider);
      console.log("✅ Program ready:", p.programId.toBase58());
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
    const tx = await (program.methods as any)
      .initializeBusiness(businessName, new BN(taxRateBps))
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
        governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
    console.log("✅ Business initialized:", tx);
    return { tx, businessPDA };
  };

  // ── Fetch Business Account ────────────────────────────────
  const fetchBusiness = async (ownerPubkey?: PublicKey) => {
    if (!program) return null;
    const owner = ownerPubkey ?? wallet.publicKey;
    if (!owner) return null;
    try {
      const [businessPDA] = deriveBusinessPDA(owner);
      const account = await (program.account as any).businessAccount.fetch(businessPDA);
      return { account, businessPDA };
    } catch {
      return null;
    }
  };

  // ── Pay with Tax ──────────────────────────────────────────
  const payWithTax = async (
    businessOwnerPubkey: PublicKey,
    totalLamports: number,
    productName: string,
    invoiceIpfsHash: string = ""
  ) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");

    const [businessPDA] = deriveBusinessPDA(businessOwnerPubkey);

    let businessData: any;
    try {
      businessData = await (program.account as any).businessAccount.fetch(businessPDA);
    } catch {
      throw new Error("Business not initialized. Go to Setup tab and register first.");
    }

    const split = calcTaxSplit(totalLamports, businessData.taxRateBps.toNumber());
    const txIndex = businessData.transactionCount.toNumber();

    console.log("💸 payWithTax →", {
      businessPDA: businessPDA.toBase58(),
      payer: wallet.publicKey.toBase58(),
      businessOwner: businessOwnerPubkey.toBase58(),
      govWallet: businessData.governmentWallet.toBase58(),
      txIndex,
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
        payer: wallet.publicKey,
        businessOwner: businessOwnerPubkey,
        governmentWallet: businessData.governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log("✅ Payment tx:", tx);

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
      const bizData = await (program.account as any).businessAccount.fetch(businessPDA);
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
      .accounts({ businessAccount: businessPDA, owner: wallet.publicKey })
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
      .accounts({ businessAccount: businessPDA, owner: wallet.publicKey })
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