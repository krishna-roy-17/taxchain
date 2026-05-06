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

export function PaymentForm() {
  const { publicKey } = useWallet();
  const { payWithTax, fetchBusiness } = useProgram();

  const [mode, setMode] = useState<"create" | "pay">("pay");

  const [productName, setProductName] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [businessOwnerAddr, setBusinessOwnerAddr] = useState("");
  const [ipfsHash, setIpfsHash] = useState("");

  const [businessInfo, setBusinessInfo] = useState<any>(null);
  const [loadingBiz, setLoadingBiz] = useState(false);

  const [myBusinessInfo, setMyBusinessInfo] = useState<any>(null);
  const [checkingMyBiz, setCheckingMyBiz] = useState(false);
  const isBusiness = !!myBusinessInfo;

  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const [result, setResult] = useState<{
    tx: string;
    taxAmount: number;
    netAmount: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [qrData, setQrData] = useState("");

  // ── QR polling state ──
  const [qrPending, setQrPending] = useState(false);
  const [qrPollingSeconds, setQrPollingSeconds] = useState(0);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lamports = solToLamports(parseFloat(amountSol) || 0);
  const taxRateBps = businessInfo?.taxRateBps?.toNumber() || 1300;
  const split = calcTaxSplit(lamports, taxRateBps);

  // ── Stop QR polling ──
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

  // ── Start QR polling ──
  const startQrPolling = useCallback(() => {
    if (!businessOwnerAddr || !productName || !amountSol) return;
    if (pollingIntervalRef.current) return; // already polling

    setQrPending(true);
    setQrPollingSeconds(0);

    // Elapsed counter
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
        // Network hiccup — keep polling
        console.warn("Poll error:", e);
      }
    }, 3000);
  }, [businessOwnerAddr, productName, amountSol, lamports, taxRateBps, stopPolling]);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Stop polling if form is cleared
  useEffect(() => {
    if (!productName || !amountSol || !businessOwnerAddr) {
      stopPolling();
    }
  }, [productName, amountSol, businessOwnerAddr, stopPolling]);

  // ── AUTO-START polling whenever a valid QR is generated ──
  useEffect(() => {
    if (qrData && mode === "create") {
      // Reset and restart polling fresh whenever qrData changes
      stopPolling();
      // Small delay so stopPolling clears refs before startQrPolling checks them
      const t = setTimeout(() => startQrPolling(), 100);
      return () => clearTimeout(t);
    } else {
      stopPolling();
    }
  }, [qrData, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check if connected wallet is a registered business ──
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

  // Non-business wallets locked to pay mode
  useEffect(() => {
    if (!isBusiness) setMode("pay");
  }, [isBusiness]);

  // Auto-fill business address in create mode
  useEffect(() => {
    if (mode === "create" && publicKey) {
      setBusinessOwnerAddr(publicKey.toBase58());
    } else if (mode === "pay") {
      setBusinessOwnerAddr("");
      setBusinessInfo(null);
    }
  }, [mode, publicKey]);

  // Fetch business info for entered address
  useEffect(() => {
    if (!businessOwnerAddr) return;
    const fetchInfo = async () => {
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
    fetchInfo();
  }, [businessOwnerAddr]);

  // Build QR URL
  useEffect(() => {
    if (productName && amountSol && businessOwnerAddr) {
      try {
        new PublicKey(businessOwnerAddr.trim());
        const amount = parseFloat(amountSol);
        if (amount > 0) {
          const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";
          const amountStr = amount.toFixed(9).replace(/\.?0+$/, "");
          const productEncoded = encodeURIComponent(productName.slice(0, 64));
          const apiUrl = `${apiBase}/api/pay/${businessOwnerAddr.trim()}/${amountStr}/${productEncoded}`;
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

  // ── Direct pay handler ──
  const handlePay = async () => {
    if (submittingRef.current || loading) return;
    setError("");
    setLoading(true);
    submittingRef.current = true;

    try {
      let ownerPK: PublicKey;
      try {
        ownerPK = new PublicKey(businessOwnerAddr.trim());
      } catch {
        throw new Error("Invalid business owner address");
      }
      if (lamports <= 0) throw new Error("Amount must be greater than 0");

      const { tx, split: s } = await payWithTax(
        ownerPK,
        lamports,
        productName,
        ipfsHash
      );

      try {
        const updated = await fetchBusiness(ownerPK);
        if (updated) setBusinessInfo(updated.account);
      } catch {}

      setResult({ tx, taxAmount: s.taxAmount, netAmount: s.netAmount });
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // ── Success screen ─────────────────────────────────────────
  if (result) {
    return (
      <PageWrapper>
        <div
          className="card animate-slide-up"
          style={{ maxWidth: 580, margin: "0 auto" }}
        >
          <div
            style={{
              background: "var(--green-dim)",
              border: "1px solid var(--green)",
              borderRadius: 12,
              padding: 20,
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--green)" }}>
              Payment Complete!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
              Tax automatically split and sent in one transaction
            </p>
          </div>

          {/* Product & amount summary */}
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
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                  PRODUCT / SERVICE
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                  {productName || "—"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                  TOTAL PAID
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                  {amountSol} SOL
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 24,
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

          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 16,
              wordBreak: "break-all",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                marginBottom: 6,
              }}
            >
              TRANSACTION SIGNATURE
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
              {result.tx}
            </span>
          </div>

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

  // ── Main form ──────────────────────────────────────────────
  return (
    <PageWrapper>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Payment with Auto Tax Split
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Every payment automatically splits: net amount → business, tax →
            government. One transaction, immutable record.
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
                  onClick={() => { setMode(m); stopPolling(); }}
                  style={{
                    background: mode === m ? "var(--accent)" : "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 24px",
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
              ℹ️ Your wallet isn't registered as a business — you can pay any
              registered business below.&nbsp;
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                Go to Setup to register.
              </span>
            </div>
          )
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
          {/* Main form card */}
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
                  onChange={(e) => setBusinessOwnerAddr(e.target.value)}
                  readOnly={mode === "create"}
                  style={mode === "create" ? { opacity: 0.7, cursor: "not-allowed" } : {}}
                />
                {mode === "create" && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Auto-filled with your registered business wallet
                  </div>
                )}
                {mode === "pay" && loadingBiz && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Looking up business...
                  </div>
                )}
                {mode === "pay" && businessInfo && !loadingBiz && (
                  <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                    ✓ {businessInfo.name} · {businessInfo.taxRateBps.toNumber() / 100}% tax rate
                  </div>
                )}
                {mode === "pay" && !businessInfo && !loadingBiz && businessOwnerAddr.length > 30 && (
                  <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>
                    ✗ No registered business found at this address
                  </div>
                )}
              </div>

              {/* Product */}
              <div>
                <label style={labelStyle}>Product / Service *</label>
                <input
                  className="input"
                  placeholder="e.g. Web Design Service"
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
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  This is the TOTAL {mode === "create" ? "customers" : "you"} will pay (tax included)
                </div>
              </div>

              {/* IPFS Hash */}
              <div>
                <label style={labelStyle}>
                  Invoice IPFS Hash{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  className="input mono-input"
                  placeholder="Qm... (upload invoice JSON to IPFS first)"
                  value={ipfsHash}
                  onChange={(e) => setIpfsHash(e.target.value)}
                  maxLength={64}
                />
              </div>

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
                    <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
                      💡 Two ways customers can pay:
                    </div>
                    <div>
                      📱 <strong>QR Code</strong> → Customer scans with Phantom app → Smart contract called automatically
                    </div>
                    <div style={{ marginTop: 4 }}>
                      ⚡ <strong>Pay button</strong> → Your connected wallet pays directly → Use when customer pays cash
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
                      💡 How paying works:
                    </div>
                    <div>
                      ⚡ Enter the <strong>business wallet address</strong> above, fill in the amount, then click Pay.
                    </div>
                    <div style={{ marginTop: 4 }}>
                      🏛 Tax is automatically split to the government — you pay the total, the contract does the rest.
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
                    padding: "12px 16px",
                    color: "var(--red)",
                    fontSize: 14,
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
                    padding: "12px 16px",
                    color: "var(--yellow)",
                    fontSize: 14,
                    textAlign: "center",
                  }}
                >
                  Connect your wallet to pay
                </div>
              ) : (
                <button
                  className="btn btn-green"
                  style={{ padding: "16px", fontSize: 16 }}
                  onClick={handlePay}
                  disabled={
                    loading ||
                    submittingRef.current ||
                    !productName ||
                    !amountSol ||
                    !businessOwnerAddr
                  }
                >
                  {loading ? (
                    <>
                      <span className="spinner" /> Processing on Blockchain...
                    </>
                  ) : mode === "create" ? (
                    `⚡ Pay ${amountSol || "0"} SOL → Smart Contract`
                  ) : (
                    `⚡ Send ${amountSol || "0"} SOL to Business`
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Split preview */}
            <div className="card">
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 16,
                }}
              >
                PAYMENT SPLIT PREVIEW
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      height: 8,
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
                        transition: "width 0.3s ease",
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
                      fontSize: 11,
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

            {/* QR code — create mode only */}
            {mode === "create" && qrData && (
              <div className="card" style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    letterSpacing: "0.05em",
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
                    ⚠ Set VITE_API_URL in .env to enable QR smart contract payments
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

                {/* ── Polling UI — auto-starts when QR is shown ── */}
                <div style={{ marginTop: 12 }}>
                  {qrPending ? (
                    <>
                      {/* Animated waiting bar */}
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
                          0% { transform: translateX(-100%); }
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
                        <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
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
                    /* Polling stopped (cancelled) — offer manual restart */
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

                <div
                  style={{
                    marginTop: 10,
                    background: "var(--bg)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    wordBreak: "break-all",
                    textAlign: "left",
                  }}
                >
                  {qrData.slice(0, 100)}...
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function SplitCard({
  icon, label, amount, color,
}: {
  icon: string; label: string; amount: string; color: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: `1px solid ${color}44`,
        borderRadius: 10,
        padding: 16,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color, fontFamily: "var(--font-mono)" }}>
        {amount}
      </div>
    </div>
  );
}

function SplitRow({
  label, value, color, icon, bold,
}: {
  label: string; value: string; color: string; icon?: string; bold?: boolean;
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
  fontSize: 13,
  color: "var(--text-secondary)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};