import { Building2, CircleAlert, MapPin, Pencil, Phone, Plus, Search, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getSuppliers, saveSupplier } from "../../services/supplierService";
import type { Supplier, SupplierFormValues } from "../../types";
import { formatMoney } from "../../utils/money";
import { SupplierFormDialog } from "./SupplierFormDialog";
import "./purchases.css";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The supplier action could not be completed.";
}

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogSupplier, setDialogSupplier] = useState<Supplier | null | undefined>(undefined);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void getSuppliers(searchQuery)
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, refreshKey]);

  async function handleSave(values: SupplierFormValues) {
    setIsSaving(true);
    setDialogError(null);
    try {
      await saveSupplier(values, dialogSupplier?.id);
      setNotice(`${values.name.trim()} was ${dialogSupplier ? "updated" : "added"}.`);
      setDialogSupplier(undefined);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="workspace-page suppliers-page" data-testid="page-suppliers">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> SUPPLIER DIRECTORY</div>
          <h1>Suppliers</h1>
          <p>Keep supplier contact details ready for stock-in invoices.</p>
        </div>
        <button
          className="button button-primary"
          data-testid="button-add-supplier"
          onClick={() => {
            setDialogError(null);
            setDialogSupplier(null);
          }}
          type="button"
        >
          <Plus size={16} /> Add supplier
        </button>
      </header>

      {notice && (
        <div className="workspace-notice workspace-notice--success" role="status">
          <UsersRound size={16} />
          <span>{notice}</span>
          <button aria-label="Dismiss notice" className="notice-close" onClick={() => setNotice(null)} type="button">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="workspace-card supplier-card">
        <div className="supplier-toolbar">
          <div>
            <h2>Supplier records</h2>
            <p>{suppliers.length} supplier{suppliers.length === 1 ? "" : "s"}</p>
          </div>
          <label className="inventory-search supplier-search">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search suppliers"
              data-testid="input-supplier-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name, phone, or address"
              value={searchQuery}
            />
          </label>
        </div>
        {loadError && (
          <div className="workspace-error workspace-error--banner" role="alert">
            <CircleAlert size={16} /> {loadError}
          </div>
        )}
        {isLoading ? (
          <div className="workspace-empty">Loading suppliers…</div>
        ) : suppliers.length === 0 ? (
          <div className="workspace-empty">
            <UsersRound size={26} />
            <strong>{searchQuery ? "No suppliers match this search" : "No suppliers yet"}</strong>
            <span>{searchQuery ? "Try a different search term." : "Add a supplier to use it on purchase invoices."}</span>
            {!searchQuery && (
              <button className="button button-secondary" onClick={() => setDialogSupplier(null)} type="button">
                <Plus size={15} /> Add first supplier
              </button>
            )}
          </div>
        ) : (
          <div className="supplier-list">
            {suppliers.map((supplier) => (
              <article className="supplier-row" key={supplier.id} data-testid={`row-supplier-${supplier.id}`}>
                <span className="supplier-avatar"><Building2 size={19} /></span>
                <div className="supplier-main">
                  <strong>{supplier.name}</strong>
                  <div className="supplier-contact">
                    {supplier.phone && <span><Phone size={13} /> {supplier.phone}</span>}
                    {supplier.address && <span><MapPin size={13} /> {supplier.address}</span>}
                    {!supplier.phone && !supplier.address && <span className="workspace-muted">No contact details added</span>}
                  </div>
                </div>
                <div className="supplier-balance">
                  <span>Balance due</span>
                  <strong>{formatMoney(supplier.balance_due)}</strong>
                </div>
                <button
                  aria-label={`Edit ${supplier.name}`}
                  className="icon-button"
                  onClick={() => {
                    setDialogError(null);
                    setDialogSupplier(supplier);
                  }}
                  type="button"
                >
                  <Pencil size={15} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {dialogSupplier !== undefined && (
        <SupplierFormDialog
          error={dialogError}
          isSaving={isSaving}
          onClose={() => {
            setDialogSupplier(undefined);
            setDialogError(null);
          }}
          onSave={(values) => void handleSave(values)}
          supplier={dialogSupplier}
        />
      )}
    </section>
  );
}