import { openUrl } from "@tauri-apps/plugin-opener";
import { Building2, CircleAlert, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteSupplier, getSuppliers, saveSupplier } from "../../services/supplierService";
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
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

  async function handleDeleteSupplier() {
    if (!supplierToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteSupplier(supplierToDelete.id);
      setNotice(`${supplierToDelete.name} was removed. Purchase records remain saved.`);
      setSupplierToDelete(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }

  async function openWhatsApp(supplier: Supplier) {
    const phone = supplier.whatsapp_phone || supplier.phone || "";
    const digits = phone.replace(/\D/g, "");
    if (!digits) {
      setNotice("Add a WhatsApp number or phone number to this supplier first.");
      return;
    }
    try {
      await openUrl(`https://wa.me/${digits}`);
      setNotice("WhatsApp opened. If it is unavailable, use the saved number shown in this supplier record.");
    } catch {
      setNotice(`WhatsApp could not be opened. Use this saved number instead: ${phone}`);
    }
  }

  async function openPhone(supplier: Supplier) {
    if (!supplier.phone) return;
    try {
      await openUrl(`tel:${encodeURIComponent(supplier.phone)}`);
    } catch {
      setNotice(`Calling is unavailable. Use this saved number instead: ${supplier.phone}`);
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
          <div className="inventory-search supplier-search">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search suppliers"
              data-testid="input-supplier-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name, contact, phone, WhatsApp, or address"
              value={searchQuery}
            />
            {searchQuery.length > 0 && (
              <button
                aria-label="Clear supplier search"
                className="supplier-search-clear"
                data-testid="button-clear-supplier-search"
                onClick={() => setSearchQuery("")}
                title="Clear search"
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>
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
                    {supplier.contact_person && <span><UserRound size={13} /> {supplier.contact_person}</span>}
                    {supplier.phone && <span><Phone size={13} /> {supplier.phone}</span>}
                    {supplier.whatsapp_phone && <span><MessageCircle size={13} /> WhatsApp: {supplier.whatsapp_phone}</span>}
                    {supplier.address && <span><MapPin size={13} /> {supplier.address}</span>}
                    {supplier.notes && <span className="supplier-notes">{supplier.notes}</span>}
                    {!supplier.contact_person && !supplier.phone && !supplier.whatsapp_phone && !supplier.address && !supplier.notes && <span className="workspace-muted">No contact details added</span>}
                  </div>
                </div>
                <div className="supplier-balance">
                  <span>Balance due</span>
                  <strong>{formatMoney(supplier.balance_due)}</strong>
                </div>
                <div className="supplier-row-actions">
                  {supplier.phone && (
                    <a aria-label={`Call ${supplier.name}`} className="supplier-contact-action" href={`tel:${encodeURIComponent(supplier.phone)}`} onClick={(event) => { event.preventDefault(); void openPhone(supplier); }} title={`Call ${supplier.phone}`}>
                      <Phone size={14} /><span>Call</span>
                    </a>
                  )}
                  <button className="supplier-contact-action" data-testid={`button-whatsapp-supplier-${supplier.id}`} onClick={() => void openWhatsApp(supplier)} type="button">
                    <MessageCircle size={14} /><span>WhatsApp</span>
                  </button>
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
                  <button
                    aria-label={`Delete ${supplier.name}`}
                    className="icon-button supplier-delete-button"
                    onClick={() => {
                      setDeleteError(null);
                      setSupplierToDelete(supplier);
                    }}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
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

      {supplierToDelete && (
        <div className="inventory-dialog-backdrop" data-testid="dialog-delete-supplier">
          <section aria-describedby="delete-supplier-description" aria-labelledby="delete-supplier-title" aria-modal="true" className="workspace-dialog workspace-dialog--narrow" role="alertdialog">
            <header className="dialog-header">
              <div>
                <span className="eyebrow">SUPPLIER RECORD</span>
                <h2 id="delete-supplier-title">Delete {supplierToDelete.name}?</h2>
                <p id="delete-supplier-description">Past purchases will remain saved, but this supplier will no longer be linked to them or order-list items.</p>
              </div>
              <button aria-label="Close delete confirmation" className="icon-button" disabled={isDeleting} onClick={() => setSupplierToDelete(null)} type="button"><X size={18} /></button>
            </header>
            {deleteError && <p className="workspace-error" role="alert">{deleteError}</p>}
            <footer className="dialog-actions">
              <button className="button button-secondary" disabled={isDeleting} onClick={() => setSupplierToDelete(null)} type="button">Cancel</button>
              <button className="button button-danger" data-testid="button-confirm-delete-supplier" disabled={isDeleting} onClick={() => void handleDeleteSupplier()} type="button">
                {isDeleting ? "Deleting…" : "Delete supplier"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}