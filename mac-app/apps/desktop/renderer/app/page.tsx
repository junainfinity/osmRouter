"use client";
import { useEffect } from "react";
import { useApp } from "@/store/app-store";
import { Sidebar } from "@/components/Sidebar";
import { HeaderBar } from "@/components/HeaderBar";
import { DomainsView } from "@/components/DomainsView";
import { CloudDomainsView } from "@/components/CloudDomainsView";
import { ServicesView } from "@/components/ServicesView";
import { Inspector } from "@/components/Inspector";
import { SettingsView } from "@/components/Settings";
import { SignInModal } from "@/components/SignInModal";

export default function Home() {
  const { tab, setDomains, patchDomain, pushRequest, setNetwork, setAuth, network, signInModalOpen, closeSignInModal } = useApp();

  useEffect(() => {
    if (!window.osmAPI) return;
    void (async () => {
      const { domains } = await window.osmAPI!.domains.list();
      setDomains(domains);
      const a = await window.osmAPI!.auth.status();
      setAuth(a.signedIn, a.email ?? null);
    })();

    const offStatus = window.osmAPI.events.onTunnelStatusUpdate((p) => {
      patchDomain(p.domainId, { status: p.status as never, error: p.error ?? null });
    });
    const offReq = window.osmAPI.events.onRequestObserved((p) => {
      pushRequest(p);
    });
    const offNet = window.osmAPI.events.onNetworkStateChange((p) => {
      setNetwork(p.state as never);
    });
    const offAuth = window.osmAPI.events.onAuthStateChange((p) => {
      setAuth(p.signedIn, p.email ?? null);
    });
    return () => {
      offStatus();
      offReq();
      offNet();
      offAuth();
    };
  }, [setDomains, patchDomain, pushRequest, setNetwork, setAuth]);

  return (
    <div style={{ display: "flex", minHeight: 0, minWidth: 0, width: "100vw", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
        <HeaderBar />
        {network !== "connected" && (
          <div
            data-testid="connection-banner"
            style={{
              padding: "8px 16px",
              background: network === "offline" ? "var(--error-soft)" : "var(--info-soft)",
              borderBottom: "1px solid var(--border)",
              fontSize: 12,
              color: network === "offline" ? "var(--error)" : "var(--info)",
            }}
          >
            {network === "offline" ? "Offline — tunnels will resume when network returns." : `Network ${network}…`}
          </div>
        )}
        {tab === "services" && <ServicesView />}
        {tab === "domains" && <CloudDomainsView />}
        {tab === "inspector" && <Inspector />}
        {tab === "settings" && <SettingsView />}
      </div>
      <SignInModal
        open={signInModalOpen}
        onClose={closeSignInModal}
        onSignedIn={(email) => setAuth(true, email)}
      />
    </div>
  );
}
