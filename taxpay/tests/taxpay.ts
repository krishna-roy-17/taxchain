import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Taxpay } from "../target/types/taxpay";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  sol: number
) {
  try {
    const balance = await provider.connection.getBalance(pubkey);
    const required = sol * LAMPORTS_PER_SOL;
    if (balance >= required * 0.5) {
      console.log(`Skipping airdrop for ${pubkey.toBase58().slice(0, 8)}... — balance sufficient`);
      return;
    }
    const sig = await provider.connection.requestAirdrop(pubkey, required);
    await provider.connection.confirmTransaction(sig, "confirmed");
  } catch (e: any) {
    console.warn(`Airdrop failed for ${pubkey.toBase58().slice(0, 8)}...: ${e.message}`);
    console.warn("Get SOL manually from https://faucet.solana.com");
  }
}

async function transferSol(
  provider: anchor.AnchorProvider,
  from: anchor.web3.Keypair,
  to: PublicKey,
  lamports: number
) {
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx, [from]);
}

function deriveBusinessPDA(
  owner: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("business"), owner.toBuffer()],
    programId
  );
}

async function getBalance(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey
): Promise<number> {
  return provider.connection.getBalance(pubkey);
}

// ─────────────────────────────────────────────────────────────
//  TEST SUITE
// ─────────────────────────────────────────────────────────────

