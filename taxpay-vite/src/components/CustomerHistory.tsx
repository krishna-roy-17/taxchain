import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useProgram } from "../hooks/useProgram";
import {
  lamportsToSol,
  formatTimestamp,
  shortenAddress,
  bpsToPercent,
} from "../utils/constants";

interface HistoryRow {
  businessName:  string;
  businessOwner: string;
  product:       string;
  total:         number;
  tax:           number;
  net:           number;
  taxRate:       number;
  timestamp:     number;
  pda:           string;
}

export function CustomerHistory() {
  const { publicKey } = useWallet();
  const { program }   = useProgram();

  const [records,     setRecords]     = useState<HistoryRow[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortBy,      setSortBy]      = useState<"newest" | "oldest" | "total_high">("newest");
  const [searchBiz,   setSearchBiz]   = useState("");

  const fetchHistory = useCallback(async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    try {
      // Fetch all tax records then filter by payer === connected wallet
      const allRecs = await (program.account as any).taxRecord.all();
      const myRecs  = allRecs.filter(
        (r: any) => r.account.payer.toBase58() === publicKey.toBase58()
      );

      // Also fetch all businesses to get names
      const allBiz = await (program.account as any).businessAccount.all();
      const bizMap: Record<string, string> = {};
      allBiz.forEach((b: any) => {
        bizMap[b.account.owner.toBase58()] = b.account.name;
      });

      const rows: HistoryRow[] = myRecs.map((r: any) => ({
        businessName:  bizMap[r.account.businessOwner.toBase58()] || "Unknown Business",
        businessOwner: r.account.businessOwner.toBase58(),
        product:       r.account.productName,
        total:         r.account.totalAmount.toNumber(),
        tax:           r.account.taxAmount.toNumber(),
        net:           r.account.netAmount.toNumber(),
        taxRate:       r.account.taxRateBps.toNumber(),
        timestamp:     r.account.timestamp.toNumber(),
        pda:           r.publicKey.toBase58(),
      }));

      setRecords(rows);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("CustomerHistory fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [program, publicKey]);

  useEffect(() => {
    if (program && publicKey) fetchHistory();
  }, [program, publicKey]);

  // ── Filter + sort ─────────────────────────────────────────
  const filtered = records
    .filter(r => {
      if (searchBiz && !r.businessName.toLowerCase().includes(searchBiz.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "oldest")     return a.timestamp - b.timestamp;
      if (sortBy === "total_high") return b.total - a.total;
      return b.timestamp - a.timestamp;
    });

  // ── Aggregates ────────────────────────────────────────────
  const totalSpent = filtered.reduce((s, r) => s + r.total, 0);
  const totalTax   = filtered.reduce((s, r) => s + r.tax,   0);
  const totalNet   = filtered.reduce((s, r) => s + r.net,   0);

  // ── Export CSV ────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      "Business,Product,Total SOL,Tax SOL,Net SOL,Tax%,Timestamp",
      ...filtered.map(r => [
        r.businessName,
        r.product,
        lamportsToSol(r.total).toFixed(6),
        lamportsToSol(r.tax).toFixed(6),
        lamportsToSol(r.net).toFixed(6),
        bpsToPercent(r.taxRate) + "%",
        formatTimestamp(r.timestamp),
      ].join(","))
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = `my_payments_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── Not connected ─────────────────────────────────────────
  if (!publicKey) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "80px 24px" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🧾</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 12 }}>
            My Payment History
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 15,
            maxWidth: 400, margin: "0 auto 32px", lineHeight: 1.6 }}>
            Connect your wallet to see every payment you've made, including
            the tax breakdown for each transaction.
          </p>
          <WalletMultiButton />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px 60px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>
            My Payment History
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)",
              fontFamily: "var(--font-mono)" }}>
              PAYER:
            </span>
            <span style={{ fontSize: 12, color: "var(--accent)",
              fontFamily: "var(--font-mono)", fontWeight: 700 }}>
              {publicKey.toBase58()}
            </span>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16, marginBottom: 24 }}>
          <StatCard icon="🧾" label="Total Payments"
            value={filtered.length.toString()}
            sub={`of ${records.length} total`} />
          <StatCard icon="💸" label="Total Spent"
            value={lamportsToSol(totalSpent).toFixed(4) + " SOL"}
            highlight />
          <StatCard icon="🏛" label="Tax Paid"
            value={lamportsToSol(totalTax).toFixed(4) + " SOL"}
            sub="auto-collected" />
          <StatCard icon="💰" label="Paid to Businesses"
            value={lamportsToSol(totalNet).toFixed(4) + " SOL"} />
        </div>

        {/* ── Filter bar ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Search by Business</label>
              <input
                className="input"
                placeholder="filter by business name..."
                value={searchBiz}
                onChange={e => setSearchBiz(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Sort By</label>
              <select className="input" value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                style={{ cursor: "pointer" }}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="total_high">Amount: High → Low</option>
              </select>
            </div>
            {searchBiz && (
              <button
                onClick={() => setSearchBiz("")}
                style={{ background: "none", border: "1px solid var(--red)",
                  borderRadius: 8, padding: "10px 14px", color: "var(--red)",
                  cursor: "pointer", fontFamily: "var(--font-display)",
                  fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                × Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: 16,
            flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Transactions</h3>
              <span style={{ background: "rgba(99,179,237,0.12)",
                color: "var(--accent)", padding: "2px 10px",
                borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                {filtered.length}
                {filtered.length !== records.length && ` / ${records.length}`}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary"
                style={{ padding: "7px 14px", fontSize: 13 }}
                onClick={fetchHistory} disabled={loading}>
                {loading
                  ? <><span className="spinner" /> Loading...</>
                  : "↺ Refresh"}
              </button>
              {filtered.length > 0 && (
                <button className="btn btn-secondary"
                  style={{ padding: "7px 14px", fontSize: 13 }}
                  onClick={exportCSV}>
                  ⬇ Export CSV
                </button>
              )}
            </div>
          </div>

          {loading && records.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0",
              color: "var(--text-muted)" }}>
              <div className="spinner" style={{ margin: "0 auto 12px",
                width: 32, height: 32, borderWidth: 3 }} />
              Fetching your transactions...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0",
              color: "var(--text-muted)", fontSize: 14 }}>
              {records.length === 0
                ? "No payments found for your wallet yet."
                : "No results match your search."}
            </div>
          ) : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["#", "Business", "Product", "Total SOL",
                      "Tax SOL", "To Business", "Rate", "Date", "🔍"].map(h => (
                      <th key={h} style={{ textAlign: "left",
                        padding: "8px 12px", fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)",
                        borderBottom: "1px solid rgba(99,179,237,0.15)",
                        letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.pda + i}
                      style={{ borderBottom: "1px solid var(--border)",
                        transition: "background 0.15s" }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.background = "rgba(99,179,237,0.04)")}
                      onMouseLeave={e =>
                        (e.currentTarget.style.background = "transparent")}>

                      <td style={{ ...td, color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {i + 1}
                      </td>

                      <td style={td}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {r.businessName}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)",
                          fontFamily: "var(--font-mono)", marginTop: 2 }}>
                          {shortenAddress(r.businessOwner, 5)}
                        </div>
                      </td>

                      <td style={{ ...td, fontSize: 13 }}>
                        {r.product || "—"}
                      </td>

                      {/* Total — highlighted for customer */}
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 13, color: "var(--accent)", fontWeight: 800 }}>
                        {lamportsToSol(r.total).toFixed(4)}
                      </td>

                      {/* Tax */}
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 12, color: "var(--yellow)" }}>
                        {lamportsToSol(r.tax).toFixed(4)}
                      </td>

                      {/* Net to business */}
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 12, color: "var(--text-secondary)" }}>
                        {lamportsToSol(r.net).toFixed(4)}
                      </td>

                      {/* Rate badge */}
                      <td style={td}>
                        <span style={{ background: "rgba(255,193,7,0.12)",
                          color: "var(--yellow)", padding: "2px 8px",
                          borderRadius: 4, fontSize: 11,
                          fontFamily: "var(--font-mono)" }}>
                          {bpsToPercent(r.taxRate)}%
                        </span>
                      </td>

                      <td style={{ ...td, fontSize: 11,
                        color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {formatTimestamp(r.timestamp)}
                      </td>

                      <td style={td}>
                        <a href={"https://explorer.solana.com/address/"
                          + r.pda + "?cluster=devnet"}
                          target="_blank" rel="noreferrer"
                          style={{ color: "var(--accent)", fontSize: 14,
                            textDecoration: "none" }}>
                          🔍
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {filtered.length > 1 && (
                  <tfoot>
                    <tr style={{ background: "rgba(99,179,237,0.05)",
                      borderTop: "1px solid rgba(99,179,237,0.3)" }}>
                      <td colSpan={3} style={{ ...td, fontWeight: 800,
                        color: "var(--accent)", fontSize: 12,
                        fontFamily: "var(--font-mono)" }}>
                        TOTALS
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 13, color: "var(--accent)", fontWeight: 800 }}>
                        {lamportsToSol(totalSpent).toFixed(4)}
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 12, color: "var(--yellow)", fontWeight: 700 }}>
                        {lamportsToSol(totalTax).toFixed(4)}
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)",
                        fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                        {lamportsToSol(totalNet).toFixed(4)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {lastUpdated && (
            <div style={{ marginTop: 12, fontSize: 11,
              color: "var(--text-muted)", fontFamily: "var(--font-mono)",
              textAlign: "right" }}>
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ── Sub-components ────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", color: "var(--text-primary)" }}>
      {children}
    </div>
  );
}

function StatCard({ icon, label, value, sub, highlight }: {
  icon: string; label: string; value: string;
  sub?: string; highlight?: boolean;
}) {
  return (
    <div className="card" style={{
      borderColor: highlight ? "rgba(99,179,237,0.4)" : "var(--border)",
      background:  highlight ? "rgba(99,179,237,0.05)" : "var(--bg-card)",
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800,
        color: highlight ? "var(--accent)" : "var(--text-primary)",
        fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontWeight: 700, fontSize: 10,
  color: "var(--text-secondary)", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "11px 12px", fontSize: 13, verticalAlign: "middle",
};