import React, { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { QRCodeSVG } from "qrcode.react";
import { useProgram } from "../hooks/useProgram";
import {
  calcTaxSplit,
  lamportsToSol,
  solToLamports,
  shortenAddress,
  formatTimestamp,
} from "../utils/constants";

export function PaymentForm() {
  const { publicKey } = useWallet();
  const { payWithTax, fetchBusiness } = useProgram();

  const [mode, setMode] = useState<"create" | "pay">("create");

  const [productName, setProductName] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [businessOwnerAddr, setBusinessOwnerAddr] = useState("");
  const [ipfsHash, setIpfsHash] = useState("");

  const [businessInfo, setBusinessInfo] = useState<any>(null);
  const [loadingBiz, setLoadingBiz] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ tx: string; taxAmount: number; netAmount: number } | null>(null);
  const [error, setError] = useState("");

  const [qrData, setQrData] = useState("");

  const lamports = solToLamports(parseFloat(amountSol) || 0);
  const taxRateBps = businessInfo?.taxRateBps?.toNumber() || 1300;
  const split = calcTaxSplit(lamports, taxRateBps);

  // Auto-fill business owner from connected wallet when in create mode
  useEffect(() => {
    if (mode === "create" && publicKey) {
      setBusinessOwnerAddr(publicKey.toBase58());
    }
  }, [mode, publicKey]);

  // Fetch business info whenever businessOwnerAddr changes (FIXED - was broken before)
  useEffect(() => {
    if (!businessOwnerAddr) return;
    const fetchInfo = async () => {
      setLoadingBiz(true);
      try {
        const pk = new PublicKey(businessOwnerAddr.trim());
        const result = await fetchBusiness(pk);
        if (result) setBusinessInfo(result.account);
      } catch {}
      setLoadingBiz(false);
    };
    fetchInfo();
  }, [businessOwnerAddr]);

  // Generate QR data when invoice is ready
  useEffect(() => {
    if (productName && amountSol && businessOwnerAddr) {
      try {
        const ownerPK = new PublicKey(businessOwnerAddr.trim());
        const amount = parseFloat(amountSol);
        if (amount > 0) {
          const amount_str = amount.toFixed(9).replace(/\.?0+$/, "");
          const label = encodeURIComponent(businessOwnerAddr.slice(0, 20));
          const message = encodeURIComponent(productName);
          const memo = encodeURIComponent(productName.slice(0, 32));
          const url = `solana:${ownerPK.toBase58()}?amount=${amount_str}&label=${label}&message=${message}&memo=${memo}`;
          setQrData(url);
        }
      } catch {
        setQrData("");
      }
    } else {
      setQrData("");
    }
  }, [productName, amountSol, businessOwnerAddr, ipfsHash]);

  const handlePay = async () => {
    setError("");
    setLoading(true);
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

      // Re-fetch business info so dashboard shows updated totals when you navigate back
      try {
        const updated = await fetchBusiness(ownerPK);
        if (updated) setBusinessInfo(updated.account);
      } catch {}

      setResult({ tx, taxAmount: s.taxAmount, netAmount: s.netAmount });
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <PageWrapper>
        <div className="card animate-slide-up" style={{ maxWidth: 580, margin: "0 auto" }}>
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
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
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
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
              }}
            >
              New Payment
            </button>
          </div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Payment with Auto Tax Split
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Every payment automatically splits: net amount → business, tax → government. One transaction, immutable record.
          </p>
        </div>

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 4,
            marginBottom: 24,
            width: "fit-content",
          }}
        >
          {(["create", "pay"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
          {/* Main form */}
          <div className="card">
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Business owner address */}
              <div>
                <label style={labelStyle}>Business Owner Address *</label>
                <input
                  className="input mono-input"
                  placeholder="Business wallet public key"
                  value={businessOwnerAddr}
                  onChange={(e) => setBusinessOwnerAddr(e.target.value)}
                />
                {mode === "create" && publicKey && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Auto-filled with your connected wallet
                  </div>
                )}
                {loadingBiz && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Loading business info...
                  </div>
                )}
                {businessInfo && !loadingBiz && (
                  <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                    ✓ {businessInfo.name} · {businessInfo.taxRateBps.toNumber() / 100}% tax rate
                  </div>
                )}
              </div>

              {/* Product name */}
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
                  This is the TOTAL customers will pay (tax included)
                </div>
              </div>

              {/* IPFS hash (optional) */}
              <div>
                <label style={labelStyle}>
                  Invoice IPFS Hash{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (optional)
                  </span>
                </label>
                <input
                  className="input mono-input"
                  placeholder="Qm... (upload invoice JSON to IPFS first)"
                  value={ipfsHash}
                  onChange={(e) => setIpfsHash(e.target.value)}
                  maxLength={64}
                />
              </div>

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
                  disabled={loading || !productName || !amountSol || !businessOwnerAddr}
                >
                  {loading ? (
                    <><span className="spinner" /> Processing on Blockchain...</>
                  ) : (
                    `⚡ Pay ${amountSol || "0"} SOL → Smart Contract`
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Right panel: split preview + QR */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 16 }}>
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
                  label={`→ Business (net)`}
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

            {qrData && (
              <div className="card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 16 }}>
                  PAYMENT QR CODE
                </div>
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
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
                  Customer scans to pay automatically
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

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