describe("taxpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Taxpay as Program<Taxpay>;

  // Actors
  const owner     = Keypair.generate(); // business owner
  const payer     = Keypair.generate(); // customer
  const govWallet = Keypair.generate(); // government wallet
  const stranger  = Keypair.generate(); // unauthorized user

  let businessPDA: PublicKey;
  let businessBump: number;

  const TAX_RATE_BPS  = new BN(1300); // 13%
  const BUSINESS_NAME = "Krishna Mart";

  // ── Setup ──────────────────────────────────────────────────

  before(async () => {
    const providerWallet = (provider.wallet as anchor.Wallet).payer;

    // Check provider wallet has enough SOL
    const providerBalance = await getBalance(provider, providerWallet.publicKey);
    console.log(`Provider wallet balance: ${providerBalance / LAMPORTS_PER_SOL} SOL`);

    if (providerBalance < 10 * LAMPORTS_PER_SOL) {
      throw new Error(
        `Insufficient SOL in provider wallet.\n` +
        `Balance: ${providerBalance / LAMPORTS_PER_SOL} SOL\n` +
        `Need at least 25 SOL.\n` +
        `Get SOL from: https://faucet.solana.com\n` +
        `Wallet: ${providerWallet.publicKey.toBase58()}`
      );
    }

    // Fund test wallets from provider wallet
    await transferSol(provider, providerWallet, owner.publicKey,    3 * LAMPORTS_PER_SOL);
await transferSol(provider, providerWallet, payer.publicKey,    3 * LAMPORTS_PER_SOL);
await transferSol(provider, providerWallet, stranger.publicKey, 1 * LAMPORTS_PER_SOL);

    console.log("✅ Funded owner, payer, stranger from provider wallet");

    [businessPDA, businessBump] = deriveBusinessPDA(
      owner.publicKey,
      program.programId
    );

    console.log(`Business PDA: ${businessPDA.toBase58()}`);
  });

  // ─────────────────────────────────────────────────────────────
  //  1. initialize_business
  // ─────────────────────────────────────────────────────────────

  describe("initializeBusiness", () => {
    it("creates a BusinessAccount PDA with correct data", async () => {
      await program.methods
        .initializeBusiness(BUSINESS_NAME, TAX_RATE_BPS)
        .accounts({
          owner: owner.publicKey,
          governmentWallet: govWallet.publicKey,
        })
        .signers([owner])
        .rpc();

      const account = await program.account.businessAccount.fetch(businessPDA);

      assert.equal(account.owner.toBase58(),           owner.publicKey.toBase58(),    "owner mismatch");
      assert.equal(account.governmentWallet.toBase58(), govWallet.publicKey.toBase58(), "gov wallet mismatch");
      assert.equal(account.name,                        BUSINESS_NAME,                 "name mismatch");
      assert.equal(account.taxRateBps.toNumber(),       TAX_RATE_BPS.toNumber(),       "tax rate mismatch");
      assert.equal(account.totalRevenue.toNumber(),     0,                             "revenue should be 0");
      assert.equal(account.totalTaxCollected.toNumber(), 0,                            "tax collected should be 0");
      assert.equal(account.transactionCount.toNumber(), 0,                             "tx count should be 0");
      assert.equal(account.bump,                        businessBump,                  "bump mismatch");
    });

    it("rejects tax rate > 10000 bps", async () => {
      const badOwner = Keypair.generate();
      await transferSol(provider, (provider.wallet as anchor.Wallet).payer, badOwner.publicKey, 2 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .initializeBusiness("BadBiz", new BN(10_001))
          .accounts({
            owner: badOwner.publicKey,
            governmentWallet: govWallet.publicKey,
          })
          .signers([badOwner])
          .rpc();
        assert.fail("should have thrown InvalidTaxRate");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidTaxRate");
      }
    });

    it("rejects business name longer than 64 chars", async () => {
      const badOwner = Keypair.generate();
      await transferSol(provider, (provider.wallet as anchor.Wallet).payer, badOwner.publicKey, 2 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .initializeBusiness("A".repeat(65), new BN(1000))
          .accounts({
            owner: badOwner.publicKey,
            governmentWallet: govWallet.publicKey,
          })
          .signers([badOwner])
          .rpc();
        assert.fail("should have thrown NameTooLong");
      } catch (err: any) {
        assert.include(err.toString(), "NameTooLong");
      }
    });

    it("emits BusinessInitialized event", async () => {
      const owner2 = Keypair.generate();
      await transferSol(provider, (provider.wallet as anchor.Wallet).payer, owner2.publicKey, 2 * LAMPORTS_PER_SOL);

      let eventFired = false;
      const listener = program.addEventListener("businessInitialized", (event) => {
        assert.equal(event.owner.toBase58(), owner2.publicKey.toBase58());
        assert.equal(event.name, "EventBiz");
        eventFired = true;
      });

      await program.methods
        .initializeBusiness("EventBiz", new BN(500))
        .accounts({
          owner: owner2.publicKey,
          governmentWallet: govWallet.publicKey,
        })
        .signers([owner2])
        .rpc();

      await new Promise((r) => setTimeout(r, 1000));
      await program.removeEventListener(listener);
      assert.isTrue(eventFired, "BusinessInitialized event not emitted");
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  2. pay_with_tax
  // ─────────────────────────────────────────────────────────────

  describe("payWithTax", () => {
    it("splits payment correctly: tax → gov, net → owner", async () => {
      const totalLamports = new BN(1_130_000);

      const govBefore   = await getBalance(provider, govWallet.publicKey);
      const ownerBefore = await getBalance(provider, owner.publicKey);

      await program.methods
        .payWithTax(totalLamports, "QmTestHash123", "Rice 5kg")
        .accounts({
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
        })
        .signers([payer])
        .rpc();

      const govAfter   = await getBalance(provider, govWallet.publicKey);
      const ownerAfter = await getBalance(provider, owner.publicKey);

      const expectedTax = Math.floor(
        (totalLamports.toNumber() * TAX_RATE_BPS.toNumber()) /
        (10_000 + TAX_RATE_BPS.toNumber())
      );
      const expectedNet = totalLamports.toNumber() - expectedTax;

      assert.equal(govAfter - govBefore,     expectedTax, "incorrect tax sent to gov");
      assert.equal(ownerAfter - ownerBefore, expectedNet, "incorrect net sent to owner");
    });

    it("emits PaymentProcessed event", async () => {
      const amount = new BN(500_000);
      let eventFired = false;

      const listener = program.addEventListener("paymentProcessed", (event) => {
        assert.equal(event.business.toBase58(),   businessPDA.toBase58(),       "event.business wrong");
        assert.equal(event.payer.toBase58(),       payer.publicKey.toBase58(),   "event.payer wrong");
        assert.equal(event.totalAmount.toNumber(), amount.toNumber(),            "event.totalAmount wrong");
        assert.isAbove(event.taxAmount.toNumber(), 0,                            "event.taxAmount should be > 0");
        assert.isAbove(event.netAmount.toNumber(), 0,                            "event.netAmount should be > 0");
        assert.equal(
          event.taxAmount.toNumber() + event.netAmount.toNumber(),
          amount.toNumber(),
          "tax + net should equal total"
        );
        assert.equal(event.productName,            "Event Item",                 "event.productName wrong");
        assert.isAbove(event.timestamp.toNumber(), 0,                            "event.timestamp should be set");
        eventFired = true;
      });

      await program.methods
        .payWithTax(amount, "QmEventHash", "Event Item")
        .accounts({
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
        })
        .signers([payer])
        .rpc();

      await new Promise((r) => setTimeout(r, 1000));
      await program.removeEventListener(listener);
      assert.isTrue(eventFired, "PaymentProcessed event not emitted");
    });

    it("creates an immutable TaxRecord PDA with correct fields", async () => {
      const countBuf = Buffer.alloc(8);
      countBuf.writeBigUInt64LE(0n);
      const [firstRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from("tax_record"), businessPDA.toBuffer(), countBuf],
        program.programId
      );

      const record = await program.account.taxRecord.fetch(firstRecord);

      assert.equal(record.business.toBase58(),         businessPDA.toBase58(),         "record.business wrong");
      assert.equal(record.payer.toBase58(),             payer.publicKey.toBase58(),     "record.payer wrong");
      assert.equal(record.governmentWallet.toBase58(),  govWallet.publicKey.toBase58(), "record.governmentWallet wrong");
      assert.equal(record.productName,                  "Rice 5kg",                     "product name wrong");
      assert.equal(record.invoiceIpfsHash,              "QmTestHash123",                "IPFS hash wrong");
      assert.equal(record.taxRateBps.toNumber(),        TAX_RATE_BPS.toNumber(),        "tax rate wrong");
      assert.isAbove(record.timestamp.toNumber(),       0,                              "timestamp should be set");
    });

    it("updates BusinessAccount stats after payment", async () => {
      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.isAbove(biz.transactionCount.toNumber(),  0, "tx count should be > 0");
      assert.isAbove(biz.totalRevenue.toNumber(),      0, "revenue should be > 0");
      assert.isAbove(biz.totalTaxCollected.toNumber(), 0, "tax collected should be > 0");
    });

    it("rejects zero payment", async () => {
      try {
        await program.methods
          .payWithTax(new BN(0), "", "nothing")
          .accounts({
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
          })
          .signers([payer])
          .rpc();
        assert.fail("should have thrown ZeroAmount");
      } catch (err: any) {
        assert.include(err.toString(), "ZeroAmount");
      }
    });

    it("rejects IPFS hash longer than 64 chars", async () => {
      try {
        await program.methods
          .payWithTax(new BN(1_000_000), "Q".repeat(65), "item")
          .accounts({
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
          })
          .signers([payer])
          .rpc();
        assert.fail("should have thrown HashTooLong");
      } catch (err: any) {
        assert.include(err.toString(), "HashTooLong");
      }
    });

    it("handles multiple sequential payments correctly", async () => {
      const bizBefore   = await program.account.businessAccount.fetch(businessPDA);
      const countBefore = bizBefore.transactionCount.toNumber();

      for (let i = 0; i < 3; i++) {
        await program.methods
          .payWithTax(new BN(500_000), "", `Item ${i}`)
          .accounts({
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
          })
          .signers([payer])
          .rpc();
      }

      const bizAfter = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(
        bizAfter.transactionCount.toNumber(),
        countBefore + 3,
        "transaction count should have increased by 3"
      );
    });

    it("rejects payment if payer has insufficient funds", async () => {
      const brokePayer = Keypair.generate();
      await transferSol(provider, (provider.wallet as anchor.Wallet).payer, brokePayer.publicKey, 0.001 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .payWithTax(new BN(1_000_000_000), "", "expensive item")
          .accounts({
            payer: brokePayer.publicKey,
            businessOwner: owner.publicKey,
          })
          .signers([brokePayer])
          .rpc();
        assert.fail("should have thrown an error");
      } catch (err: any) {
        const msg = err.toString();
        const isExpectedError =
          msg.includes("InsufficientFunds")     ||
          msg.includes("insufficient lamports") ||
          msg.includes("0x1");
        assert.isTrue(isExpectedError, `unexpected error: ${msg}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  3. update_tax_rate
  // ─────────────────────────────────────────────────────────────

  describe("updateTaxRate", () => {
    it("allows owner to update tax rate", async () => {
      await program.methods
        .updateTaxRate(new BN(500))
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 500, "tax rate not updated");
    });

    it("rejects update from non-owner", async () => {
      try {
        await program.methods
          .updateTaxRate(new BN(9999))
          .accounts({ owner: stranger.publicKey })
          .signers([stranger])
          .rpc();
        assert.fail("stranger should not be able to update tax rate");
      } catch (err: any) {
        assert.ok(err, "error thrown as expected");
      }
    });

    it("rejects tax rate above 10000 bps", async () => {
      try {
        await program.methods
          .updateTaxRate(new BN(10_001))
          .accounts({ owner: owner.publicKey })
          .signers([owner])
          .rpc();
        assert.fail("should have thrown InvalidTaxRate");
      } catch (err: any) {
        assert.include(err.toString(), "InvalidTaxRate");
      }
    });

    it("accepts 0% tax rate (tax-free)", async () => {
      await program.methods
        .updateTaxRate(new BN(0))
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 0, "should allow 0% tax");
    });

    it("accepts exactly 10000 bps", async () => {
      await program.methods
        .updateTaxRate(new BN(10_000))
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 10_000, "should allow 10000 bps");
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  4. update_government_wallet
  // ─────────────────────────────────────────────────────────────

  describe("updateGovernmentWallet", () => {
    const newGovWallet = Keypair.generate();

    it("allows owner to update government wallet", async () => {
      await program.methods
        .updateGovernmentWallet(newGovWallet.publicKey)
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(
        biz.governmentWallet.toBase58(),
        newGovWallet.publicKey.toBase58(),
        "government wallet not updated"
      );
    });

    it("rejects update from non-owner", async () => {
      try {
        await program.methods
          .updateGovernmentWallet(stranger.publicKey)
          .accounts({ owner: stranger.publicKey })
          .signers([stranger])
          .rpc();
        assert.fail("stranger should not be able to update gov wallet");
      } catch (err: any) {
        assert.ok(err, "error thrown as expected");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  5. Edge cases & math verification
  // ─────────────────────────────────────────────────────────────

  describe("math edge cases", () => {
    it("verifies tax formula at 0% rate: all goes to owner", async () => {
      await program.methods
        .updateTaxRate(new BN(0))
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      await program.methods
        .updateGovernmentWallet(govWallet.publicKey)
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const govBefore   = await getBalance(provider, govWallet.publicKey);
      const ownerBefore = await getBalance(provider, owner.publicKey);

      await program.methods
        .payWithTax(new BN(1_000_000), "", "zero tax item")
        .accounts({
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
        })
        .signers([payer])
        .rpc();

      const govAfter   = await getBalance(provider, govWallet.publicKey);
      const ownerAfter = await getBalance(provider, owner.publicKey);

      assert.equal(govAfter - govBefore,     0,         "gov should receive 0 at 0% tax");
      assert.equal(ownerAfter - ownerBefore, 1_000_000, "owner should receive full amount at 0% tax");
    });

    it("verifies tax formula at 10000 bps: 50% to gov, 50% to owner", async () => {
      await program.methods
        .updateTaxRate(new BN(10_000))
        .accounts({ owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const govBefore   = await getBalance(provider, govWallet.publicKey);
      const ownerBefore = await getBalance(provider, owner.publicKey);
      const amount      = new BN(1_000_000);

      await program.methods
        .payWithTax(amount, "", "full tax item")
        .accounts({
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
        })
        .signers([payer])
        .rpc();

      const govAfter   = await getBalance(provider, govWallet.publicKey);
      const ownerAfter = await getBalance(provider, owner.publicKey);

      const expectedTax = Math.floor(
        (amount.toNumber() * 10_000) / (10_000 + 10_000)
      );
      const expectedNet = amount.toNumber() - expectedTax;

      assert.equal(govAfter - govBefore,     expectedTax, "gov should receive 50% at 10000 bps");
      assert.equal(ownerAfter - ownerBefore, expectedNet, "owner should receive 50% at 10000 bps");
    });
  });
});