import React, { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "../hooks/useProgram";
import {
  lamportsToSol,
  formatTimestamp,
  shortenAddress,
  bpsToPercent,
} from "../utils/constants";

export function GovernmentDashboard() {
  const { publicKey } = useWallet();
  const { fetchBusiness, fetchTaxRecords } = useProgram();

  const [businessAddr, setBusinessAddr] = useState("");
  const [business, setBusiness] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Track whether the connected wallet is a registered business
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [checkingRegistration, setCheckingRegistration] = useState(false);

  // When wallet connects, check if it's a registered business
  useEffect(() => {
    if (!publicKey) {
      setIsRegistered(null);
      setBusinessAddr("");
      setBusiness(null);
      setRecords([]);
      return;
    }

    const checkRegistration = async () => {
      setCheckingRegistration(true);
      try {
        const result = await fetchBusiness(publicKey);
        if (result) {
          setIsRegistered(true);
          setBusinessAddr(publicKey.toBase58());
        } else {
          setIsRegistered(false);
          setBusinessAddr("");
        }
      } catch {
        setIsRegistered(false);
        setBusinessAddr("");
      } finally {
        setCheckingRegistration(false);
      }
    };

    checkRegistration();
  }, [publicKey]);

  const handleSearch = async () => {
    setError("");
    setLoading(true);
    try {
      const pk = new PublicKey(businessAddr.trim());
      const biz = await fetchBusiness(pk);
      if (!biz) throw new Error("No business registered at this address");
      setBusiness(biz.account);

      const recs = await fetchTaxRecords(pk);
      setRecords(recs as any[]);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch");
      setBusiness(null);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const totalTax = records.reduce(
    (sum, r) => sum + (r?.taxAmount?.toNumber?.() || 0),
    0
  );
  const totalRevenue = records.reduce(
    (sum, r) => sum + (r?.netAmount?.toNumber?.() || 0),
    0
  );

  // ── Not connected ─────────────────────────────────────────
  if (!publicKey) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <div className="badge badge-yellow" style={{ marginBottom: 12 }}>
            🏛 READ-ONLY VIEW
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Government Tax Dashboard
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Look up any registered business to see their on-chain tax collection in real time.
          </p>
        </div>
        <div
          style={{
            background: "var(--yellow-dim)",
            border: "1px solid var(--yellow)",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            color: "var(--yellow)",
            fontSize: 15,
          }}
        >
          🔌 Connect your wallet to access the dashboard
        </div>
      </div>
    );
  }

  // ── Checking registration ─────────────────────────────────
  if (checkingRegistration) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <div className="badge badge-yellow" style={{ marginBottom: 12 }}>
            🏛 READ-ONLY VIEW
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Government Tax Dashboard
          </h1>
        </div>
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <div className="spinner" style={{ margin: "0 auto 12px", width: 32, height: 32, borderWidth: 3 }} />
          Checking registration...
        </div>
      </div>
    );
  }

  // ── Not registered ────────────────────────────────────────
  if (isRegistered === false) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <div className="badge badge-yellow" style={{ marginBottom: 12 }}>
            🏛 READ-ONLY VIEW
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Government Tax Dashboard
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
            Look up any registered business to see their on-chain tax collection in real time.
          </p>
        </div>
        <div
          style={{
            background: "rgba(255,59,59,0.08)",
            border: "1px solid var(--red)",
            borderRadius: 12,
            padding: 28,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 12 }}>🚫</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--red)", marginBottom: 8 }}>
            Business Not Registered
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 420, margin: "0 auto" }}>
            Your connected wallet{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", fontSize: 12 }}>
              ({shortenAddress(publicKey.toBase58(), 6)})
            </span>{" "}
            is not registered as a business. Register your business first to access this dashboard.
          </p>
        </div>
      </div>
    );
  }

  // ── Registered — show dashboard ───────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className="badge badge-yellow" style={{ marginBottom: 12 }}>
          🏛 READ-ONLY VIEW
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Government Tax Dashboard
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
          Look up any registered business to see their on-chain tax collection in real time.
        </p>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Business Owner Wallet Address</label>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            className="input mono-input"
            style={{ flex: 1 }}
            placeholder="Enter business owner's Solana public key..."
            value={businessAddr}
            onChange={(e) => setBusinessAddr(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={loading || !businessAddr}
            style={{ flexShrink: 0 }}
          >
            {loading ? <><span className="spinner" /> Fetching...</> : "🔍 Look Up"}
          </button>
        </div>
        {businessAddr === publicKey.toBase58() && (
          <div style={{ fontSize: 12, color: "var(--green)", marginTop: 6 }}>
            ✓ Auto-filled with your registered business wallet
          </div>
        )}
        {error && (
          <div style={{ marginTop: 12, color: "var(--red)", fontSize: 14 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Results */}
      {business && (
        <div className="animate-slide-up">
          {/* Business info */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <InfoCard label="Business Name" value={business.name} color="var(--text-primary)" />
            <InfoCard
              label="Tax Rate"
              value={`${bpsToPercent(business.taxRateBps.toNumber())}%`}
              color="var(--yellow)"
            />
            <InfoCard
              label="Total Tax Collected"
              value={`${lamportsToSol(totalTax).toFixed(4)} SOL`}
              color="var(--green)"
            />
            <InfoCard
              label="Total Transactions"
              value={business.transactionCount.toNumber().toString()}
              color="var(--accent)"
            />
          </div>

          {/* Gov wallet */}
          <div
            className="card"
            style={{
              marginBottom: 24,
              background: "var(--yellow-dim)",
              border: "1px solid var(--yellow)",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
              TAX AUTHORITY WALLET (receiving tax payments)
            </div>
            <div className="mono" style={{ fontSize: 14, color: "var(--yellow)", wordBreak: "break-all" }}>
              {business.governmentWallet.toBase58()}
            </div>
          </div>

          {/* Tax records table */}
          <div className="card">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
              Tax Records — {records.length} Transactions
            </h3>
            {records.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                No transactions recorded yet.
              </div>
            ) : (
              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["TX #", "Product", "Total Paid", "Tax Amount", "Business Got", "Payer", "Timestamp"].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "8px 12px",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                              color: "var(--text-muted)",
                              borderBottom: "1px solid var(--border)",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r: any, i) => (
                      <tr
                        key={i}
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td style={tdStyle}>
                          <span className="mono" style={{ color: "var(--text-muted)" }}>
                            #{i + 1}
                          </span>
                        </td>
                        <td style={tdStyle}>{r.productName || "—"}</td>
                        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>
                          {lamportsToSol(r.totalAmount.toNumber()).toFixed(4)} SOL
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            fontFamily: "var(--font-mono)",
                            color: "var(--yellow)",
                            fontWeight: 700,
                          }}
                        >
                          {lamportsToSol(r.taxAmount.toNumber()).toFixed(4)} SOL
                        </td>
                        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                          {lamportsToSol(r.netAmount.toNumber()).toFixed(4)} SOL
                        </td>
                        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          {shortenAddress(r.payer.toBase58())}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                          {r.timestamp ? formatTimestamp(r.timestamp.toNumber()) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Footer totals */}
                  <tfoot>
                    <tr style={{ background: "var(--bg-elevated)" }}>
                      <td colSpan={3} style={{ ...tdStyle, fontWeight: 700 }}>
                        TOTALS
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--yellow)", fontWeight: 800 }}>
                        {lamportsToSol(totalTax).toFixed(4)} SOL
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 800 }}>
                        {lamportsToSol(totalRevenue).toFixed(4)} SOL
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em", marginBottom: 8 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
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

const tdStyle: React.CSSProperties = {
  padding: "12px 12px",
  fontSize: 14,
  verticalAlign: "middle",
};