// import { useMemo } from "react";
// import { useConnection, useWallet } from "@solana/wallet-adapter-react";
// import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
// import {
//   PublicKey,
//   SystemProgram,
//   Transaction,
//   VersionedTransaction,
// } from "@solana/web3.js";
// import idlJson from "../idl/taxpay.json";
// import {
//   PROGRAM_ID,
//   BUSINESS_SEED,
//   TAX_RECORD_SEED,
//   calcTaxSplit,
// } from "../utils/constants";
// import { buildNFTMintInstructions, NFTReceiptParams } from "../utils/nftReceipt";
// import {
//   toWeb3JsInstruction,
//   toWeb3JsKeypair,
// } from "@metaplex-foundation/umi-web3js-adapters";

// // ─────────────────────────────────────────────────────────────
// //  PDA HELPERS
// // ─────────────────────────────────────────────────────────────
// export function deriveBusinessPDA(ownerPubkey: PublicKey): [PublicKey, number] {
//   return PublicKey.findProgramAddressSync(
//     [Buffer.from(BUSINESS_SEED), ownerPubkey.toBuffer()],
//     PROGRAM_ID
//   );
// }

// export function deriveTaxRecordPDA(
//   businessPDA: PublicKey,
//   txIndex: number
// ): [PublicKey, number] {
//   const countBuf = Buffer.alloc(8);
//   countBuf.writeBigUInt64LE(BigInt(txIndex));
//   return PublicKey.findProgramAddressSync(
//     [Buffer.from(TAX_RECORD_SEED), businessPDA.toBuffer(), countBuf],
//     PROGRAM_ID
//   );
// }

// export function buildSolanaPayUrl(
//   recipientPubkey: PublicKey,
//   amountSol: number,
//   productName: string,
//   businessName: string
// ): string {
//   const amount = amountSol.toFixed(9).replace(/\.?0+$/, "");
//   const label = encodeURIComponent(businessName);
//   const message = encodeURIComponent(productName);
//   const memo = encodeURIComponent(productName.slice(0, 32));
//   const query = `amount=${amount}&label=${label}&message=${message}&memo=${memo}`;
//   return `solana:${recipientPubkey.toBase58()}?${query}`;
// }

// // ─────────────────────────────────────────────────────────────
// //  HOOK
// // ─────────────────────────────────────────────────────────────
// export function useProgram() {
//   const { connection } = useConnection();
//   const wallet = useWallet();

//   const provider = useMemo(() => {
//     if (!wallet?.publicKey || !wallet.signTransaction) return null;
//     return new AnchorProvider(connection, wallet as any, {
//       commitment: "confirmed",
//       preflightCommitment: "confirmed",
//     });
//   }, [connection, wallet]);

//   const program = useMemo(() => {
//     if (!provider) return null;
//     try {
//       const p = new Program(idlJson as any, provider);
//       console.log("✅ Program ready:", p.programId.toBase58());
//       return p;
//     } catch (e) {
//       console.error("❌ Program init failed:", e);
//       return null;
//     }
//   }, [provider]);

//   // ── Initialize Business ───────────────────────────────────
//   const initializeBusiness = async (
//     businessName: string,
//     taxRateBps: number,
//     governmentWallet: PublicKey
//   ) => {
//     if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
//     const [businessPDA] = deriveBusinessPDA(wallet.publicKey);
//     const tx = await (program.methods as any)
//       .initializeBusiness(businessName, new BN(taxRateBps))
//       .accounts({
//         businessAccount: businessPDA,
//         owner: wallet.publicKey,
//         governmentWallet,
//         systemProgram: SystemProgram.programId,
//       })
//       .rpc({ commitment: "confirmed" });
//     console.log("✅ Business initialized:", tx);
//     return { tx, businessPDA };
//   };

//   // ── Fetch Business Account ────────────────────────────────
//   const fetchBusiness = async (ownerPubkey?: PublicKey) => {
//     if (!program) return null;
//     const owner = ownerPubkey ?? wallet.publicKey;
//     if (!owner) return null;
//     try {
//       const [businessPDA] = deriveBusinessPDA(owner);
//       const account = await (program.account as any).businessAccount.fetch(businessPDA);
//       return { account, businessPDA };
//     } catch {
//       return null;
//     }
//   };

//   // ── Pay with Tax + Optional NFT (ONE confirmation) ───────
//   const payWithTax = async (
//     businessOwnerPubkey: PublicKey,
//     totalLamports: number,
//     productName: string,
//     invoiceIpfsHash: string = "",
//     nftParams?: Omit<NFTReceiptParams, "txSignature" | "txRecordPDA"> // passed when mintNFT=true
//   ) => {
//     if (!program || !wallet.publicKey) throw new Error("Wallet not connected");

//     const [businessPDA] = deriveBusinessPDA(businessOwnerPubkey);

//     let businessData: any;
//     try {
//       businessData = await (program.account as any).businessAccount.fetch(businessPDA);
//     } catch {
//       throw new Error("Business not initialized. Go to Setup tab and register first.");
//     }

//     const split = calcTaxSplit(totalLamports, businessData.taxRateBps.toNumber());
//     const txIndex = businessData.transactionCount.toNumber();
//     const [taxRecordPDA] = deriveTaxRecordPDA(businessPDA, txIndex);

//     // ── 1. Build Anchor payment instruction ──────────────
//     const payIx = await (program.methods as any)
//       .payWithTax(
//         new BN(totalLamports),
//         invoiceIpfsHash.slice(0, 64),
//         productName.slice(0, 64)
//       )
//       .accounts({
//         businessAccount: businessPDA,
//         payer: wallet.publicKey,
//         businessOwner: businessOwnerPubkey,
//         governmentWallet: businessData.governmentWallet,
//         systemProgram: SystemProgram.programId,
//       })
//       .instruction(); // ← get instruction only, don't send yet

