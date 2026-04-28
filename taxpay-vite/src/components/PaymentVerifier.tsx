import React, { useState } from "react";
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
  const { program } = useProgram();

  const [businessOwner, setBusinessOwner] = useState("");
  const [txIndex, setTxIndex] = useState("");
  const [record, setRecord] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!program) {
      setError("Connect your wallet first");
      return;
    }
    setError("");
    setRecord(null);
    setLoading(true);

    try {
      // Validate address
      let ownerPK: PublicKey;
      try {
        ownerPK = new PublicKey(businessOwner.trim());
      } catch {
        throw new Error("Invalid wallet address — must be a Solana public key");
      }

      // Validate index
      const idx = parseInt(txIndex, 10);
      if (isNaN(idx) || idx < 0) throw new Error("Transaction index must be 0 or higher");

      // Derive PDAs
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

      console.log("Fetching record at PDA:", recordPDA.toBase58());

      // Fetch the on-chain record
      const rec = await (program.account as any).taxRecord.fetch(recordPDA);
      setRecord({ ...rec, pda: recordPDA });
    } catch (e: any) {
      // Make the error message friendly
      const msg = e?.message || "Record not found";
      if (msg.includes("Account does not exist")) {
        setError(`No transaction #${txIndex} found for this business. Check the index.`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className="badge badge-green" style={{ marginBottom: 12 }}>
          🔍 BLOCKCHAIN VERIFICATION
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Verify Payment
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
          Anyone can verify any payment. No login needed — data lives on-chain forever.
        </p>
      </div>

      {/* Form */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
          Look Up by Business Owner + Transaction Index
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Business Owner Wallet Address</label>
            <input
              className="input mono-input"
              placeholder="e.g. 7xKX..."
              value={businessOwner}
              onChange={(e) => setBusinessOwner(e.target.value)}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              The wallet that registered the business (not the customer)
            </div>
          </div>

          <div>
            <label style={labelStyle}>Transaction Index</label>
            <input
              className="input"
              type="number"
              min="0"
              placeholder="0  (first payment = 0, second = 1, ...)"
              value={txIndex}
              onChange={(e) => setTxIndex(e.target.value)}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleVerify}
            disabled={loading || !businessOwner || txIndex === ""}
          >
            {loading
              ? <><span className="spinner" /> Fetching from Blockchain...</>
              : "🔍 Verify Payment"}
          </button>

          {error && (
            <div style={{
              background: "var(--red-dim)",
              border: "1px solid var(--red)",
              borderRadius: 8,
              padding: "12px 16px",
              color: "var(--red)",
              fontSize: 14,
            }}>
              ⚠ {error}
            </div>
          )}
        </div>
      </div>

      {/* Result */}
      {record && (
        <div className="card animate-slide-up">
          {/* Success banner */}
          <div style={{
            background: "var(--green-dim)",
            border: "1px solid var(--green)",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            <span style={{ fontSize: 28 }}>✅</span>
            <div>
              <div style={{ fontWeight: 800, color: "var(--green)", fontSize: 16 }}>
                Payment Verified — Immutable Record Found
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                This record is permanently stored on the Solana blockchain and cannot be altered.
              </div>
            </div>
          </div>

          {/* Details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Detail label="Product / Service" value={record.productName || "—"} />
            <Detail
              label="Timestamp"
              value={formatTimestamp(record.timestamp?.toNumber?.() || 0)}
            />
            <Detail
              label="Total Amount Paid"
              value={`${lamportsToSol(record.totalAmount.toNumber()).toFixed(6)} SOL`}
              color="var(--text-primary)"
              mono
            />
            <Detail
              label="Tax Sent to Government"
              value={`${lamportsToSol(record.taxAmount.toNumber()).toFixed(6)} SOL`}  // ✅ FIXED: was record.totalAmount
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
            <Detail
              label="Payer Address"
              value={record.payer.toBase58()}
              mono
            />
            <Detail
              label="Business Owner"
              value={record.businessOwner.toBase58()}
              mono
            />
            <Detail
              label="Government Wallet"
              value={record.governmentWallet.toBase58()}
              mono
            />
            {record.invoiceIpfsHash && record.invoiceIpfsHash !== "" && (
              <Detail label="Invoice IPFS Hash" value={record.invoiceIpfsHash} mono />
            )}
          </div>

          {/* PDA */}
          <div style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "var(--bg)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}>
            <div style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
              letterSpacing: "0.05em",
            }}>
              ON-CHAIN RECORD ADDRESS (Tax Record PDA)
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
            🔍 View Raw Account on Solana Explorer
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
      <div style={{
        fontSize: 11,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.05em",
        marginBottom: 4,
      }}>
        {label.toUpperCase()}
      </div>
      <div style={{
        fontWeight: 700,
        color: color || "var(--text-primary)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-display)",
        fontSize: 13,
        wordBreak: "break-all",
      }}>
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