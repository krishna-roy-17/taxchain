import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useProgram } from "../hooks/useProgram";
import {
  lamportsToSol,
  formatTimestamp,
  shortenAddress,
  bpsToPercent,
} from "../utils/constants";

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────
interface TxRow {
  businessName:  string;
  businessOwner: string;
  product:       string;
  total:         number;
  tax:           number;
  net:           number;
  taxRate:       number;
  payer:         string;
  timestamp:     number;
  pda:           string;
}

interface BizRow {
  name:         string;
  owner:        string;
  totalTax:     number;
  totalRevenue: number;
  txCount:      number;
  govWallet:    string;
}

// ─────────────────────────────────────────────────────────────
//  MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export function GovPortal() {
  const { publicKey } = useWallet();
  const { program }   = useProgram();

  const [businesses,   setBusinesses]   = useState<BizRow[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [isLive,       setIsLive]       = useState(false);
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);
  const [newTxFlash,   setNewTxFlash]   = useState(false);

  // ── Filters ───────────────────────────────────────────────
  const [selectedBiz,  setSelectedBiz]  = useState<string | null>(null);
  const [searchWallet, setSearchWallet] = useState("");
  const [sortBy,       setSortBy]       = useState<"newest"|"oldest"|"tax_high">("newest");

  // ─────────────────────────────────────────────────────────
  //  FETCH — only businesses where gov_wallet == my wallet
  // ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (silent = false) => {
    if (!program || !publicKey) return;
    if (!silent) setLoading(true);
    try {
      const allBiz = await (program.account as any).businessAccount.all();

      // KEY FILTER: only businesses that registered MY wallet as gov
      const myBiz = allBiz.filter((b: any) =>
        b.account.governmentWallet.toBase58() === publicKey.toBase58()
      );

      const bizRows: BizRow[] = myBiz.map((b: any) => ({
        name:         b.account.name,
        owner:        b.account.owner.toBase58(),
        totalTax:     b.account.totalTaxCollected.toNumber(),
        totalRevenue: b.account.totalRevenue.toNumber(),
        txCount:      b.account.transactionCount.toNumber(),
        govWallet:    b.account.governmentWallet.toBase58(),
      }));
      setBusinesses(bizRows);

      const allRecs = await (program.account as any).taxRecord.all();

      // KEY FILTER: only records where gov_wallet == my wallet
      const myRecs = allRecs.filter((r: any) =>
        r.account.governmentWallet.toBase58() === publicKey.toBase58()
      );

      const txRows: TxRow[] = myRecs.map((r: any) => {
        const owner = r.account.businessOwner.toBase58();
        const biz   = bizRows.find(b => b.owner === owner);
        return {
          businessName:  biz?.name || "Unknown",
          businessOwner: owner,
          product:       r.account.productName,
          total:         r.account.totalAmount.toNumber(),
          tax:           r.account.taxAmount.toNumber(),
          net:           r.account.netAmount.toNumber(),
          taxRate:       r.account.taxRateBps.toNumber(),
          payer:         r.account.payer.toBase58(),
          timestamp:     r.account.timestamp.toNumber(),
          pda:           r.publicKey.toBase58(),
        };
      });

      if (silent && txRows.length > transactions.length) {
        setNewTxFlash(true);
        setTimeout(() => setNewTxFlash(false), 2500);
      }

      setTransactions(txRows);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("GovPortal fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, transactions.length]);

  useEffect(() => {
    if (program && publicKey) fetchAll();
  }, [program, publicKey]);

  useEffect(() => {
    if (!isLive || !program || !publicKey) return;
    const id = setInterval(() => fetchAll(true), 5000);
    return () => clearInterval(id);
  }, [isLive, program, publicKey, fetchAll]);

  // ─────────────────────────────────────────────────────────
  //  FILTER + SORT
  // ─────────────────────────────────────────────────────────
  const filtered = transactions
    .filter(tx => {
      if (selectedBiz && tx.businessOwner !== selectedBiz) return false;
      if (searchWallet) {
        const q = searchWallet.toLowerCase();
        if (!tx.businessOwner.toLowerCase().includes(q) &&
            !tx.payer.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "oldest")   return a.timestamp - b.timestamp;
      if (sortBy === "tax_high") return b.tax - a.tax;
      return b.timestamp - a.timestamp;
    });

  const hasFilters = searchWallet || selectedBiz;

  // ── Aggregated stats ──────────────────────────────────────
  const totalTax     = filtered.reduce((s, t) => s + t.tax,   0);
  const totalRevenue = filtered.reduce((s, t) => s + t.net,   0);
  const totalVolume  = filtered.reduce((s, t) => s + t.total, 0);
  const avgTax       = filtered.length > 0
    ? totalTax / filtered.length : 0;

  // ─────────────────────────────────────────────────────────
  //  CSV EXPORT
  // ─────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      "Business,Owner Wallet,Product,Total SOL,Tax SOL,Net SOL,Tax%,Payer,Timestamp",
      ...filtered.map(t => [
        t.businessName, t.businessOwner, t.product,
        lamportsToSol(t.total).toFixed(6),
        lamportsToSol(t.tax).toFixed(6),
        lamportsToSol(t.net).toFixed(6),
        bpsToPercent(t.taxRate) + "%",
        t.payer,
        formatTimestamp(t.timestamp),
      ].join(","))
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = `tax_report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ─────────────────────────────────────────────────────────
  //  NOT CONNECTED
  // ─────────────────────────────────────────────────────────
  if (!publicKey) {
    return (
      <GovShell>
        <div style={{ textAlign:"center", padding:"100px 24px" }}>
          <div style={{ fontSize:72, marginBottom:20 }}>🏛</div>
          <h1 style={{ fontSize:36, fontWeight:800, color:GOLD, marginBottom:12 }}>
            Government Tax Portal
          </h1>
          <p style={{ color:"var(--text-secondary)", fontSize:15,
            maxWidth:440, margin:"0 auto 16px", lineHeight:1.6 }}>
            Connect the <strong>government wallet</strong> to view all tax
            collections where your wallet is the registered tax authority.
          </p>
          <p style={{ color:"var(--text-muted)", fontSize:12,
            fontFamily:"var(--font-mono)", marginBottom:40 }}>
            Only transactions from businesses that registered your wallet
            as their tax authority will appear here.
          </p>
         <BaseWalletMultiButton
  labels={{
    'change-wallet': 'Change wallet',
    connecting: 'Connecting...',
    'copy-address': 'Copy address',
    copied: 'Copied',
    disconnect: 'Disconnect',
    'has-wallet': 'Connect',
    'no-wallet': 'Select Wallet',
  }}
/>
        </div>
      </GovShell>
    );
  }

  // ─────────────────────────────────────────────────────────
  //  CONNECTED — NO BUSINESSES ASSIGNED YET
  // ─────────────────────────────────────────────────────────
  if (!loading && businesses.length === 0) {
    return (
      <GovShell>
        <GovTopBar publicKey={publicKey.toBase58()}
          onRefresh={() => fetchAll()} loading={loading} />
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:52, marginBottom:16 }}>🔍</div>
          <h2 style={{ fontSize:26, fontWeight:800, marginBottom:12 }}>
            No Businesses Assigned to Your Wallet
          </h2>
          <p style={{ color:"var(--text-secondary)",
            maxWidth:460, margin:"0 auto 8px" }}>
            No business has registered your wallet as their tax authority yet.
          </p>
          <div style={{ background:"rgba(255,193,7,0.08)",
            border:"1px solid rgba(255,193,7,0.3)",
            borderRadius:12, padding:20, maxWidth:520,
            margin:"24px auto" }}>
            <div style={{ fontWeight:700, color:GOLD,
              marginBottom:10, fontSize:14 }}>
              Share this address with businesses:
            </div>
            <div style={{ fontFamily:"var(--font-mono)", fontSize:12,
              color:"var(--text-primary)", wordBreak:"break-all",
              background:"var(--bg)", padding:"10px 14px",
              borderRadius:8, userSelect:"all" }}>
              {publicKey.toBase58()}
            </div>
            <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:8 }}>
              They paste this in the "Government Wallet" field during business setup
            </div>
          </div>
          <button className="btn btn-secondary"
            onClick={() => fetchAll()} style={{ marginTop:8 }}>
            ↺ Check Again
          </button>
        </div>
      </GovShell>
    );
  }

  // ─────────────────────────────────────────────────────────
  //  AUTHORIZED + HAS DATA
  // ─────────────────────────────────────────────────────────
  return (
    <GovShell>
      <GovTopBar publicKey={publicKey.toBase58()}
        onRefresh={() => fetchAll()} loading={loading} />

      <div style={{ maxWidth:1200, margin:"0 auto",
        padding:"28px 32px 60px" }}>

        {/* ── Live indicator banner ── */}
        {isLive && (
          <div style={{ background:"rgba(0,208,132,0.08)",
            border:"1px solid rgba(0,208,132,0.3)",
            borderRadius:10, padding:"10px 16px",
            marginBottom:20, display:"flex",
            alignItems:"center", gap:10 }}>
            <span style={{ width:8, height:8, borderRadius:"50%",
              background:"var(--green)", display:"inline-block",
              animation:"pulse 1.5s infinite" }} />
            <span style={{ color:"var(--green)", fontSize:13,
              fontWeight:700 }}>
              LIVE MODE — Polling every 5 seconds
            </span>
            {lastUpdated && (
              <span style={{ color:"var(--text-muted)", fontSize:12,
                fontFamily:"var(--font-mono)", marginLeft:"auto" }}>
                Last: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {/* ── NEW TX FLASH ── */}
        {newTxFlash && (
          <div style={{ background:"var(--green-dim)",
            border:"1px solid var(--green)", borderRadius:10,
            padding:"12px 18px", marginBottom:16,
            display:"flex", alignItems:"center", gap:10,
            animation:"slideUp 0.3s ease" }}>
            <span style={{ fontSize:20 }}>🔔</span>
            <span style={{ color:"var(--green)", fontWeight:800 }}>
              New Tax Payment Received!
            </span>
          </div>
        )}

        {/* ── STAT CARDS ── */}
        <div style={{ display:"grid",
          gridTemplateColumns:"repeat(4,1fr)",
          gap:16, marginBottom:24 }}>
          <GovStat icon="🏢" label="Businesses Under Authority"
            value={businesses.length.toString()}
            sub={`${businesses.filter(b=>b.txCount>0).length} active`} />
          <GovStat icon="🏛" label="Tax Collected (filtered)"
            value={lamportsToSol(totalTax).toFixed(4) + " SOL"}
            sub={`avg ${lamportsToSol(avgTax).toFixed(4)} per tx`}
            highlight />
          <GovStat icon="💰" label="Business Revenue (filtered)"
            value={lamportsToSol(totalRevenue).toFixed(4) + " SOL"}
            sub={`total vol: ${lamportsToSol(totalVolume).toFixed(4)}`} />
          <GovStat icon="⚡" label="Transactions (filtered)"
            value={filtered.length.toString()}
            sub={`of ${transactions.length} total`} />
        </div>

        {/* ── BUSINESS FILTER CHIPS ── */}
        {businesses.length > 0 && (
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700,
              color:"var(--text-muted)", fontFamily:"var(--font-mono)",
              letterSpacing:"0.06em", marginBottom:12 }}>
              FILTER BY BUSINESS
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {/* "All" chip */}
              <button onClick={() => setSelectedBiz(null)}
                style={{
                  background: !selectedBiz ? "rgba(255,193,7,0.2)" : "var(--bg)",
                  border: !selectedBiz ? `1px solid ${GOLD}` : "1px solid var(--border)",
                  borderRadius:8, padding:"7px 16px",
                  color: !selectedBiz ? GOLD : "var(--text-secondary)",
                  cursor:"pointer", fontFamily:"var(--font-display)",
                  fontWeight:700, fontSize:13, transition:"all 0.2s",
                }}>
                All ({transactions.length})
              </button>
              {businesses.map(b => (
                <button key={b.owner}
                  onClick={() =>
                    setSelectedBiz(selectedBiz === b.owner ? null : b.owner)
                  }
                  style={{
                    background: selectedBiz === b.owner
                      ? "rgba(255,193,7,0.15)" : "var(--bg)",
                    border: selectedBiz === b.owner
                      ? `1px solid ${GOLD}` : "1px solid var(--border)",
                    borderRadius:8, padding:"7px 14px",
                    color: selectedBiz === b.owner
                      ? GOLD : "var(--text-primary)",
                    cursor:"pointer",
                    fontFamily:"var(--font-display)",
                    fontWeight:600, fontSize:13,
                    display:"flex", alignItems:"center", gap:8,
                    transition:"all 0.2s",
                  }}>
                  <span style={{ width:7, height:7, borderRadius:"50%",
                    background: b.txCount > 0
                      ? "var(--green)" : "var(--border)",
                    flexShrink:0 }} />
                  <span>{b.name}</span>
                  <span style={{ fontFamily:"var(--font-mono)",
                    fontSize:10, color:GOLD, opacity:0.8 }}>
                    {b.txCount} tx · {lamportsToSol(b.totalTax).toFixed(3)} SOL
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── SEARCH + SORT ── */}
        <div className="card" style={{ marginBottom:16 }}>
          <div style={{ display:"flex", gap:12, alignItems:"flex-end" }}>
            <div style={{ flex:2 }}>
              <label style={labelStyle}>Search by Wallet Address</label>
              <input
                className="input mono-input"
                placeholder="paste business or payer wallet to filter..."
                value={searchWallet}
                onChange={e => setSearchWallet(e.target.value)}
              />
            </div>
            <div style={{ flex:1 }}>
              <label style={labelStyle}>Sort By</label>
              <select className="input" value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                style={{ cursor:"pointer" }}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="tax_high">Tax: High → Low</option>
              </select>
            </div>
            {(searchWallet || selectedBiz) && (
              <button
                onClick={() => { setSearchWallet(""); setSelectedBiz(null); }}
                style={{ background:"none", border:"1px solid var(--red)",
                  borderRadius:8, padding:"10px 14px", color:"var(--red)",
                  cursor:"pointer", fontFamily:"var(--font-display)",
                  fontWeight:700, fontSize:13, flexShrink:0 }}>
                × Clear
              </button>
            )}
          </div>
        </div>

        {/* ── TRANSACTION TABLE ── */}
        <div className="card" style={{
          borderColor: newTxFlash
            ? "rgba(0,208,132,0.6)" : "var(--border)",
          transition:"border-color 0.5s",
        }}>
          {/* Table header */}
          <div style={{ display:"flex", alignItems:"center",
            justifyContent:"space-between", marginBottom:16,
            flexWrap:"wrap", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <h3 style={{ fontSize:15, fontWeight:700 }}>
                Tax Records
              </h3>
              <span style={{ background:"rgba(255,193,7,0.12)",
                color:GOLD, padding:"2px 10px",
                borderRadius:999, fontSize:12, fontWeight:700 }}>
                {filtered.length}
                {filtered.length !== transactions.length &&
                  ` / ${transactions.length}`}
              </span>
            </div>

            <div style={{ display:"flex", gap:8 }}>
              {/* Live button */}
              <button onClick={() => setIsLive(v => !v)}
                style={{ background: isLive
                    ? "var(--green-dim)" : "var(--bg)",
                  border: isLive
                    ? "1px solid var(--green)" : "1px solid var(--border)",
                  borderRadius:8, padding:"7px 16px",
                  color: isLive ? "var(--green)" : "var(--text-secondary)",
                  cursor:"pointer", fontFamily:"var(--font-display)",
                  fontWeight:700, fontSize:13,
                  display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:7, height:7, borderRadius:"50%",
                  background: isLive
                    ? "var(--green)" : "var(--text-muted)",
                  animation: isLive ? "pulse 1.5s infinite" : "none" }} />
                {isLive ? "LIVE — Stop" : "▶ Go Live"}
              </button>

              {/* Refresh */}
              <button className="btn btn-secondary"
                style={{ padding:"7px 14px", fontSize:13 }}
                onClick={() => fetchAll()} disabled={loading}>
                {loading
                  ? <><span className="spinner" /> Loading...</>
                  : "↺ Refresh"}
              </button>

              {/* Export CSV */}
              {filtered.length > 0 && (
                <button className="btn btn-secondary"
                  style={{ padding:"7px 14px", fontSize:13 }}
                  onClick={exportCSV}>
                  ⬇ Export CSV
                </button>
              )}
            </div>
          </div>

          {/* Table body */}
          {loading && transactions.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0",
              color:"var(--text-muted)" }}>
              <div className="spinner" style={{ margin:"0 auto 12px",
                width:32, height:32, borderWidth:3 }} />
              Fetching blockchain data...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0",
              color:"var(--text-muted)", fontSize:14 }}>
              {transactions.length === 0
                ? "No transactions yet — make a payment to see data here."
                : "No results match your current filters."}
            </div>
          ) : (
            <div style={{ overflow:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["#","Business","Product","Total SOL",
                      "Tax SOL","Net SOL","Rate",
                      "Payer","Time","🔍"].map(h => (
                      <th key={h} style={{ textAlign:"left",
                        padding:"8px 12px", fontSize:10,
                        fontFamily:"var(--font-mono)",
                        color:"var(--text-muted)",
                        borderBottom:`1px solid rgba(255,193,7,0.15)`,
                        letterSpacing:"0.06em",
                        whiteSpace:"nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx, i) => (
                    <tr key={tx.pda + i}
                      style={{ borderBottom:"1px solid var(--border)",
                        transition:"background 0.15s" }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.background =
                          "rgba(255,193,7,0.04)")}
                      onMouseLeave={e =>
                        (e.currentTarget.style.background = "transparent")}>

                      {/* Row number */}
                      <td style={{ ...td, color:"var(--text-muted)",
                        fontFamily:"var(--font-mono)", fontSize:11 }}>
                        {i + 1}
                      </td>

                      {/* Business */}
                      <td style={td}>
                        <div style={{ fontWeight:700, fontSize:13 }}>
                          {tx.businessName}
                        </div>
                        <div style={{ fontSize:10,
                          color:"var(--text-muted)",
                          fontFamily:"var(--font-mono)", marginTop:2 }}>
                          {shortenAddress(tx.businessOwner, 5)}
                        </div>
                      </td>

                      {/* Product */}
                      <td style={{ ...td, fontSize:13 }}>
                        {tx.product || "—"}
                      </td>

                      {/* Total */}
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)", fontSize:12 }}>
                        {lamportsToSol(tx.total).toFixed(4)}
                      </td>

                      {/* Tax — highlighted */}
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:13, color:GOLD, fontWeight:800 }}>
                        {lamportsToSol(tx.tax).toFixed(4)}
                      </td>

                      {/* Net */}
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:12, color:"var(--accent)" }}>
                        {lamportsToSol(tx.net).toFixed(4)}
                      </td>

                      {/* Rate badge */}
                      <td style={td}>
                        <span style={{ background:"rgba(255,193,7,0.12)",
                          color:GOLD, padding:"2px 8px",
                          borderRadius:4, fontSize:11,
                          fontFamily:"var(--font-mono)" }}>
                          {bpsToPercent(tx.taxRate)}%
                        </span>
                      </td>

                      {/* Payer */}
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:11, color:"var(--text-muted)" }}>
                        {shortenAddress(tx.payer, 5)}
                      </td>

                      {/* Time */}
                      <td style={{ ...td, fontSize:11,
                        color:"var(--text-muted)", whiteSpace:"nowrap" }}>
                        {formatTimestamp(tx.timestamp)}
                      </td>

                      {/* Explorer link */}
                      <td style={td}>
                        <a href={"https://explorer.solana.com/address/"
                          + tx.pda + "?cluster=devnet"}
                          target="_blank" rel="noreferrer"
                          style={{ color:GOLD, fontSize:14,
                            textDecoration:"none" }}>
                          🔍
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Totals footer */}
                {filtered.length > 1 && (
                  <tfoot>
                    <tr style={{ background:"rgba(255,193,7,0.06)",
                      borderTop:`1px solid ${GOLD}44` }}>
                      <td colSpan={3} style={{ ...td, fontWeight:800,
                        color:GOLD, fontSize:12,
                        fontFamily:"var(--font-mono)" }}>
                        TOTALS
                      </td>
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:12, fontWeight:700 }}>
                        {lamportsToSol(totalVolume).toFixed(4)}
                      </td>
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:13, color:GOLD, fontWeight:800 }}>
                        {lamportsToSol(totalTax).toFixed(4)}
                      </td>
                      <td style={{ ...td,
                        fontFamily:"var(--font-mono)",
                        fontSize:12, color:"var(--accent)",
                        fontWeight:700 }}>
                        {lamportsToSol(totalRevenue).toFixed(4)}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; }
          50%      { opacity:0.3; }
        }
        @keyframes slideUp {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </GovShell>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

const GOLD = "#ffc107";

function GovShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight:"100vh", background:"#07090f",
      color:"var(--text-primary)" }}>
      {children}
    </div>
  );
}

function GovTopBar({ publicKey, onRefresh, loading }: {
  publicKey: string; onRefresh: () => void; loading: boolean;
}) {
  return (
    <div style={{ borderBottom:`1px solid rgba(255,193,7,0.2)`,
      padding:"0 32px",
      background:"rgba(255,193,7,0.03)" }}>
      <div style={{ maxWidth:1200, margin:"0 auto",
        height:64, display:"flex",
        alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:26 }}>🏛</span>
          <div>
            <div style={{ fontWeight:800, fontSize:15,
              color:GOLD, letterSpacing:"0.08em" }}>
              GOVERNMENT TAX PORTAL
            </div>
            <div style={{ fontSize:10, color:"var(--text-muted)",
              fontFamily:"var(--font-mono)" }}>
              TAXCHAIN · SOLANA DEVNET · AUTHORIZED ACCESS
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:10, color:"var(--text-muted)",
              fontFamily:"var(--font-mono)" }}>
              GOVERNMENT WALLET
            </div>
            <div style={{ fontSize:12, color:GOLD,
              fontFamily:"var(--font-mono)", fontWeight:700 }}>
              {shortenAddress(publicKey, 8)}
            </div>
          </div>
          <BaseWalletMultiButton
  labels={{
    'change-wallet': 'Change wallet',
    connecting: 'Connecting...',
    'copy-address': 'Copy address',
    copied: 'Copied',
    disconnect: 'Disconnect',
    'has-wallet': 'Connect',
    'no-wallet': 'Select Wallet',
  }}
/>
        </div>
      </div>
    </div>
  );
}

function GovStat({ label, value, icon, sub, highlight }: {
  label: string; value: string; icon: string;
  sub?: string; highlight?: boolean;
}) {
  return (
    <div className="card" style={{
      borderColor: highlight ? `${GOLD}66` : "rgba(255,193,7,0.15)",
      background: highlight ? "rgba(255,193,7,0.04)" : "var(--bg-card)",
    }}>
      <div style={{ fontSize:26, marginBottom:8 }}>{icon}</div>
      <div style={{ fontSize:10, color:"var(--text-muted)",
        fontFamily:"var(--font-mono)", letterSpacing:"0.06em",
        marginBottom:4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize:20, fontWeight:800,
        color: highlight ? GOLD : GOLD,
        fontFamily:"var(--font-mono)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize:10, color:"var(--text-muted)",
          fontFamily:"var(--font-mono)", marginTop:4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display:"block", fontWeight:700, fontSize:10,
  color:"var(--text-secondary)", marginBottom:6,
  textTransform:"uppercase", letterSpacing:"0.05em",
};

const td: React.CSSProperties = {
  padding:"11px 12px", fontSize:13, verticalAlign:"middle",
};