//     // ── 2. If no NFT, just send payment alone ────────────
//     if (!nftParams) {
//       const tx = new Transaction().add(payIx);
//       const { blockhash, lastValidBlockHeight } =
//         await connection.getLatestBlockhash("confirmed");
//       tx.recentBlockhash = blockhash;
//       tx.feePayer = wallet.publicKey;

//       const signed = await wallet.signTransaction!(tx);
//       const sig = await connection.sendRawTransaction(signed.serialize());
//       await connection.confirmTransaction(
//         { signature: sig, blockhash, lastValidBlockHeight },
//         "confirmed"
//       );
//       console.log("✅ Payment tx:", sig);
//       return { tx: sig, taxRecordPDA, split };
//     }

//     // ── 3. Build NFT instructions (upload metadata first) ─
//     console.log("📤 Uploading NFT metadata...");
//     const { umi, builder, mint, metadataUri } = await buildNFTMintInstructions({
//       ...nftParams,
//       txSignature: "pending", // placeholder — not known yet
//       txRecordPDA: taxRecordPDA.toBase58(),
//     });

//     // ── 4. Extract NFT instructions from UMI builder ─────
//     //    Build the UMI transaction to get its instructions,
//     //    then convert each to web3.js format and append
//     const umiTx = await builder.buildWithLatestBlockhash(umi);
//     const nftInstructions = umiTx.message.instructions.map(
//       (ix: any) => toWeb3JsInstruction(ix)
//     );

//     // ── 5. Bundle payment + NFT into ONE transaction ──────
//     const combinedTx = new Transaction();
//     combinedTx.add(payIx);               // payment first
//     nftInstructions.forEach((ix: any) => combinedTx.add(ix)); // then NFT

//     const { blockhash, lastValidBlockHeight } =
//       await connection.getLatestBlockhash("confirmed");
//     combinedTx.recentBlockhash = blockhash;
//     combinedTx.feePayer = wallet.publicKey;

//     // ── 6. Partial-sign with the NFT mint keypair ─────────
//     //    The mint account needs to sign because it's a new keypair.
//     //    The wallet signs everything else (payment + NFT).
//     const mintKeypair = toWeb3JsKeypair(mint);
//     combinedTx.partialSign(mintKeypair);

//     // ── 7. Wallet signs → ONE Phantom confirmation ────────
//     const signed = await wallet.signTransaction!(combinedTx);

//     // ── 8. Send & confirm ─────────────────────────────────
//     const sig = await connection.sendRawTransaction(signed.serialize(), {
//       skipPreflight: false,
//     });
//     await connection.confirmTransaction(
//       { signature: sig, blockhash, lastValidBlockHeight },
//       "confirmed"
//     );

//     console.log("✅ Payment + NFT tx:", sig);

//     const mintAddress = mint.publicKey.toString();
//     const explorerUrl = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;

//     return {
//       tx: sig,
//       taxRecordPDA,
//       split,
//       nftMint: mintAddress,
//       nftUrl: explorerUrl,
//       metadataUri,
//     };
//   };

//   // ── Fetch All Tax Records ─────────────────────────────────
//   const fetchTaxRecords = async (businessOwnerPubkey?: PublicKey) => {
//     if (!program) return [];
//     const owner = businessOwnerPubkey ?? wallet.publicKey;
//     if (!owner) return [];
//     try {
//       const [businessPDA] = deriveBusinessPDA(owner);
//       const bizData = await (program.account as any).businessAccount.fetch(businessPDA);
//       const count = bizData.transactionCount.toNumber();
//       const records = await Promise.all(
//         Array.from({ length: count }, async (_, i) => {
//           const [recordPDA] = deriveTaxRecordPDA(businessPDA, i);
//           try {
//             const rec = await (program.account as any).taxRecord.fetch(recordPDA);
//             return { ...rec, pda: recordPDA };
//           } catch {
//             return null;
//           }
//         })
//       );
//       return records.filter(Boolean);
//     } catch {
//       return [];
//     }
//   };

//   // ── Update Tax Rate ───────────────────────────────────────
//   const updateTaxRate = async (newTaxRateBps: number) => {
//     if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
//     const [businessPDA] = deriveBusinessPDA(wallet.publicKey);
//     const tx = await (program.methods as any)
//       .updateTaxRate(new BN(newTaxRateBps))
//       .accounts({ businessAccount: businessPDA, owner: wallet.publicKey })
//       .rpc({ commitment: "confirmed" });
//     return tx;
//   };

//   // ── Update Government Wallet ──────────────────────────────
//   const updateGovernmentWallet = async (newGovWallet: PublicKey) => {
//     if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
//     const [businessPDA] = deriveBusinessPDA(wallet.publicKey);
//     const tx = await (program.methods as any)
//       .updateGovernmentWallet(newGovWallet)
//       .accounts({ businessAccount: businessPDA, owner: wallet.publicKey })
//       .rpc({ commitment: "confirmed" });
//     return tx;
//   };

//   return {
//     program,
//     provider,
//     deriveBusinessPDA,
//     deriveTaxRecordPDA,
//     buildSolanaPayUrl,
//     initializeBusiness,
//     fetchBusiness,
//     payWithTax,
//     fetchTaxRecords,
//     updateTaxRate,
//     updateGovernmentWallet,
//   };
// }