import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileBarChart,
  Pill,
  Settings2,
  ShieldCheck,
  UsersRound,
  Receipt,
} from "lucide-react";
import { useState } from "react";
import type { AppSection } from "./types";
import { POSBilling } from "./components/pos/POSBilling";
import { InventoryPage } from "./components/inventory/InventoryPage";
import { PurchasesPage } from "./components/purchases/PurchasesPage";
import { SuppliersPage } from "./components/purchases/SuppliersPage";
import "./components/workspace/workspace.css";

type UnavailableSectionId = Exclude<
  AppSection,
  "pos" | "inventory" | "purchases" | "suppliers"
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
  reports: {
    title: "Reports",
    description: "Sales reporting is not part of the current billing slice.",
    icon: FileBarChart,
  },
  settings: {
    title: "Settings",
    description: "Pharmacy and printer settings are not part of the current billing slice.",
    icon: Settings2,
  },
};

function UnavailableSection({ section }: { section: UnavailableSectionId }) {
  const details = sectionDetails[section];
  const Icon = details.icon;

  return (
    <section className="section-unavailable" data-testid={`panel-${section}`}>
      <div className="section-unavailable-icon"><Icon size={24} /></div>
      <span className="eyebrow">PHARMACY WORKSPACE</span>
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

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <span className="brand-symbol"><Pill size={20} /></span>
          <span className="brand-text">
            <strong>PHARMA<span>DESK</span></strong>
            <small>OFFLINE PHARMACY POS</small>
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
        {activeSection === "pos" ? (
          <POSBilling />
        ) : activeSection === "inventory" ? (
          <InventoryPage />
        ) : activeSection === "purchases" ? (
          <PurchasesPage />
        ) : activeSection === "suppliers" ? (
          <SuppliersPage />
        ) : (
          <UnavailableSection section={activeSection} />
        )}
      </main>
    </div>
  );
}