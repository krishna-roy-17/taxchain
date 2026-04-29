import React, { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useProgram } from "../hooks/useProgram";
import {
  lamportsToSol,
  formatTimestamp,
  shortenAddress,
  bpsToPercent,
} from "../utils/constants";
import { View } from "../App";

interface Props {
  setView: (v: View) => void;
}

export function Dashboard({ setView }: Props) {
  const { publicKey } = useWallet();
  const { fetchBusiness, fetchTaxRecords } = useProgram();

  const [business, setBusiness] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // FIX: runs when wallet connects AND every time Dashboard re-mounts
  // (re-mounts happen every time you navigate back to the dashboard tab)
  useEffect(() => {
    if (!publicKey) return;
    load();
  }, [publicKey]);

  // FIX: also re-fetch on first mount even if publicKey didn't change
  // This covers navigating back from the Pay tab after a payment
  useEffect(() => {
    if (!publicKey) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const biz = await fetchBusiness();
      setBusiness(biz?.account || null);

      const recs = await fetchTaxRecords();
      setRecords(recs as any[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <PageWrapper>
        <Hero setView={setView} />
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper>
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
          <div className="spinner" style={{ margin: "0 auto 16px", width: 32, height: 32, borderWidth: 3 }} />
          Loading blockchain data...
        </div>
      </PageWrapper>
    );
  }

  if (!business) {
    return (
      <PageWrapper>
        <div
          className="card animate-slide-up"
          style={{ maxWidth: 500, margin: "60px auto", textAlign: "center" }}
        >
          <div style={{ fontSize: 52, marginBottom: 16 }}>🏢</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>
            No Business Found
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
            You haven't registered a business yet. Set it up to start accepting tax-split payments.
          </p>
          <button className="btn btn-primary" onClick={() => setView("setup")}>
            Register Business →
          </button>
        </div>
      </PageWrapper>
    );
  }

  // Chart data
  const chartData = records.map((r, i) => ({
    tx: `#${i + 1}`,
    revenue: parseFloat(lamportsToSol(r.netAmount.toNumber()).toFixed(6)),
    tax: parseFloat(lamportsToSol(r.taxAmount.toNumber()).toFixed(6)),
  }));

  return (
    <PageWrapper>
      <div className="animate-slide-up">
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 32,
          }}
        >
          <div>
            <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {business.name}
            </h1>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <span className="badge badge-purple">
                {bpsToPercent(business.taxRateBps.toNumber())}% Tax Rate
              </span>
              <span className="badge badge-green">● Live on Devnet</span>
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 10px" }}
              >
                {shortenAddress(business.owner.toBase58(), 6)}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={load} disabled={loading}>
              ↺ Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setView("pay")}>
              + New Payment
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          <StatCard
            label="Total Revenue"
            value={`${lamportsToSol(business.totalRevenue.toNumber()).toFixed(4)} SOL`}
            icon="💰"
            color="var(--accent)"
          />
          <StatCard
            label="Tax Collected"
            value={`${lamportsToSol(business.totalTaxCollected.toNumber()).toFixed(4)} SOL`}
            icon="🏛"
            color="var(--yellow)"
          />
          <StatCard
            label="Total Transactions"
            value={business.transactionCount.toNumber().toString()}
            icon="⚡"
            color="var(--green)"
          />
          <StatCard
            label="Tax Rate"
            value={`${bpsToPercent(business.taxRateBps.toNumber())}%`}
            icon="📊"
            color="var(--red)"
          />
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              Revenue vs Tax — Per Transaction
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="tx" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={{ fill: "var(--accent)" }}
                  name="Revenue (SOL)"
                />
                <Line
                  type="monotone"
                  dataKey="tax"
                  stroke="var(--yellow)"
                  strokeWidth={2}
                  dot={{ fill: "var(--yellow)" }}
                  name="Tax (SOL)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Transaction history */}
        <div className="card">
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
            Transaction History ({records.length})
          </h3>
          {records.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
              No transactions yet. Accept your first payment!
            </div>
          ) : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "Product", "Total", "Tax", "Net", "Payer", "Time"].map((h) => (
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
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r: any, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "transparent")
                      }
                    >
                      <td style={tdStyle}>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                          #{r.transactionIndex?.toNumber?.() + 1 || i + 1}
                        </span>
                      </td>
                      <td style={tdStyle}>{r.productName || "—"}</td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>
                        {lamportsToSol(r.totalAmount.toNumber()).toFixed(4)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--yellow)" }}>
                        {lamportsToSol(r.taxAmount.toNumber()).toFixed(4)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                        {lamportsToSol(r.netAmount.toNumber()).toFixed(4)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {shortenAddress(r.payer.toBase58())}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "var(--text-muted)" }}>
                        {r.timestamp
                          ? formatTimestamp(r.timestamp.toNumber())
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: string;
  color: string;
}) {
  return (
    <div
      className="card"
      style={{ borderColor: `${color}33` }}
    >
      <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
    </div>
  );
}

function Hero({ setView }: { setView: (v: View) => void }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px" }}>
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          background: "radial-gradient(circle, rgba(124,92,252,0.15) 0%, transparent 70%)",
          borderRadius: "50%",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -60%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        <div className="badge badge-purple" style={{ marginBottom: 20, fontSize: 11 }}>
          ⚡ SOLANA DEVNET · HACKATHON BUILD
        </div>

        <h1
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.05,
            marginBottom: 20,
          }}
        >
          Payments with
          <br />
          <span style={{ color: "var(--accent)" }}>Built-in Tax.</span>
        </h1>

        <p
          style={{
            fontSize: 18,
            color: "var(--text-secondary)",
            maxWidth: 520,
            margin: "0 auto 40px",
            lineHeight: 1.6,
          }}
        >
          Every payment automatically splits into business income + tax. Recorded on-chain. Immutable. Verifiable. No fraud possible.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" style={{ padding: "16px 32px", fontSize: 16 }} onClick={() => setView("setup")}>
            Start as Business →
          </button>
          <button className="btn btn-secondary" style={{ padding: "16px 32px", fontSize: 16 }} onClick={() => setView("pay")}>
            Make a Payment
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginTop: 64,
            textAlign: "left",
          }}
        >
          {[
            { icon: "⚡", title: "Instant Split", desc: "Tax separated in the same on-chain transaction. Zero delay." },
            { icon: "🔒", title: "Immutable Records", desc: "Every payment stored permanently. No tampering, no fraud." },
            { icon: "🏛", title: "Gov Dashboard", desc: "Real-time tax visibility for authorities. No manual filing." },
          ].map((f) => (
            <div key={f.title} className="card">
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
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

const tdStyle: React.CSSProperties = {
  padding: "12px 12px",
  fontSize: 14,
  verticalAlign: "middle",
};