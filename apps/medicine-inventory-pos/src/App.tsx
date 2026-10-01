import {
  AlertCircle,
  BarChart3,
  Boxes,
  ClipboardList,
  Pill,
  Settings2,
  ShieldCheck,
  UsersRound,
  Receipt,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { AppSection } from "./types";
import { POSBilling } from "./components/pos/POSBilling";
import { InventoryPage } from "./components/inventory/InventoryPage";
import { PurchasesPage } from "./components/purchases/PurchasesPage";
import { SuppliersPage } from "./components/purchases/SuppliersPage";
import { ReportsView } from "./components/reports/ReportsView";
import { StoreSettings } from "./components/settings/StoreSettings";
import "./components/workspace/workspace.css";

type UnavailableSectionId = Exclude<
  AppSection,
  "pos" | "inventory" | "purchases" | "suppliers" | "reports" | "settings"
>;

const navigation: Array<{
  id: AppSection;
  label: string;
  icon: typeof Pill;
}> = [
  { id: "pos", label: "POS Billing", icon: ClipboardList },
  { id: "inventory", label: "Inventory & Batches", icon: Boxes },
  { id: "purchases", label: "Purchases", icon: Pill },
  { id: "suppliers", label: "Suppliers", icon: UsersRound },
  { id: "sales", label: "Sales", icon: Receipt },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const sectionDetails: Record<
  UnavailableSectionId,
  { title: string; description: string; icon: typeof Pill }
> = {
  sales: {
    title: "Sales",
    description: "Open recent invoices from the POS Billing screen.",
    icon: ClipboardList,
  },
};

function UnavailableSection({ section }: { section: UnavailableSectionId }) {
  const details = sectionDetails[section];
  const Icon = details.icon;

  return (
    <section className="section-unavailable" data-testid={`panel-${section}`}>
      <div className="section-unavailable-icon"><Icon size={24} /></div>
      <span className="eyebrow">MY MEDICAL WORKSPACE</span>
      <h1>{details.title}</h1>
      <p>{details.description}</p>
      <div className="section-unavailable-note">
        <ShieldCheck size={16} />
        <span>Sales and stock records continue to be stored locally on this device.</span>
      </div>
    </section>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("pos");
  const [autoBackupError, setAutoBackupError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>("pharmadesk:auto-backup-failed", (event) => {
      setAutoBackupError(event.payload);
    })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          unlisten = unsubscribe;
        }
      })
      .catch(() => {
        // The page may also be opened outside the Tauri window during development.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <span className="brand-symbol">
            <img src="./my-medical-mark.png" alt="" aria-hidden="true" />
          </span>
          <span className="brand-text">
            <strong>MY <span>MEDICAL</span></strong>
            <small>PHARMACY MANAGEMENT</small>
          </span>
        </div>

        <div className="sidebar-caption">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              aria-current={activeSection === id ? "page" : undefined}
              className={`nav-item ${activeSection === id ? "is-active" : ""}`}
              data-testid={`nav-${id}`}
              key={id}
              onClick={() => setActiveSection(id)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
              <span>{label}</span>
              {activeSection === id && <span className="nav-active-marker" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-privacy">
          <span className="privacy-icon"><ShieldCheck size={16} /></span>
          <span>
            <strong>Private by design</strong>
            <small>Your data stays on this device</small>
          </span>
        </div>
        <div className="sidebar-version">
          <span className="sidebar-status-dot" />
          Offline mode active
        </div>
      </aside>

      <main className="app-main">
        <div className="app-topbar">
          <div className="topbar-crumb">
            <span>Pharmacy</span>
            <span className="crumb-divider">/</span>
            <strong>{navigation.find((item) => item.id === activeSection)?.label ?? "POS Billing"}</strong>
          </div>
          <div className="topbar-status">
            <span className="topbar-offline-dot" />
            Local database
          </div>
        </div>
        {autoBackupError && (
          <div className="auto-backup-alert" role="alert" data-testid="status-auto-backup-error">
            <AlertCircle aria-hidden="true" size={17} />
            <div>
              <strong>Automatic backup failed. The app remains open.</strong>
              <span>{autoBackupError}</span>
            </div>
            <button
              className="button button-secondary"
              data-testid="button-open-backup-settings"
              onClick={() => {
                setActiveSection("settings");
                setAutoBackupError(null);
              }}
              type="button"
            >
              Open backup settings
            </button>
            <button
              aria-label="Dismiss automatic backup error"
              className="icon-button"
              onClick={() => setAutoBackupError(null)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {activeSection === "pos" ? (
          <POSBilling />
        ) : activeSection === "inventory" ? (
          <InventoryPage />
        ) : activeSection === "purchases" ? (
          <PurchasesPage />
        ) : activeSection === "suppliers" ? (
          <SuppliersPage />
        ) : activeSection === "reports" ? (
          <ReportsView />
        ) : activeSection === "settings" ? (
          <StoreSettings
            onDatabaseRestored={() => {
              window.setTimeout(() => window.location.reload(), 500);
            }}
          />
        ) : (
          <UnavailableSection section={activeSection} />
        )}
      </main>
    </div>
  );
}