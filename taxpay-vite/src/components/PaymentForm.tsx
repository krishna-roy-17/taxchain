import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { QRCodeSVG } from "qrcode.react";
import { useProgram } from "../hooks/useProgram";
import {
  calcTaxSplit,
  lamportsToSol,
  solToLamports,
} from "../utils/constants";
import { mintNFTReceipt } from "../utils/nftReceipt";

type Step = "idle" | "paying" | "minting" | "done";

export function PaymentForm() {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { payWithTax, fetchBusiness } = useProgram();

  const [mode, setMode] = useState<"create" | "pay">("pay");
  const [productName, setProductName] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [businessOwnerAddr, setBizAddr] = useState("");
  const [ipfsHash, setIpfsHash] = useState("");

  const [businessInfo, setBusinessInfo] = useState<any>(null);
  const [loadingBiz, setLoadingBiz] = useState(false);
  const [myBusinessInfo, setMyBusinessInfo] = useState<any>(null);
  const [checkingMyBiz, setCheckingMyBiz] = useState(false);
  const isBusiness = !!myBusinessInfo;

  const [step, setStep] = useState<Step>("idle");
  const [mintNFT, setMintNFT] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    tx: string;
    taxAmount: number;
    netAmount: number;
    nftMint?: string;
    nftUrl?: string;
  } | null>(null);

  const [qrData, setQrData] = useState("");
  const [qrPending, setQrPending] = useState(false);
  const [qrPollingSeconds, setQrPollingSeconds] = useState(0);

  const submittingRef = useRef(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lamports = solToLamports(parseFloat(amountSol) || 0);
  const taxRateBps = businessInfo?.taxRateBps?.toNumber() || 1300;
  const split = calcTaxSplit(lamports, taxRateBps);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setQrPending(false);
    setQrPollingSeconds(0);
  }, []);

  const startQrPolling = useCallback(() => {
    if (!businessOwnerAddr || !productName || !amountSol) return;
    if (pollingIntervalRef.current) return;

    setQrPending(true);
    setQrPollingSeconds(0);

    countdownRef.current = setInterval(() => {
      setQrPollingSeconds((s) => s + 1);
    }, 1000);

    const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const amount = parseFloat(amountSol).toFixed(9).replace(/\.?0+$/, "");
    const product = encodeURIComponent(productName.slice(0, 64));
    const statusUrl = `${apiBase}/api/pay/status/${businessOwnerAddr.trim()}/${amount}/${product}`;

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(statusUrl, {
          headers: { "ngrok-skip-browser-warning": "69420" },
        });
        const data = await res.json();
        if (data.confirmed && data.tx) {
          stopPolling();
          const s = calcTaxSplit(lamports, taxRateBps);
          setResult({
            tx: data.tx,
            taxAmount: data.taxAmount ?? s.taxAmount,
            netAmount: data.netAmount ?? s.netAmount,
          });
        }
      } catch (e) {
        console.warn("Poll error:", e);
      }
    }, 3000);
  }, [businessOwnerAddr, productName, amountSol, lamports, taxRateBps, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (!productName || !amountSol || !businessOwnerAddr) stopPolling();
  }, [productName, amountSol, businessOwnerAddr, stopPolling]);

  useEffect(() => {
    if (qrData && mode === "create") {
      stopPolling();
      const t = setTimeout(() => startQrPolling(), 100);
      return () => clearTimeout(t);
    } else {
      stopPolling();
    }
  }, [qrData, mode]); // eslint-disable-line

  useEffect(() => {
    if (!publicKey || !fetchBusiness) {
      setMyBusinessInfo(null);
      return;
    }
    const check = async () => {
      setCheckingMyBiz(true);
      try {
        const res = await fetchBusiness(publicKey);
        setMyBusinessInfo(res?.account ?? null);
      } catch {
        setMyBusinessInfo(null);
      } finally {
        setCheckingMyBiz(false);
      }
    };
    check();
  }, [publicKey]);

  useEffect(() => {
    if (!isBusiness) setMode("pay");
  }, [isBusiness]);

  useEffect(() => {
    if (mode === "create" && publicKey) {
      setBizAddr(publicKey.toBase58());
    } else if (mode === "pay") {
      setBizAddr("");
      setBusinessInfo(null);
    }
  }, [mode, publicKey]);

  useEffect(() => {
    if (!businessOwnerAddr) return;
    const go = async () => {
      setLoadingBiz(true);
      try {
        const pk = new PublicKey(businessOwnerAddr.trim());
        const res = await fetchBusiness(pk);
        setBusinessInfo(res ? res.account : null);
      } catch {
        setBusinessInfo(null);
      } finally {
        setLoadingBiz(false);
      }
    };
    go();
  }, [businessOwnerAddr]);

  useEffect(() => {
    if (productName && amountSol && businessOwnerAddr) {
      try {
        new PublicKey(businessOwnerAddr.trim());
        const amount = parseFloat(amountSol);
        if (amount > 0) {
          const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";
          const amtStr = amount.toFixed(9).replace(/\.?0+$/, "");
          const prodEnc = encodeURIComponent(productName.slice(0, 64));
          const apiUrl = `${apiBase}/api/pay/${businessOwnerAddr.trim()}/${amtStr}/${prodEnc}`;
          setQrData(`solana:${apiUrl}`);
        } else {
          setQrData("");
        }
      } catch {
        setQrData("");
      }
    } else {
      setQrData("");
    }
  }, [productName, amountSol, businessOwnerAddr, ipfsHash]);

  const handlePay = async () => {
    if (submittingRef.current || step !== "idle") return;
    setError("");
    setResult(null);
    setStep("paying");
    submittingRef.current = true;

    try {
      let ownerPK: PublicKey;
      try {
        ownerPK = new PublicKey(businessOwnerAddr.trim());
      } catch {
        throw new Error("Invalid business owner address");
      }
      if (lamports <= 0) throw new Error("Amount must be greater than 0");
      if (!productName) throw new Error("Product name is required");

      console.log("⚡ Processing payment...");
      const { tx, split: s, taxRecordPDA } = await payWithTax(
        ownerPK,
        lamports,
        productName,
        ipfsHash
      );
      console.log("✅ Payment tx:", tx);

      const bizData = await fetchBusiness(ownerPK);
      const receiptNumber = bizData?.account.transactionCount.toNumber() || 1;

      let nftMint: string | undefined;
      let nftUrl: string | undefined;

      if (mintNFT) {
        setStep("minting");
        console.log("🧾 Minting NFT receipt...");
        try {
          const nftResult = await mintNFTReceipt({
            wallet,
            receiptNumber,
            businessName: bizData?.account.name || "Unknown Business",
            productName,
            totalLamports: lamports,
            taxLamports: s.taxAmount,
            netLamports: s.netAmount,
            taxRateBps: bizData?.account.taxRateBps.toNumber() || 1300,
            timestamp: Math.floor(Date.now() / 1000),
            txRecordPDA: taxRecordPDA.toBase58(),
            txSignature: tx,
            payerWallet: publicKey!.toBase58(),
            businessWallet: ownerPK.toBase58(),
            govWallet: bizData?.account.governmentWallet.toBase58() || "",
          });
          nftMint = nftResult.mintAddress;
          nftUrl = nftResult.explorerUrl;
          console.log("✅ NFT minted:", nftMint);
        } catch (nftErr: any) {
          console.error("NFT minting failed (payment ok):", nftErr);
        }
      }

      setStep("done");
      setResult({
        tx,
        taxAmount: s.taxAmount,
        netAmount: s.netAmount,
        nftMint,
        nftUrl,
      });
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
      setStep("idle");
    } finally {
      submittingRef.current = false;
    }
  };

  // ── SUCCESS SCREEN ────────────────────────────────────────
  if (result) {
    return (
      <PageWrapper>
        <div
          className="card animate-slide-up"
          style={{ maxWidth: 580, margin: "0 auto" }}
        >
          {/* Success banner */}
          <div
            style={{
              background: "var(--green-dim)",
              border: "1px solid var(--green)",
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>
              Payment Complete!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
              {result.nftMint
                ? "Tax split + NFT receipt minted successfully"
                : "Tax automatically split in one transaction"}
            </p>
          </div>

          {/* Product summary */}
          {(productName || amountSol) && (
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}
                >
                  PRODUCT / SERVICE
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {productName || "—"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}
                >
                  TOTAL PAID
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {amountSol} SOL
                </div>
              </div>
            </div>
          )}

          {/* Split cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <SplitCard
              icon="💰"
              label="Business Received"
              amount={`${lamportsToSol(result.netAmount).toFixed(6)} SOL`}
              color="var(--accent)"
            />
            <SplitCard
              icon="🏛"
              label="Tax (Government)"
              amount={`${lamportsToSol(result.taxAmount).toFixed(6)} SOL`}
              color="var(--yellow)"
            />
          </div>

          {/* NFT result */}
          {result.nftMint ? (
            <div
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-dim), rgba(0,229,160,0.06))",
                border: "1px solid var(--accent)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  background: "var(--accent-dim)",
                  border: "1px solid var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  flexShrink: 0,
                }}
              >
                🧾
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 14,
                    color: "var(--accent-2)",
                    marginBottom: 4,
                  }}
                >
                  NFT Receipt Minted! 🎉
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    wordBreak: "break-all",
                    marginBottom: 4,
                  }}
                >
                  {result.nftMint}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  Open Phantom → Collectibles tab to view
                </div>
              </div>
              <a
                href={result.nftUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ padding: "7px 12px", fontSize: 12, flexShrink: 0 }}
              >
                View NFT
              </a>
            </div>
          ) : mintNFT ? (
            <div
              style={{
                background: "var(--yellow-dim)",
                border: "1px solid var(--yellow)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 12,
                color: "var(--yellow)",
              }}
            >
              ⚠ NFT minting failed but payment succeeded.
            </div>
          ) : null}

          {/* Tx signature */}
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 16,
              wordBreak: "break-all",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                marginBottom: 4,
              }}
            >
              TRANSACTION SIGNATURE
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
              {result.tx}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={`https://explorer.solana.com/tx/${result.tx}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ flex: 1, justifyContent: "center" }}
            >
              🔍 Explorer
            </a>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => {
                setResult(null);
                setStep("idle");
                setProductName("");
                setAmountSol("");
                setIpfsHash("");
                stopPolling();
              }}
            >
              New Payment
            </button>
          </div>
        </div>
      </PageWrapper>
    );
  }

  // ── MAIN FORM ─────────────────────────────────────────────
  return (
    <PageWrapper>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Payment with Auto Tax Split
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Every payment automatically splits: net → business, tax → government.
            One transaction, immutable record.
          </p>
        </div>

        {/* Mode toggle */}
        {checkingMyBiz ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            Checking wallet registration...
          </div>
        ) : isBusiness ? (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "var(--green-dim)",
                border: "1px solid var(--green)",
                borderRadius: 8,
                padding: "6px 14px",
                marginBottom: 14,
                fontSize: 13,
                color: "var(--green)",
                fontWeight: 700,
              }}
            >
              ✓ Registered Business · {myBusinessInfo.name}
            </div>
            <div
              style={{
                display: "flex",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 4,
                width: "fit-content",
              }}
            >
              {(["create", "pay"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    stopPolling();
                  }}
                  style={{
                    background: mode === m ? "var(--accent)" : "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 22px",
                    color: mode === m ? "white" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 14,
                    transition: "all 0.2s",
                  }}
                >
                  {m === "create" ? "🧾 Create Invoice" : "⚡ Pay Invoice"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          publicKey && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(99,179,237,0.08)",
                border: "1px solid rgba(99,179,237,0.25)",
                borderRadius: 8,
                padding: "6px 14px",
                marginBottom: 20,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              ℹ️ Not a registered business — you can pay any business below.&nbsp;
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                Go to Setup to register.
              </span>
            </div>
          )
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
          {/* ── LEFT: Form ── */}
          <div className="card">
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Business address */}
              <div>
                <label style={labelStyle}>
                  {mode === "create" ? "Your Business Address" : "Business Owner Address"} *
                </label>
                <input
                  className="input mono-input"
                  placeholder="Business wallet public key"
                  value={businessOwnerAddr}
                  onChange={(e) => setBizAddr(e.target.value)}
                  readOnly={mode === "create"}
                  style={mode === "create" ? { opacity: 0.7, cursor: "not-allowed" } : {}}
                />
                {mode === "create" && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Auto-filled with your registered business wallet
                  </div>
                )}
                {mode === "pay" && loadingBiz && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Looking up business...
                  </div>
                )}
                {mode === "pay" && businessInfo && !loadingBiz && (
                  <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>
                    ✓ {businessInfo.name} · {businessInfo.taxRateBps.toNumber() / 100}% tax
                  </div>
                )}
                {mode === "pay" &&
                  !businessInfo &&
                  !loadingBiz &&
                  businessOwnerAddr.length > 30 && (
                    <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>
                      ✗ No registered business at this address
                    </div>
                  )}
              </div>

              {/* Product */}
              <div>
                <label style={labelStyle}>Product / Service *</label>
                <input
                  className="input"
                  placeholder="e.g. Momo Set"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  maxLength={64}
                />
              </div>

              {/* Amount */}
              <div>
                <label style={labelStyle}>Total Amount (SOL) *</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="e.g. 0.01"
                  value={amountSol}
                  onChange={(e) => setAmountSol(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Total {mode === "create" ? "customer" : "you"} pays (tax included)
                </div>
              </div>

              {/* IPFS */}
              <div>
                <label style={labelStyle}>
                  Invoice IPFS Hash{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (optional)
                  </span>
                </label>
                <input
                  className="input mono-input"
                  placeholder="Qm... upload to Pinata first"
                  value={ipfsHash}
                  onChange={(e) => setIpfsHash(e.target.value)}
                  maxLength={64}
                />
              </div>

              {/* NFT toggle — pay mode only */}
              {mode === "pay" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "12px 16px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                      🧾 Mint NFT Receipt
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Get NFT proof of payment in your Phantom wallet
                    </div>
                  </div>
                  <div
                    onClick={() => setMintNFT((v) => !v)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      background: mintNFT ? "var(--accent)" : "var(--border)",
                      cursor: "pointer",
                      position: "relative",
                      transition: "background 0.2s",
                      flexShrink: 0,
                      marginLeft: 16,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 3,
                        left: mintNFT ? 23 : 3,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "white",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Info box */}
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                {mode === "create" ? (
                  <>
                    <div
                      style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}
                    >
                      💡 Two ways customers can pay:
                    </div>
                    <div>
                      📱 <strong>QR Code</strong> → Customer scans with Phantom → Smart
                      contract runs automatically
                    </div>
                    <div style={{ marginTop: 4 }}>
                      ⚡ <strong>Pay button</strong> → Your connected wallet pays directly
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}
                    >
                      💡 How paying works:
                    </div>
                    <div>⚡ Enter the business wallet address, fill amount, click Pay.</div>
                    <div style={{ marginTop: 4 }}>
                      🏛 Tax automatically split to government via smart contract.
                    </div>
                  </>
                )}
              </div>

              {/* Error */}
              {error && (
                <div
                  style={{
                    background: "var(--red-dim)",
                    border: "1px solid var(--red)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    color: "var(--red)",
                    fontSize: 13,
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              {/* Pay button */}
              {!publicKey ? (
                <div
                  style={{
                    background: "var(--yellow-dim)",
                    border: "1px solid var(--yellow)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    color: "var(--yellow)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Connect your wallet to pay
                </div>
              ) : (
                <button
                  className="btn btn-green"
                  style={{ padding: "15px", fontSize: 15 }}
                  onClick={handlePay}
                  disabled={
                    step !== "idle" || !productName || !amountSol || !businessOwnerAddr
                  }
                >
                  {step === "paying" && (
                    <>
                      <span className="spinner" /> Processing Payment...
                    </>
                  )}
                  {step === "minting" && (
                    <>
                      <span className="spinner" /> Minting NFT Receipt...
                    </>
                  )}
                  {step === "idle" &&
                    (mode === "create"
                      ? `⚡ Pay ${amountSol || "0"} SOL → Smart Contract`
                      : `⚡ Send ${amountSol || "0"} SOL to Business`)}
                </button>
              )}

              {/* Step indicator — pay mode only */}
              {(step === "paying" || step === "minting") && mintNFT && mode === "pay" && (
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <StepDot
                    active={step === "paying"}
                    done={step === "minting"}
                    label="1. Payment"
                  />
                  <StepLine done={step === "minting"} />
                  <StepDot active={step === "minting"} done={false} label="2. NFT Receipt" />
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Preview + QR ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Tax split preview */}
            <div className="card">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  letterSpacing: "0.06em",
                  marginBottom: 14,
                }}
              >
                PAYMENT SPLIT PREVIEW
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <SplitRow
                  label="Total (customer pays)"
                  value={`${lamportsToSol(lamports).toFixed(6)} SOL`}
                  color="var(--text-primary)"
                  bold
                />
                <div style={{ height: 1, background: "var(--border)" }} />
                <SplitRow
                  label="→ Business (net)"
                  value={`${lamportsToSol(split.netAmount).toFixed(6)} SOL`}
                  color="var(--accent)"
                  icon="💰"
                />
                <SplitRow
                  label={`→ Gov. Tax (${taxRateBps / 100}%)`}
                  value={`${lamportsToSol(split.taxAmount).toFixed(6)} SOL`}
                  color="var(--yellow)"
                  icon="🏛"
                />
              </div>

              {lamports > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 999,
                      background: "var(--border)",
                      overflow: "hidden",
                      display: "flex",
                    }}
                  >
                    <div
                      style={{
                        width: `${(split.netAmount / lamports) * 100}%`,
                        background: "var(--accent)",
                        borderRadius: "999px 0 0 999px",
                        transition: "width 0.3s",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        background: "var(--yellow)",
                        borderRadius: "0 999px 999px 0",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      marginTop: 4,
                      color: "var(--text-muted)",
                    }}
                  >
                    <span>Business {(100 - taxRateBps / 100).toFixed(1)}%</span>
                    <span>Tax {(taxRateBps / 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* NFT preview card — pay mode only */}
            {mintNFT && mode === "pay" && (
              <div className="card" style={{ padding: 20 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    letterSpacing: "0.06em",
                    marginBottom: 12,
                  }}
                >
                  NFT RECEIPT PREVIEW
                </div>
                <div
                  style={{
                    background: "linear-gradient(135deg, #0d0d14, #141420)",
                    border: "1px solid var(--accent)",
                    borderRadius: 12,
                    padding: 16,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>🧾</div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                      color: "var(--accent-2)",
                      marginBottom: 10,
                    }}
                  >
                    TaxChain Receipt
                  </div>
                  {[
                    { k: "Business", v: businessInfo?.name || "—" },
                    { k: "Product", v: productName || "—" },
                    { k: "Total", v: amountSol ? `${amountSol} SOL` : "—" },
                    {
                      k: "Tax",
                      v:
                        lamports > 0
                          ? `${lamportsToSol(split.taxAmount).toFixed(4)} SOL`
                          : "—",
                    },
                    { k: "Network", v: "Solana Devnet" },
                    { k: "Verified", v: "✅ On-chain" },
                  ].map((row) => (
                    <div
                      key={row.k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "5px 0",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>{row.k}</span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          fontFamily:
                            row.k === "Total" || row.k === "Tax"
                              ? "var(--font-mono)"
                              : "inherit",
                        }}
                      >
                        {row.v}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      marginTop: 10,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Minted to your Phantom wallet
                  </div>
                </div>
              </div>
            )}

            {/* QR code — create mode only */}
            {mode === "create" && qrData && (
              <div className="card" style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  PAYMENT QR CODE
                </div>

                {!import.meta.env.VITE_API_URL && (
                  <div
                    style={{
                      background: "var(--yellow-dim)",
                      border: "1px solid var(--yellow)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "var(--yellow)",
                      marginBottom: 10,
                      textAlign: "left",
                    }}
                  >
                    ⚠ Set VITE_API_URL in .env to enable QR payments
                  </div>
                )}

                <div
                  style={{
                    display: "inline-block",
                    padding: 12,
                    background: "white",
                    borderRadius: 8,
                  }}
                >
                  <QRCodeSVG value={qrData} size={160} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    📱 Customer scans with <strong>Phantom app</strong>
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
                    Tax splits automatically via smart contract
                  </p>
                </div>

                <div style={{ marginTop: 12 }}>
                  {qrPending ? (
                    <>
                      <div
                        style={{
                          height: 3,
                          borderRadius: 999,
                          background: "var(--border)",
                          overflow: "hidden",
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: "40%",
                            background: "var(--yellow)",
                            borderRadius: 999,
                            animation: "qr-scan-pulse 1.5s ease-in-out infinite",
                          }}
                        />
                      </div>
                      <style>{`
                        @keyframes qr-scan-pulse {
                          0%   { transform: translateX(-100%); }
                          100% { transform: translateX(350%); }
                        }
                      `}</style>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          color: "var(--yellow)",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        <span
                          className="spinner"
                          style={{ width: 13, height: 13, borderWidth: 2 }}
                        />
                        Waiting for payment · {qrPollingSeconds}s
                      </div>
                      <button
                        onClick={stopPolling}
                        style={{
                          marginTop: 8,
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          fontSize: 11,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-secondary"
                      style={{ width: "100%", fontSize: 13, padding: "10px" }}
                      onClick={startQrPolling}
                      disabled={!productName || !amountSol || !businessOwnerAddr}
                    >
                      👀 Resume waiting for payment
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function SplitCard({
  icon,
  label,
  amount,
  color,
}: {
  icon: string;
  label: string;
  amount: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: `1px solid ${color}44`,
        borderRadius: 10,
        padding: 14,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 26, marginBottom: 5 }}>{icon}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color, fontFamily: "var(--font-mono)" }}>
        {amount}
      </div>
    </div>
  );
}

function SplitRow({
  label,
  value,
  color,
  icon,
  bold,
}: {
  label: string;
  value: string;
  color: string;
  icon?: string;
  bold?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color,
          fontWeight: bold ? 800 : 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  const color = done ? "var(--green)" : active ? "var(--accent)" : "var(--border)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "white",
          fontWeight: 800,
          transition: "all 0.3s",
        }}
      >
        {done ? "✓" : active ? "●" : "○"}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
        {label}
      </div>
    </div>
  );
}

function StepLine({ done }: { done: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        height: 2,
        marginTop: 10,
        background: done ? "var(--green)" : "var(--border)",
        transition: "background 0.3s",
      }}
    />
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};