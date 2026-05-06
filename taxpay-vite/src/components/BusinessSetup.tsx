import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "../hooks/useProgram";
import { bpsToPercent, DEMO_GOVERNMENT_WALLET } from "../utils/constants";
import { View } from "../App";

interface Props {
  setView: (v: View) => void;
}

export function BusinessSetup({ setView }: Props) {
  const { publicKey } = useWallet();
  const { initializeBusiness, fetchBusiness } = useProgram();

  const [businessName, setBusinessName] = useState("");
  const [taxRatePct, setTaxRatePct] = useState("13");
  const [govWallet, setGovWallet] = useState(DEMO_GOVERNMENT_WALLET.toBase58());
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [existingBusiness, setExistingBusiness] = useState<any>(null);

  const handleCheck = async () => {
    setChecking(true);
    const res = await fetchBusiness();
    setExistingBusiness(res?.account || null);
    setChecking(false);
  };

  const handleSubmit = async () => {
    if (!publicKey) return;
    setError("");
    setLoading(true);
    try {
      let govPubkey: PublicKey;
      try {
        govPubkey = new PublicKey(govWallet.trim());
      } catch {
        throw new Error("Invalid government wallet address");
      }

      const taxBps = Math.round(parseFloat(taxRatePct) * 100);
      if (taxBps <= 0 || taxBps > 10000)
        throw new Error("Tax rate must be between 0.01% and 100%");

      const { tx } = await initializeBusiness(
        businessName.trim(),
        taxBps,
        govPubkey
      );
      setTxSig(tx);
    } catch (e: any) {
      setError(e?.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <PageWrapper>
        <EmptyState
          icon="🔐"
          title="Connect Your Wallet"
          desc="Connect your Phantom wallet to set up your business."
        />
      </PageWrapper>
    );
  }

  if (txSig) {
    return (
      <PageWrapper>
        <div className="card animate-slide-up" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Business Registered!</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
            Your business is now live on the Solana blockchain.
          </p>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 24,
              wordBreak: "break-all",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>TRANSACTION SIGNATURE</div>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>{txSig}</span>
          </div>
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ marginRight: 8 }}
          >
            🔍 View on Explorer
          </a>
          <button className="btn btn-primary" onClick={() => setView("dashboard")}>
            Go to Dashboard →
          </button>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Register Business
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Create your on-chain business account. This is a one-time setup.
          </p>
        </div>

        {/* Check existing */}
        <div className="card" style={{ marginBottom: 24, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              Already have a business registered?
            </span>
            <button className="btn btn-secondary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={handleCheck} disabled={checking}>
              {checking ? <span className="spinner" /> : "Check"}
            </button>
          </div>
          {existingBusiness && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--green-dim)", borderRadius: 8, border: "1px solid var(--green)" }}>
              <span style={{ color: "var(--green)", fontSize: 13, fontWeight: 700 }}>
                ✓ Found: "{existingBusiness.name}" · Tax: {bpsToPercent(existingBusiness.taxRateBps.toNumber())}%
              </span>
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Business Name */}
            <div>
              <label style={labelStyle}>Business Name *</label>
              <input
                className="input"
                placeholder="e.g. Momo Palace Restaurant"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={64}
              />
              <div style={hintStyle}>{businessName.length}/64 characters</div>
            </div>

            {/* Tax Rate */}
            <div>
              <label style={labelStyle}>Tax Rate (%)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  placeholder="13"
                  value={taxRatePct}
                  onChange={(e) => setTaxRatePct(e.target.value)}
                  style={{ flex: 1 }}
                />
                {[5, 10, 13, 15, 18].map((r) => (
                  <button
                    key={r}
                    className="btn btn-secondary"
                    style={{ padding: "8px 14px", fontSize: 13, flexShrink: 0 }}
                    onClick={() => setTaxRatePct(String(r))}
                  >
                    {r}%
                  </button>
                ))}
              </div>
              <div style={hintStyle}>
                Nepal VAT = 13% · GST India = 18% · Standard = 5–15%
              </div>
            </div>

            {/* Government Wallet */}
            <div>
              <label style={labelStyle}>Government / Tax Authority Wallet *</label>
              <input
                className="input mono-input"
                placeholder="Solana public key of tax authority"
                value={govWallet}
                onChange={(e) => setGovWallet(e.target.value)}
              />
              <div style={hintStyle}>
                Tax payments will be sent directly to this wallet. Demo uses a placeholder address.
              </div>
            </div>

            {/* Preview */}
            {businessName && taxRatePct && (
              <div
                style={{
                  background: "var(--accent-dim)",
                  border: "1px solid var(--accent)",
                  borderRadius: 10,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, marginBottom: 8 }}>PREVIEW</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Stat label="Business" value={businessName} />
                  <Stat label="Tax Rate" value={`${taxRatePct}%`} />
                  <Stat label="On a ₹1000 sale" value={`₹${Math.round((1000 * parseFloat(taxRatePct || "0")) / 100)} tax`} />
                  <Stat label="Net to You" value={`₹${1000 - Math.round((1000 * parseFloat(taxRatePct || "0")) / 100)}`} />
                </div>
              </div>
            )}

            {error && (
              <div style={{ background: "var(--red-dim)", border: "1px solid var(--red)", borderRadius: 8, padding: "12px 16px", color: "var(--red)", fontSize: 14 }}>
                ⚠ {error}
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: "100%", padding: "16px" }}
              onClick={handleSubmit}
              disabled={loading || !businessName || !govWallet}
            >
              {loading ? (
                <><span className="spinner" /> Submitting to Blockchain...</>
              ) : (
                "🚀 Register Business on Solana"
              )}
            </button>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 24px" }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>{icon}</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <p style={{ color: "var(--text-secondary)" }}>{desc}</p>
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

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  marginTop: 6,
};