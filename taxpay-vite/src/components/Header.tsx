import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { View } from "../App";
import { shortenAddress } from "../utils/constants";

interface HeaderProps {
  view: View;
  setView: (v: View) => void;
}

const NAV_ITEMS: { label: string; view: View; icon: string }[] = [
  { label: "Dashboard", view: "dashboard", icon: "◈" },
  { label: "Setup", view: "setup", icon: "⚙" },
  { label: "Pay", view: "pay", icon: "⚡" },
  { label: "Government", view: "government", icon: "🏛" },
  { label: "Verify", view: "verify", icon: "✓" },
];

export function Header({ view, setView }: HeaderProps) {
  const { publicKey } = useWallet();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(10,10,15,0.85)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 68,
          gap: 16,
        }}
      >
        {/* Logo */}
        <button
          onClick={() => setView("dashboard")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              background: "var(--accent)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              boxShadow: "0 0 20px var(--accent-glow)",
            }}
          >
            ₿
          </div>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 20,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            TAX<span style={{ color: "var(--accent)" }}>PAY</span>
          </span>
        </button>

        {/* Nav */}
        <nav style={{ display: "flex", gap: 4 }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              onClick={() => setView(item.view)}
              style={{
                background: view === item.view ? "var(--accent-dim)" : "none",
                border:
                  view === item.view
                    ? "1px solid var(--accent)"
                    : "1px solid transparent",
                borderRadius: 8,
                padding: "6px 14px",
                color:
                  view === item.view
                    ? "var(--accent)"
                    : "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 14,
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {publicKey && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--green)",
                background: "var(--green-dim)",
                padding: "4px 10px",
                borderRadius: 6,
              }}
            >
              ● {shortenAddress(publicKey.toBase58())}
            </span>
          )}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}