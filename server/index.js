import express from "express";
import cors from "cors";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Connection, TransactionInstruction } from "@solana/web3.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../taxpay-vite/src/idl/taxpay.json");

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// Bypass ngrok warning page
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "69420");
  next();
});

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const PROGRAM_ID = new PublicKey("7rCpefks9mQwx9TLnuNbjV6j4dSDYpFpBg6tNw6TJ4Yp");
const BUSINESS_SEED = "business";

// Solana Memo program — makes Phantom show product info in tx approval screen
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// ─── In-memory payment store ───────────────────────────────────────────────
// key: `${business}:${amount}:${product}`  →  { tx, taxAmount, netAmount, timestamp }
const confirmedPayments = new Map();
const PAYMENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function paymentKey(business, amount, product) {
  return `${business}:${amount}:${decodeURIComponent(product)}`;
}

// ─── GET label/icon ────────────────────────────────────────────────────────
app.get("/api/pay", (req, res) => {
  res.json({
    label: "TaxPay — Auto Tax Split",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Bitcoin_Cash_logo.svg/1200px-Bitcoin_Cash_logo.svg.png",
  });
});

app.get("/api/pay/:business/:amount/:product", (req, res) => {
  res.json({
    label: "TaxPay — Auto Tax Split",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Bitcoin_Cash_logo.svg/1200px-Bitcoin_Cash_logo.svg.png",
  });
});

// ─── GET payment status (polled by frontend after QR scan) ─────────────────
// GET /api/pay/status/:business/:amount/:product
app.get("/api/pay/status/:business/:amount/:product", (req, res) => {
  const { business, amount, product } = req.params;
  const key = paymentKey(business, amount, product);
  const entry = confirmedPayments.get(key);

  console.log(`📊 Status check: ${key}`);

  if (entry && Date.now() - entry.timestamp < PAYMENT_TTL_MS) {
    console.log(`✅ Payment confirmed: ${entry.tx}`);
    return res.json({
      confirmed: true,
      tx: entry.tx,
      taxAmount: entry.taxAmount,
      netAmount: entry.netAmount,
    });
  }

  return res.json({ confirmed: false });
});

// ─── Shared transaction builder ─────────────────────────────────────────────
async function buildTx(account, business, amount, product, ipfs) {
  const customerPubkey = new PublicKey(account);
  const businessPubkey = new PublicKey(business);
  const lamports = Math.floor(parseFloat(amount) * 1_000_000_000);

  const [businessPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(BUSINESS_SEED), businessPubkey.toBuffer()],
    PROGRAM_ID
  );

  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: customerPubkey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);

  const businessData = await program.account.businessAccount.fetch(businessPDA);
  console.log("✅ Business found:", businessData.name);

  const productDecoded = decodeURIComponent(product || "Purchase").slice(0, 64);
  const amountDisplay = parseFloat(amount).toFixed(4);

  const tx = await program.methods
    .payWithTax(
      new BN(lamports),
      (ipfs || "").toString().slice(0, 64),
      productDecoded
    )
    .accounts({
      payer: customerPubkey,
      businessOwner: businessPubkey,
    })
    .transaction();

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = customerPubkey;

  // ── Memo instruction: Phantom Mobile reads this and displays it
  //    on the transaction approval screen so customers see what they're paying for
  const memoText = `${productDecoded} | ${amountDisplay} SOL (tax incl.) | ${businessData.name}`;
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, "utf-8"),
    })
  );

  return { tx, lamports, businessData, productDecoded, amountDisplay };
}

// ─── Helper: calculate tax split (mirrors frontend logic) ───────────────────
function calcSplit(lamports, taxRateBps) {
  const taxAmount = Math.floor((lamports * taxRateBps) / 10000);
  const netAmount = lamports - taxAmount;
  return { taxAmount, netAmount };
}

