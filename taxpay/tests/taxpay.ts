import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Taxpay } from "../target/types/taxpay";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("taxpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Taxpay as Program<Taxpay>;

  // Keypairs
  const businessOwner = Keypair.generate();
  const governmentWallet = Keypair.generate();
  const customer = Keypair.generate();

  // PDA
  let businessPDA: PublicKey;
  let businessBump: number;

  before(async () => {
    // Airdrop SOL to all test wallets
    const sig1 = await provider.connection.requestAirdrop(
  businessOwner.publicKey,
  5 * LAMPORTS_PER_SOL
);
await provider.connection.confirmTransaction(sig1);

const sig2 = await provider.connection.requestAirdrop(
  customer.publicKey,
  5 * LAMPORTS_PER_SOL
);
await provider.connection.confirmTransaction(sig2);

const sig3 = await provider.connection.requestAirdrop(
  governmentWallet.publicKey,
  LAMPORTS_PER_SOL
);
await provider.connection.confirmTransaction(sig3);
  });

  it("✅ Initialize Business Account", async () => {
    const tx = await program.methods
      .initializeBusiness("Test Business", new anchor.BN(1300)) // 13% tax
      .accounts({
        businessAccount: businessPDA,
        owner: businessOwner.publicKey,
        governmentWallet: governmentWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([businessOwner])
      .rpc();

    console.log("  Init tx:", tx);

    const account = await program.account.businessAccount.fetch(businessPDA);
    assert.equal(account.name, "Test Business");
    assert.equal(account.taxRateBps.toNumber(), 1300);
    assert.ok(account.owner.equals(businessOwner.publicKey));
    assert.ok(account.governmentWallet.equals(governmentWallet.publicKey));
    assert.equal(account.transactionCount.toNumber(), 0);
    console.log("  ✅ Business initialized successfully");
  });

  it("✅ Process Payment with Tax Split", async () => {
    const totalLamports = new anchor.BN(1_130_000); // 1.13 SOL (representing 1130 Rs equivalent)

    // Pre-balances
    const govBalanceBefore =
      await provider.connection.getBalance(governmentWallet.publicKey);
    const ownerBalanceBefore =
      await provider.connection.getBalance(businessOwner.publicKey);

    // Derive tax record PDA
    const [taxRecordPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tax_record"),
        businessPDA.toBuffer(),
        Buffer.from(new anchor.BN(0).toArrayLike(Buffer, "le", 8)),
      ],
      program.programId
    );

    const tx = await program.methods
      .payWithTax(totalLamports, "QmTestIPFSHash123", "Test Product")
      .accounts({
        businessAccount: businessPDA,
        taxRecord: taxRecordPDA,
        payer: customer.publicKey,
        businessOwner: businessOwner.publicKey,
        governmentWallet: governmentWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([customer])
      .rpc();

    console.log("  Payment tx:", tx);

    // Post-balances
    const govBalanceAfter =
      await provider.connection.getBalance(governmentWallet.publicKey);
    const ownerBalanceAfter =
      await provider.connection.getBalance(businessOwner.publicKey);

    // Expected: tax = 1_130_000 * 1300 / (10000 + 1300) = ~129_204 lamports
    const expectedTax = Math.floor((1_130_000 * 1300) / (10000 + 1300));
    const expectedNet = 1_130_000 - expectedTax;

    console.log(`  Expected tax:  ${expectedTax} lamports`);
    console.log(`  Expected net:  ${expectedNet} lamports`);
    console.log(`  Gov received:  ${govBalanceAfter - govBalanceBefore}`);
    console.log(`  Owner received: ${ownerBalanceAfter - ownerBalanceBefore}`);

    assert.approximately(
      govBalanceAfter - govBalanceBefore,
      expectedTax,
      100,
      "Government received wrong tax amount"
    );
    assert.approximately(
      ownerBalanceAfter - ownerBalanceBefore,
      expectedNet,
      100,
      "Business owner received wrong net amount"
    );

    // Verify tax record
    const record = await program.account.taxRecord.fetch(taxRecordPDA);
    assert.equal(record.totalAmount.toNumber(), 1_130_000);
    assert.equal(record.productName, "Test Product");
    assert.equal(record.invoiceIpfsHash, "QmTestIPFSHash123");
    console.log("  ✅ Payment split correctly verified");

    // Verify business stats updated
    const business =
      await program.account.businessAccount.fetch(businessPDA);
    assert.equal(business.transactionCount.toNumber(), 1);
    console.log("  ✅ Business stats updated");
  });

  it("✅ Update Tax Rate", async () => {
    await program.methods
      .updateTaxRate(new anchor.BN(1500)) // change to 15%
      .accounts({
        businessAccount: businessPDA,
        owner: businessOwner.publicKey,
      })
      .signers([businessOwner])
      .rpc();

    const account = await program.account.businessAccount.fetch(businessPDA);
    assert.equal(account.taxRateBps.toNumber(), 1500);
    console.log("  ✅ Tax rate updated to 15%");
  });

  it("❌ Rejects invalid tax rate > 100%", async () => {
    try {
      await program.methods
        .updateTaxRate(new anchor.BN(15000)) // >100%
        .accounts({
          businessAccount: businessPDA,
          owner: businessOwner.publicKey,
        })
        .signers([businessOwner])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.toString(), "InvalidTaxRate");
      console.log("  ✅ Correctly rejected invalid tax rate");
    }
  });

  it("❌ Rejects zero payment", async () => {
    const [taxRecordPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tax_record"),
        businessPDA.toBuffer(),
        Buffer.from(new anchor.BN(1).toArrayLike(Buffer, "le", 8)),
      ],
      program.programId
    );
    try {
      await program.methods
        .payWithTax(new anchor.BN(0), "", "Zero Product")
        .accounts({
          businessAccount: businessPDA,
          taxRecord: taxRecordPDA,
          payer: customer.publicKey,
          businessOwner: businessOwner.publicKey,
          governmentWallet: governmentWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([customer])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.include(err.toString(), "ZeroAmount");
      console.log("  ✅ Correctly rejected zero payment");
    }
  });
});