import React, { useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useProgram } from "../hooks/useProgram";
import {
  lamportsToSol,
  formatTimestamp,
  shortenAddress,
  bpsToPercent,
  PROGRAM_ID,
  TAX_RECORD_SEED,
  BUSINESS_SEED,
} from "../utils/constants";

export function PaymentVerifier() {
  const { connection } = useConnection();
  const { program } = useProgram();

  const [txSig, setTxSig] = useState("");
  const [businessOwner, setBusinessOwner] = useState("");
  const [txIndex, setTxIndex] = useState("");
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerifyByPDA = async () => {
   if (!program) {
  setError("Wallet not connected or program not ready");
  return;
}
    setError("");
    setLoading(true);
    try {
      let ownerPK: PublicKey;
try {
  ownerPK = new PublicKey(businessOwner.trim());
} catch {
  throw new Error("Invalid wallet address");
}
      const idx = parseInt(txIndex, 10);
      if (isNaN(idx) || idx < 0) throw new Error("Invalid transaction index");

      const [businessPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from(BUSINESS_SEED), ownerPK.toBuffer()],
        PROGRAM_ID
      );

      const [recordPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from(TAX_RECORD_SEED),
          businessPDA.toBuffer(),
          new BN(idx).toArrayLike(Buffer, "le", 8),
        ],
        PROGRAM_ID
      );

      const rec = await program.account.taxRecord.fetch(recordPDA);
      setRecord({ ...rec, pda: recordPDA });
    } catch (e: any) {
      setError(e?.message || "Record not found");
      setRecord(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="badge badge-green" style={{ marginBottom: 12 }}>
          🔍 BLOCKCHAIN VERIFICATION
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Verify Payment
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
          Anyone can verify any payment. Enter the business owner address and transaction index to confirm payment + tax were paid.
        </p>
      </div>

      {/* Lookup form */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
          Look Up by Business + Transaction Index
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Business Owner Wallet</label>
            <input
              className="input mono-input"
              placeholder="Solana public key of business owner"
              value={businessOwner}
              onChange={(e) => setBusinessOwner(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Transaction Index (starts at 0)</label>
            <input
              className="input"
              type="number"
              min="0"
              placeholder="0"
              value={txIndex}
              onChange={(e) => setTxIndex(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleVerifyByPDA}
            disabled={loading || !businessOwner || txIndex === ""}
          >
            {loading ? <><span className="spinner" /> Verifying on Blockchain...</> : "🔍 Verify Payment"}
          </button>
          {error && (
            <div style={{ color: "var(--red)", fontSize: 14 }}>⚠ {error}</div>
          )}
        </div>
      </div>

      {/* Result */}
      {record && (
        <div className="card animate-slide-up">
          {/* Verified banner */}
          <div
            style={{
              background: "var(--green-dim)",
              border: "1px solid var(--green)",
              borderRadius: 10,
              padding: "14px 18px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 28 }}>✅</span>
            <div>
              <div style={{ fontWeight: 800, color: "var(--green)", fontSize: 16 }}>
                Payment Verified — Immutable Record Found
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                This payment is permanently recorded on the Solana blockchain.
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Detail label="Product / Service" value={record.productName || "—"} />
            <Detail label="Timestamp" value={formatTimestamp(record.timestamp?.toNumber?.() || 0)} />
            <Detail
              label="Total Amount Paid"
              value={`${lamportsToSol(record.totalAmount.toNumber()).toFixed(6)} SOL`}
              color="var(--text-primary)"
              mono
            />
            <Detail
              label="Tax Sent to Government"
              value={`${lamportsToSol(record.totalAmount?.toNumber?.() || 0)} SOL`}
              color="var(--yellow)"
              mono
            />
            <Detail
              label="Net to Business"
              value={`${lamportsToSol(record.netAmount.toNumber()).toFixed(6)} SOL`}
              color="var(--accent)"
              mono
            />
            <Detail
              label="Tax Rate Applied"
              value={`${bpsToPercent(record.taxRateBps.toNumber())}%`}
            />
            <Detail label="Payer Address" value={shortenAddress(record.payer.toBase58(), 8)} mono />
            <Detail label="Business Owner" value={shortenAddress(record.businessOwner.toBase58(), 8)} mono />
            <Detail label="Government Wallet" value={shortenAddress(record.governmentWallet.toBase58(), 8)} mono />
            {record.invoiceIpfsHash && (
              <Detail label="Invoice IPFS" value={record.invoiceIpfsHash} mono />
            )}
          </div>

          {/* PDA address */}
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "var(--bg)",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
              RECORD PDA ADDRESS (immutable on-chain account)
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>
              {record.pda.toBase58()}
            </div>
          </div>

          <a
            href={`https://explorer.solana.com/address/${record.pda.toBase58()}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ marginTop: 16, display: "inline-flex" }}
          >
            🔍 View on Solana Explorer
          </a>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  color,
  mono,
}: {
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontWeight: 700,
          color: color || "var(--text-primary)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-display)",
          fontSize: 14,
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
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