// ─── POST with path params: /api/pay/:business/:amount/:product ─────────────
app.post("/api/pay/:business/:amount/:product", async (req, res) => {
  try {
    const { account } = req.body;
    const { business, amount, product } = req.params;
    const ipfs = req.query.ipfs || "";

    console.log("📥 POST /api/pay (path params):");
    console.log("  account:", account);
    console.log("  business:", business);
    console.log("  amount:", amount);
    console.log("  product:", product);

    if (!account || !business || !amount) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const { tx, lamports, businessData, productDecoded, amountDisplay } =
      await buildTx(account, business, amount, product, ipfs);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const key = paymentKey(business, amount, product);
    const taxRateBps = businessData.taxRateBps?.toNumber?.() ?? 1300;
    const split = calcSplit(lamports, taxRateBps);

    pollForConfirmation(key, business, lamports, split).catch((e) =>
      console.error("Poll error:", e.message)
    );

    console.log("✅ Transaction built successfully");

    // The `message` field is shown by Phantom Mobile as the transaction description
    res.json({
      transaction: serialized.toString("base64"),
      message: `${productDecoded} — ${amountDisplay} SOL (tax included)`,
    });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST with query params fallback ────────────────────────────────────────
app.post("/api/pay", async (req, res) => {
  try {
    const { account } = req.body;
    const { business, amount, product, ipfs } = req.query;

    console.log("📥 POST /api/pay (query params):");
    console.log("  account:", account);
    console.log("  business:", business);
    console.log("  amount:", amount);
    console.log("  product:", product);

    if (!account || !business || !amount) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const { tx, lamports, businessData, productDecoded, amountDisplay } =
      await buildTx(account, business, amount, product, ipfs);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const key = paymentKey(business, amount, product);
    const taxRateBps = businessData.taxRateBps?.toNumber?.() ?? 1300;
    const split = calcSplit(lamports, taxRateBps);

    pollForConfirmation(key, business, lamports, split).catch((e) =>
      console.error("Poll error:", e.message)
    );

    console.log("✅ Transaction built successfully");

    res.json({
      transaction: serialized.toString("base64"),
      message: `${productDecoded} — ${amountDisplay} SOL (tax included)`,
    });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Background: poll chain until we see a new tx on the business wallet ────
async function pollForConfirmation(key, business, lamports, split) {
  const businessPubkey = new PublicKey(business);
  const start = Date.now();
  const TIMEOUT = 3 * 60 * 1000; // 3 minutes max
  const INTERVAL = 4000;          // check every 4 seconds

  // Grab the signature tip BEFORE Phantom signs, so we only look at NEW txs
  let prevSig = null;
  try {
    const sigs = await connection.getSignaturesForAddress(businessPubkey, {
      limit: 1,
    });
    prevSig = sigs[0]?.signature ?? null;
  } catch {}

  console.log(`🔍 Polling chain for key: ${key}`);

  while (Date.now() - start < TIMEOUT) {
    await sleep(INTERVAL);
    try {
      const sigs = await connection.getSignaturesForAddress(businessPubkey, {
        limit: 5,
        until: prevSig ?? undefined,
      });

      for (const sigInfo of sigs) {
        if (sigInfo.err) continue; // skip failed txs

        // Found a new confirmed tx on this business wallet
        const tx = sigInfo.signature;
        console.log(`✅ Confirmed tx for ${key}: ${tx}`);

        confirmedPayments.set(key, {
          tx,
          taxAmount: split.taxAmount,
          netAmount: split.netAmount,
          timestamp: Date.now(),
        });

        // Clean up old entries
        for (const [k, v] of confirmedPayments.entries()) {
          if (Date.now() - v.timestamp > PAYMENT_TTL_MS) {
            confirmedPayments.delete(k);
          }
        }
        return; // done
      }
    } catch (e) {
      console.warn("Chain poll error:", e.message);
    }
  }

  console.warn(`⏰ Polling timed out for key: ${key}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(3001, "0.0.0.0", () => {
  console.log("✅ TaxPay API running on http://0.0.0.0:3001");
});