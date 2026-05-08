import React, { useState } from "react";
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
  { label: "Setup",     view: "setup",     icon: "⚙" },
  { label: "Pay",       view: "pay",       icon: "⚡" },
  { label: "Government",view: "government",icon: "🏛" },
  { label: "Verify",    view: "verify",    icon: "✓" },
  { label: "History",   view: "history",   icon: "🧾" },
];

export function Header({ view, setView }: HeaderProps) {
  const { publicKey } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNav = (v: View) => {
    setView(v);
    setMenuOpen(false);
  };

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "rgba(10,10,15,0.85)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--border)",
          padding: "0 var(--page-padding)",
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
            gap: 12,
          }}
        >
          {/* Logo */}
          <button
            onClick={() => handleNav("dashboard")}
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
            <img
              src="/favicon.png"
              alt="TaxPay Logo"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                objectFit: "contain",
                boxShadow: "0 0 20px var(--accent-glow)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 18,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              TAX<span style={{ color: "var(--accent)" }}>CHAIN</span>
            </span>
          </button>

          {/* Desktop Nav */}
          <nav className="nav-desktop" style={{ gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.view}
                onClick={() => handleNav(item.view)}
                style={{
                  background: view === item.view ? "var(--accent-dim)" : "none",
                  border: view === item.view ? "1px solid var(--accent)" : "1px solid transparent",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: view === item.view ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 13,
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Right side */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {publicKey && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--green)",
                  background: "var(--green-dim)",
                  padding: "4px 8px",
                  borderRadius: 6,
                  display: "none", // hidden on very small, shown via media in CSS below
                }}
                className="wallet-badge"
              >
                ● {shortenAddress(publicKey.toBase58())}
              </span>
            )}
            <WalletMultiButton />
            {/* Hamburger */}
            <button
              className="mobile-menu-btn"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {menuOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      <div className={`mobile-menu${menuOpen ? " open" : ""}`}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            onClick={() => handleNav(item.view)}
            style={{
              background: view === item.view ? "var(--accent-dim)" : "none",
              border: view === item.view ? "1px solid var(--accent)" : "1px solid transparent",
              borderRadius: 8,
              padding: "10px 14px",
              color: view === item.view ? "var(--accent)" : "var(--text-secondary)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 14,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
            }}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
        {publicKey && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--green)",
              background: "var(--green-dim)",
              borderRadius: 8,
              wordBreak: "break-all",
            }}
          >
            ● {publicKey.toBase58()}
          </div>
        )}
      </div>

      <style>{`
        @media (min-width: 901px) {
          .wallet-badge { display: inline !important; }
        }
      `}</style>
    </>
  );
}