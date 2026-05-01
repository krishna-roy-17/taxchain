import express from "express";
import cors from "cors";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js"; // ✅ Add this line
import { PublicKey, Connection } from "@solana/web3.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const idl = require("../taxpay-vite/src/idl/taxpay.json");

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// ✅ Bypass ngrok warning page
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "69420");
  next();
});

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const PROGRAM_ID = new PublicKey("7rCpefks9mQwx9TLnuNbjV6j4dSDYpFpBg6tNw6TJ4Yp");
const BUSINESS_SEED = "business";

// ✅ GET — label/icon for both routes
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

// ✅ Shared transaction builder
async function buildTx(account, business, amount, product, ipfs) {
  const customerPubkey = new PublicKey(account);
  const businessPubkey = new PublicKey(business);
  const lamports       = Math.floor(parseFloat(amount) * 1_000_000_000);

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

  const tx = await program.methods
    .payWithTax(
      new BN(lamports),
      (ipfs || "").toString().slice(0, 64),
      decodeURIComponent(product || "Purchase").slice(0, 64)
    )
    .accounts({
      payer: customerPubkey,
      businessOwner: businessPubkey,
    })
    .transaction();

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = customerPubkey;

  return tx;
}

// ✅ POST with path params: /api/pay/:business/:amount/:product
// Phantom preserves path params even when query strings are stripped
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

    const tx = await buildTx(account, business, amount, product, ipfs);
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    console.log("✅ Transaction built successfully");
    res.json({
      transaction: serialized.toString("base64"),
      message: `Pay ${amount} SOL for ${decodeURIComponent(product)} (tax auto-split)`,
    });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST with query params fallback
app.post("/api/pay", async (req, res) => {
  try {
    const { account } = req.body;
    const { business, amount, product, ipfs } = req.query;

    console.log("📥 POST /api/pay (query params):");
    console.log("  account:", account);
    console.log("  business:", business);
    console.log("  amount:", amount);
    console.log("  product:", product);
    console.log("  Full query:", req.query);

    if (!account || !business || !amount) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const tx = await buildTx(account, business, amount, product, ipfs);
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    console.log("✅ Transaction built successfully");
    res.json({
      transaction: serialized.toString("base64"),
      message: `Pay ${amount} SOL for ${product} (tax auto-split)`,
    });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, "0.0.0.0", () => {
  console.log("✅ TaxPay API running on http://0.0.0.0:3001");
});