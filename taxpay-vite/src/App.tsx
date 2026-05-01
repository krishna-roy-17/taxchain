import React, { useMemo, useState } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { RPC_ENDPOINT } from "./utils/constants";
import { Header } from "./components/Header";
import { BusinessSetup } from "./components/BusinessSetup";
import { PaymentForm } from "./components/PaymentForm";
import { Dashboard } from "./components/Dashboard";
import { GovernmentDashboard } from "./components/GovernmentDashboard";
import { PaymentVerifier } from "./components/PaymentVerifier";

export type View =
  | "dashboard"
  | "pay"
  | "setup"
  | "government"
  | "verify";

export default function App() {
  const [view, setView] = useState<View>("dashboard");

  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <Header view={view} setView={setView} />
            <main style={{ flex: 1, padding: "32px 0" }}>
              {view === "dashboard" && <Dashboard setView={setView} />}
              {view === "setup" && <BusinessSetup setView={setView} />}
              {view === "pay" && <PaymentForm />}
              {view === "government" && <GovernmentDashboard />}
              {view === "verify" && <PaymentVerifier />}
            </main>
            <Footer />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "24px",
        textAlign: "center",
        color: "var(--text-muted)",
        fontSize: "13px",
        fontFamily: "var(--font-mono)",
      }}
    >
      Built on Solana for automatic tax splitting — © 2026 TaxPay. All rights reserved. Built by Krishna Roy,Rishav Shrestha,Swastika Timalsina.


    </footer>
  );
}