import {
  AlertCircle,
  BarChart3,
  Boxes,
  ClipboardList,
  House,
  Pill,
  Settings2,
  ShieldCheck,
  UsersRound,
  Receipt,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useCallback } from "react";
import type { AppSection } from "./types";
import { POSBilling } from "./components/pos/POSBilling";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { OrderListPage } from "./components/orders/OrderListPage";
import { InventoryPage } from "./components/inventory/InventoryPage";
import { PurchasesPage } from "./components/purchases/PurchasesPage";
import { SuppliersPage } from "./components/purchases/SuppliersPage";
import { CustomersPage } from "./components/customers/CustomersPage";
import { SalesPage } from "./components/sales/SalesPage";
import { ReportsView } from "./components/reports/ReportsView";
import { StoreSettings } from "./components/settings/StoreSettings";
import "./components/workspace/workspace.css";

const navigation: Array<{
  id: AppSection;
  label: string;
  icon: typeof Pill;
}> = [
  { id: "home", label: "Home", icon: House },
  { id: "pos", label: "POS Billing", icon: ClipboardList },
  { id: "orders", label: "Today's Order List", icon: ClipboardList },
  { id: "inventory", label: "Inventory & Batches", icon: Boxes },
  { id: "purchases", label: "Purchases", icon: Pill },
  { id: "suppliers", label: "Suppliers", icon: UsersRound },
  { id: "customers", label: "Customers & credit", icon: UsersRound },
  { id: "sales", label: "Sales", icon: Receipt },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("home");
  const [pendingSaleSearch, setPendingSaleSearch] = useState<string | null>(null);
  const [pendingCustomerLedgerId, setPendingCustomerLedgerId] = useState<number | null>(null);
  const [autoBackupError, setAutoBackupError] = useState<string | null>(null);
  const navigateToSection = useCallback(
    (section: AppSection, initialSaleSearch?: string) => {
      setPendingSaleSearch(initialSaleSearch?.trim() || null);
      setActiveSection(section);
    },
    [],
  );
  const clearPendingSaleSearch = useCallback(() => {
    setPendingSaleSearch(null);
  }, []);
  const openCustomerLedger = useCallback((customerId: number) => {
    setPendingCustomerLedgerId(customerId);
    setActiveSection("customers");
  }, []);
  const clearPendingCustomerLedger = useCallback(() => {
    setPendingCustomerLedgerId(null);
  }, []);

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
    <div className={`app-shell ${activeSection === "home" ? "app-shell--home" : ""}`}>
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
              onClick={() => {
                setPendingSaleSearch(null);
                setActiveSection(id);
              }}
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
        {activeSection !== "home" && (
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
        )}
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
        {activeSection === "home" ? (
          <DashboardPage onNavigate={navigateToSection} />
        ) : activeSection === "pos" ? (
          <POSBilling
            initialSearchQuery={pendingSaleSearch ?? undefined}
            onInitialSearchConsumed={clearPendingSaleSearch}
          />
        ) : activeSection === "orders" ? (
          <OrderListPage onNavigateToSuppliers={() => navigateToSection("suppliers")} />
        ) : activeSection === "inventory" ? (
          <InventoryPage />
        ) : activeSection === "purchases" ? (
          <PurchasesPage />
        ) : activeSection === "suppliers" ? (
          <SuppliersPage />
        ) : activeSection === "customers" ? (
          <CustomersPage
            initialCustomerId={pendingCustomerLedgerId}
            onInitialCustomerConsumed={clearPendingCustomerLedger}
          />
        ) : activeSection === "sales" ? (
          <SalesPage />
        ) : activeSection === "reports" ? (
          <ReportsView onOpenCustomerLedger={openCustomerLedger} />
        ) : activeSection === "settings" ? (
          <StoreSettings
            onDatabaseRestored={() => {
              window.setTimeout(() => window.location.reload(), 1500);
            }}
          />
        ) : (
          null
        )}
      </main>
    </div>
  );
}