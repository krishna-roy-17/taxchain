import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../idl/taxpay.json";
import {
  PROGRAM_ID,
  BUSINESS_SEED,
  TAX_RECORD_SEED,
  calcTaxSplit,
} from "../utils/constants";

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
  if (!wallet || !wallet.publicKey) return null;

  return new AnchorProvider(
    connection,
    wallet as any,
    { commitment: "confirmed" }
  );
}, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idl as any, PROGRAM_ID, provider);
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

    const tx = await program.methods
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
      const account = await program.account.businessAccount.fetch(businessPDA);
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
    let businessData;
try {
  businessData = await program.account.businessAccount.fetch(businessPDA);
} catch {
  throw new Error("Business not initialized");
}
    const txIndex = businessData.transactionCount.toNumber();

    const [taxRecordPDA] = getTaxRecordPDA(businessPDA, txIndex);

    // Compute split for UI display
    const split = calcTaxSplit(totalLamports, businessData.taxRateBps.toNumber());

    const tx = await program.methods
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

  // ── Fetch All Tax Records for a Business ──────────────────
  const fetchTaxRecords = async (businessOwnerPubkey?: PublicKey) => {
    if (!program) return [];
    const owner = businessOwnerPubkey || wallet.publicKey;
    if (!owner) return [];

    try {
      const [businessPDA] = getBusinessPDA(owner);
      const bizData = await program.account.businessAccount.fetch(businessPDA);
      const count = bizData.transactionCount.toNumber();

      const records = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const [recordPDA] = getTaxRecordPDA(businessPDA, i);
          try {
            const rec = await program.account.taxRecord.fetch(recordPDA);
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

    const tx = await program.methods
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