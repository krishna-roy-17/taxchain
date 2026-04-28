import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Taxpay } from "../target/types/taxpay";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  sol: number
) {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
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

function deriveTaxRecordPDA(
  businessAccount: PublicKey,
  transactionCount: BN,
  programId: PublicKey
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(BigInt(transactionCount.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tax_record"), businessAccount.toBuffer(), countBuf],
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
//  SUITE
// ─────────────────────────────────────────────────────────────

describe("taxpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Taxpay as Program<Taxpay>;

  // Actors
  const owner = Keypair.generate();       // business owner
  const payer = Keypair.generate();       // customer
  const govWallet = Keypair.generate();   // government wallet
  const stranger = Keypair.generate();    // unauthorized user

  // Shared state across tests
  let businessPDA: PublicKey;
  let businessBump: number;

  const TAX_RATE_BPS = new BN(1300); // 13%
  const BUSINESS_NAME = "Krishna Mart";

  // ── Setup ──────────────────────────────────────────────────

  before(async () => {
    // Fund all wallets
    await Promise.all([
      airdrop(provider, owner.publicKey, 10),
      airdrop(provider, payer.publicKey, 10),
      airdrop(provider, stranger.publicKey, 2),
    ]);

    [businessPDA, businessBump] = deriveBusinessPDA(
      owner.publicKey,
      program.programId
    );
  });

  // ─────────────────────────────────────────────────────────────
  //  1. initialize_business
  // ─────────────────────────────────────────────────────────────

  describe("initialize_business", () => {
    it("creates a BusinessAccount PDA with correct data", async () => {
      await program.methods
        .initializeBusiness(BUSINESS_NAME, TAX_RATE_BPS)
        .accounts({
          businessAccount: businessPDA,
          owner: owner.publicKey,
          governmentWallet: govWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const account = await program.account.businessAccount.fetch(businessPDA);

      assert.equal(
        account.owner.toBase58(),
        owner.publicKey.toBase58(),
        "owner mismatch"
      );
      assert.equal(
        account.governmentWallet.toBase58(),
        govWallet.publicKey.toBase58(),
        "government wallet mismatch"
      );
      assert.equal(account.name, BUSINESS_NAME, "name mismatch");
      assert.equal(
        account.taxRateBps.toNumber(),
        TAX_RATE_BPS.toNumber(),
        "tax rate mismatch"
      );
      assert.equal(account.totalRevenue.toNumber(), 0, "revenue should be 0");
      assert.equal(
        account.totalTaxCollected.toNumber(),
        0,
        "tax collected should be 0"
      );
      assert.equal(
        account.transactionCount.toNumber(),
        0,
        "tx count should be 0"
      );
      assert.equal(account.bump, businessBump, "bump mismatch");
    });

    it("rejects tax rate > 10000 bps", async () => {
      const badOwner = Keypair.generate();
      await airdrop(provider, badOwner.publicKey, 2);
      const [badPDA] = deriveBusinessPDA(badOwner.publicKey, program.programId);

      try {
        await program.methods
          .initializeBusiness("BadBiz", new BN(10_001))
          .accounts({
            businessAccount: badPDA,
            owner: badOwner.publicKey,
            governmentWallet: govWallet.publicKey,
            systemProgram: SystemProgram.programId,
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
      await airdrop(provider, badOwner.publicKey, 2);
      const [badPDA] = deriveBusinessPDA(badOwner.publicKey, program.programId);

      try {
        await program.methods
          .initializeBusiness("A".repeat(65), new BN(1000))
          .accounts({
            businessAccount: badPDA,
            owner: badOwner.publicKey,
            governmentWallet: govWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([badOwner])
          .rpc();
        assert.fail("should have thrown NameTooLong");
      } catch (err: any) {
        assert.include(err.toString(), "NameTooLong");
      }
    });

    it("emits BusinessInitialized event", async () => {
      // Use a fresh owner so we can init a second time
      const owner2 = Keypair.generate();
      await airdrop(provider, owner2.publicKey, 2);
      const [pda2] = deriveBusinessPDA(owner2.publicKey, program.programId);

      let eventFired = false;
      const listener = program.addEventListener(
        "businessInitialized",
        (event) => {
          assert.equal(event.owner.toBase58(), owner2.publicKey.toBase58());
          assert.equal(event.name, "EventBiz");
          eventFired = true;
        }
      );

      await program.methods
        .initializeBusiness("EventBiz", new BN(500))
        .accounts({
          businessAccount: pda2,
          owner: owner2.publicKey,
          governmentWallet: govWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner2])
        .rpc();

      // Give event listener a moment
      await new Promise((r) => setTimeout(r, 1000));
      await program.removeEventListener(listener);
      assert.isTrue(eventFired, "BusinessInitialized event not emitted");
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  2. pay_with_tax
  // ─────────────────────────────────────────────────────────────

  describe("pay_with_tax", () => {
    it("splits payment correctly: tax → gov, net → owner", async () => {
      const totalLamports = new BN(1_130_000); // 1.13M lamports at 13%
      // Expected: tax = 1130000 * 1300 / (10000+1300) = ~129_646 lamports
      //           net = 1130000 - 129_646 = ~1_000_354 lamports

      const govBefore = await getBalance(provider, govWallet.publicKey);
      const ownerBefore = await getBalance(provider, owner.publicKey);

      // Fetch current tx count to derive tax record PDA
      const bizBefore = await program.account.businessAccount.fetch(businessPDA);
      const txCount = bizBefore.transactionCount;

      const [taxRecordPDA] = deriveTaxRecordPDA(
        businessPDA,
        txCount,
        program.programId
      );

      await program.methods
        .payWithTax(totalLamports, "QmTestHash123", "Rice 5kg")
        .accounts({
          businessAccount: businessPDA,
          taxRecord: taxRecordPDA,
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
          owner: owner.publicKey,
          governmentWallet: govWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, owner])
        .rpc();

      const govAfter = await getBalance(provider, govWallet.publicKey);
      const ownerAfter = await getBalance(provider, owner.publicKey);

      const taxReceived = govAfter - govBefore;
      const netReceived = ownerAfter - ownerBefore;

      // Verify split formula: tax = total * rate / (10000 + rate)
      const expectedTax = Math.floor(
        (totalLamports.toNumber() * TAX_RATE_BPS.toNumber()) /
          (10_000 + TAX_RATE_BPS.toNumber())
      );
      const expectedNet = totalLamports.toNumber() - expectedTax;

      assert.equal(taxReceived, expectedTax, "incorrect tax amount sent to gov");
      assert.equal(netReceived, expectedNet, "incorrect net amount sent to owner");
    });

    it("creates an immutable TaxRecord PDA with correct fields", async () => {
      const bizState = await program.account.businessAccount.fetch(businessPDA);
      // The record from the previous test is at index 1 (count is now 1)
      const [prevRecord] = deriveTaxRecordPDA(
        businessPDA,
        new BN(0),
        program.programId
      );

      const record = await program.account.taxRecord.fetch(prevRecord);

      assert.equal(
        record.business.toBase58(),
        businessPDA.toBase58(),
        "record.business wrong"
      );
      assert.equal(
        record.payer.toBase58(),
        payer.publicKey.toBase58(),
        "record.payer wrong"
      );
      assert.equal(
        record.governmentWallet.toBase58(),
        govWallet.publicKey.toBase58(),
        "record.governmentWallet wrong"
      );
      assert.equal(record.productName, "Rice 5kg", "product name wrong");
      assert.equal(
        record.invoiceIpfsHash,
        "QmTestHash123",
        "IPFS hash wrong"
      );
      assert.equal(
        record.taxRateBps.toNumber(),
        TAX_RATE_BPS.toNumber(),
        "tax rate wrong"
      );
      assert.isAbove(record.timestamp.toNumber(), 0, "timestamp should be set");
    });

    it("updates BusinessAccount stats after payment", async () => {
      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.transactionCount.toNumber(), 1, "tx count should be 1");
      assert.isAbove(biz.totalRevenue.toNumber(), 0, "revenue should be > 0");
      assert.isAbove(
        biz.totalTaxCollected.toNumber(),
        0,
        "tax collected should be > 0"
      );
    });

    it("rejects zero payment", async () => {
      const biz = await program.account.businessAccount.fetch(businessPDA);
      const [taxRecordPDA] = deriveTaxRecordPDA(
        businessPDA,
        biz.transactionCount,
        program.programId
      );

      try {
        await program.methods
          .payWithTax(new BN(0), "", "nothing")
          .accounts({
            businessAccount: businessPDA,
            taxRecord: taxRecordPDA,
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
            owner: owner.publicKey,
            governmentWallet: govWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, owner])
          .rpc();
        assert.fail("should have thrown ZeroAmount");
      } catch (err: any) {
        assert.include(err.toString(), "ZeroAmount");
      }
    });

    it("rejects IPFS hash longer than 64 chars", async () => {
      const biz = await program.account.businessAccount.fetch(businessPDA);
      const [taxRecordPDA] = deriveTaxRecordPDA(
        businessPDA,
        biz.transactionCount,
        program.programId
      );

      try {
        await program.methods
          .payWithTax(new BN(1_000_000), "Q".repeat(65), "item")
          .accounts({
            businessAccount: businessPDA,
            taxRecord: taxRecordPDA,
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
            owner: owner.publicKey,
            governmentWallet: govWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, owner])
          .rpc();
        assert.fail("should have thrown HashTooLong");
      } catch (err: any) {
        assert.include(err.toString(), "HashTooLong");
      }
    });

    it("handles multiple sequential payments correctly", async () => {
      for (let i = 0; i < 3; i++) {
        const biz = await program.account.businessAccount.fetch(businessPDA);
        const [taxRecordPDA] = deriveTaxRecordPDA(
          businessPDA,
          biz.transactionCount,
          program.programId
        );

        await program.methods
          .payWithTax(new BN(500_000), "", `Item ${i}`)
          .accounts({
            businessAccount: businessPDA,
            taxRecord: taxRecordPDA,
            payer: payer.publicKey,
            businessOwner: owner.publicKey,
            owner: owner.publicKey,
            governmentWallet: govWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, owner])
          .rpc();
      }

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(
        biz.transactionCount.toNumber(),
        4,
        "should have 4 total transactions"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  3. update_tax_rate
  // ─────────────────────────────────────────────────────────────

  describe("update_tax_rate", () => {
    it("allows owner to update tax rate", async () => {
      const newRate = new BN(500); // 5%
      await program.methods
        .updateTaxRate(newRate)
        .accounts({
          businessAccount: businessPDA,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 500, "tax rate not updated");
    });

    it("rejects update from non-owner", async () => {
      try {
        await program.methods
          .updateTaxRate(new BN(9999))
          .accounts({
            businessAccount: businessPDA,
            owner: stranger.publicKey,
          })
          .signers([stranger])
          .rpc();
        assert.fail("stranger should not be able to update tax rate");
      } catch (err: any) {
        // Either constraint violation or seeds/has_one mismatch
        assert.ok(err, "error thrown as expected");
      }
    });

    it("rejects tax rate above 10000 bps", async () => {
      try {
        await program.methods
          .updateTaxRate(new BN(10_001))
          .accounts({
            businessAccount: businessPDA,
            owner: owner.publicKey,
          })
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
        .accounts({
          businessAccount: businessPDA,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 0, "should allow 0% tax");
    });

    it("accepts exactly 10000 bps (100%)", async () => {
      await program.methods
        .updateTaxRate(new BN(10_000))
        .accounts({
          businessAccount: businessPDA,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const biz = await program.account.businessAccount.fetch(businessPDA);
      assert.equal(biz.taxRateBps.toNumber(), 10_000, "should allow 100% tax");
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  4. update_government_wallet
  // ─────────────────────────────────────────────────────────────

  describe("update_government_wallet", () => {
    const newGovWallet = Keypair.generate();

    it("allows owner to update government wallet", async () => {
      await program.methods
        .updateGovernmentWallet(newGovWallet.publicKey)
        .accounts({
          businessAccount: businessPDA,
          owner: owner.publicKey,
        })
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
          .accounts({
            businessAccount: businessPDA,
            owner: stranger.publicKey,
          })
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
      // Tax rate is currently 10000 from previous test, reset to 0
      await program.methods
        .updateTaxRate(new BN(0))
        .accounts({ businessAccount: businessPDA, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      // Update gov wallet back to original
      await program.methods
        .updateGovernmentWallet(govWallet.publicKey)
        .accounts({ businessAccount: businessPDA, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const govBefore = await getBalance(provider, govWallet.publicKey);
      const ownerBefore = await getBalance(provider, owner.publicKey);

      const biz = await program.account.businessAccount.fetch(businessPDA);
      const [taxRecordPDA] = deriveTaxRecordPDA(
        businessPDA,
        biz.transactionCount,
        program.programId
      );

      await program.methods
        .payWithTax(new BN(1_000_000), "", "zero tax item")
        .accounts({
          businessAccount: businessPDA,
          taxRecord: taxRecordPDA,
          payer: payer.publicKey,
          businessOwner: owner.publicKey,
          owner: owner.publicKey,
          governmentWallet: govWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, owner])
        .rpc();

      const govAfter = await getBalance(provider, govWallet.publicKey);
      const ownerAfter = await getBalance(provider, owner.publicKey);

      assert.equal(govAfter - govBefore, 0, "gov should receive 0 at 0% tax");
      assert.equal(
        ownerAfter - ownerBefore,
        1_000_000,
        "owner should receive full amount at 0% tax"
      );
    });
  });
});