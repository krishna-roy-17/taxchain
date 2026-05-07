import React, { useMemo, useState, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_ENDPOINT, DEMO_GOVERNMENT_WALLET } from "./utils/constants";
import { Header } from "./components/Header";
import { BusinessSetup } from "./components/BusinessSetup";
import { PaymentForm } from "./components/PaymentForm";
import { Dashboard } from "./components/Dashboard";
import { GovernmentDashboard } from "./components/GovernmentDashboard";
import { PaymentVerifier } from "./components/PaymentVerifier";
import { GovPortal } from "./components/GovPortal";
import { CustomerHistory } from "./components/CustomerHistory";

export type View =
  | "dashboard"
  | "pay"
  | "setup"
  | "government"
  | "verify"
  | "history"; // ← added

function AppInner() {
  const { publicKey } = useWallet();
  const [view, setView] = useState<View>("dashboard");

  const isGovWallet =
    publicKey?.toBase58() === DEMO_GOVERNMENT_WALLET.toBase58();

  useEffect(() => {
    if (!publicKey) {
      setView("dashboard");
    }
  }, [publicKey]);

  if (isGovWallet) {
    return <GovPortal />;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header view={view} setView={setView} />
      <main style={{ flex: 1, padding: "32px 0" }}>
        {view === "dashboard"  && <Dashboard setView={setView} />}
        {view === "setup"      && <BusinessSetup setView={setView} />}
        {view === "pay"        && <PaymentForm />}
        {view === "government" && <GovernmentDashboard />}
        {view === "verify"     && <PaymentVerifier />}
        {view === "history"    && <CustomerHistory />} {/* ← added */}
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Footer() {
  return (
    <footer style={{
      borderTop: "1px solid var(--border)",
      padding: "24px",
      textAlign: "center",
      color: "var(--text-muted)",
      fontSize: "13px",
      fontFamily: "var(--font-mono)",
    }}>
      Built on Solana for automatic tax splitting — © 2026 TaxPay. All rights reserved.
      Built by Krishna Roy, Rishav Shrestha, Swastika Timalasena.
    </footer>
  );
}