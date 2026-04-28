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

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // ── Provider ──────────────────────────────────────────────
  const provider = useMemo(() => {
    if (!wallet || !wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  // ── Program ───────────────────────────────────────────────
  // Anchor 0.30.x: new Program(idl, provider) — only 2 args
  // The program ID is read from idl.address
  const program = useMemo(() => {
    if (!provider) return null;
    try {
      const p = new Program(idlJson as any, provider);
      console.log("✅ Program created. Available methods:", Object.keys(p.methods));
      return p;
    } catch (e) {
      console.error("❌ Program creation failed:", e);
      return null;
    }
  }, [provider]);

  // ── Derive Business PDA ───────────────────────────────────
  const getBusinessPDA = (ownerPubkey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(BUSINESS_SEED), ownerPubkey.toBuffer()],
      PROGRAM_ID
    );
  };

  // ── Derive TaxRecord PDA ──────────────────────────────────
  const getTaxRecordPDA = (
    businessPDA: PublicKey,
    txIndex: number
  ): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from(TAX_RECORD_SEED),
        businessPDA.toBuffer(),
        new BN(txIndex).toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    );
  };

  // ── Initialize Business ───────────────────────────────────
  const initializeBusiness = async (
    businessName: string,
    taxRateBps: number,
    governmentWallet: PublicKey
  ) => {
    if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
    const [businessPDA] = getBusinessPDA(wallet.publicKey);

    console.log("Calling initializeBusiness...");
    console.log("  businessPDA:", businessPDA.toBase58());
    console.log("  owner:", wallet.publicKey.toBase58());
    console.log("  govWallet:", governmentWallet.toBase58());
    console.log("  taxRateBps:", taxRateBps);

    const tx = await (program.methods as any)
      .initializeBusiness(businessName, new BN(taxRateBps))
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
        governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    return { tx, businessPDA };
  };

  // ── Fetch Business Account ────────────────────────────────
  const fetchBusiness = async (ownerPubkey?: PublicKey) => {
    if (!program) return null;
    const owner = ownerPubkey || wallet.publicKey;
    if (!owner) return null;
    try {
      const [businessPDA] = getBusinessPDA(owner);
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

    const [businessPDA] = getBusinessPDA(businessOwnerPubkey);
    let businessData: any;
    try {
      businessData = await (program.account as any).businessAccount.fetch(businessPDA);
    } catch {
      throw new Error("Business not initialized. Go to Setup tab first.");
    }

    const txIndex = businessData.transactionCount.toNumber();
    const [taxRecordPDA] = getTaxRecordPDA(businessPDA, txIndex);
    const split = calcTaxSplit(totalLamports, businessData.taxRateBps.toNumber());

    const tx = await (program.methods as any)
      .payWithTax(
        new BN(totalLamports),
        invoiceIpfsHash.slice(0, 64),
        productName.slice(0, 64)
      )
      .accounts({
        businessAccount: businessPDA,
        taxRecord: taxRecordPDA,
        payer: wallet.publicKey,
        businessOwner: businessOwnerPubkey,
        governmentWallet: businessData.governmentWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    return { tx, taxRecordPDA, split };
  };

  // ── Fetch All Tax Records ─────────────────────────────────
  const fetchTaxRecords = async (businessOwnerPubkey?: PublicKey) => {
    if (!program) return [];
    const owner = businessOwnerPubkey || wallet.publicKey;
    if (!owner) return [];
    try {
      const [businessPDA] = getBusinessPDA(owner);
      const bizData = await (program.account as any).businessAccount.fetch(businessPDA);
      const count = bizData.transactionCount.toNumber();
      const records = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const [recordPDA] = getTaxRecordPDA(businessPDA, i);
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
    const [businessPDA] = getBusinessPDA(wallet.publicKey);
    const tx = await (program.methods as any)
      .updateTaxRate(new BN(newTaxRateBps))
      .accounts({
        businessAccount: businessPDA,
        owner: wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });
    return tx;
  };

  return {
    program,
    provider,
    getBusinessPDA,
    getTaxRecordPDA,
    initializeBusiness,
    fetchBusiness,
    payWithTax,
    fetchTaxRecords,
    updateTaxRate,
  };
}