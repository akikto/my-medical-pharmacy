import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Building2, CircleAlert, CreditCard, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2, UserRound, UsersRound, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteSupplier, getSuppliers, saveSupplier } from "../../services/supplierService";
import { getSupplierLedger, recordSupplierPayment } from "../../services/purchaseService";
import type { Supplier, SupplierFormValues, SupplierLedger, SupplierPaymentInput } from "../../types";
import { formatDateTime, formatMoney } from "../../utils/money";
import { SupplierFormDialog } from "./SupplierFormDialog";
import "./purchases.css";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The supplier action could not be completed.";
}

function localToday(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
  const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null);
  const [ledger, setLedger] = useState<SupplierLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0);
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentDate, setPaymentDate] = useState(localToday);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SupplierPaymentInput["payment_method"]>("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

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

  useEffect(() => {
    if (!ledgerSupplier) return;
    let cancelled = false;
    setLedgerLoading(true);
    setLedgerError(null);
    void getSupplierLedger(ledgerSupplier.id, {
      fromDate: ledgerFrom || null,
      toDate: ledgerTo || null,
      searchTerm: ledgerSearch,
    }).then((result) => {
      if (!cancelled) setLedger(result);
    }).catch((error: unknown) => {
      if (!cancelled) setLedgerError(getErrorMessage(error));
    }).finally(() => {
      if (!cancelled) setLedgerLoading(false);
    });
    return () => { cancelled = true; };
  }, [ledgerSupplier, ledgerFrom, ledgerTo, ledgerSearch, ledgerRefreshKey]);

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

  function openLedger(supplier: Supplier) {
    setLedgerSupplier(supplier);
    setLedger(null);
    setLedgerFrom("");
    setLedgerTo("");
    setLedgerSearch("");
    setLedgerError(null);
  }

  function openPayment(supplier: Supplier) {
    setPaymentSupplier(supplier);
    setPaymentDate(localToday());
    setPaymentAmount("");
    setPaymentMethod("CASH");
    setPaymentReference("");
    setPaymentNote("");
    setPaymentError(null);
  }

  async function handlePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentSupplier) return;
    setIsPaying(true);
    setPaymentError(null);
    try {
      const result = await recordSupplierPayment({
        supplier_id: paymentSupplier.id,
        payment_date: paymentDate,
        amount: Number(paymentAmount),
        payment_method: paymentMethod,
        transaction_reference: paymentReference,
        note: paymentNote,
      });
      setNotice(`Payment of ${formatMoney(Number(paymentAmount))} recorded for ${paymentSupplier.name}. Balance is now ${formatMoney(result.balanceDueCents / 100)}.`);
      setPaymentSupplier(null);
      setRefreshKey((current) => current + 1);
      setLedgerRefreshKey((current) => current + 1);
    } catch (error) {
      setPaymentError(getErrorMessage(error));
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <section className="workspace-page suppliers-page" data-testid="page-suppliers">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> SUPPLIER DIRECTORY</div>
          <h1>Suppliers</h1>
          <p>Supplier contacts, outstanding balances, and a clear record of every payment.</p>
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
            <button className="button button-secondary" onClick={() => setRefreshKey((current) => current + 1)} type="button">Retry</button>
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
                  <small>{supplier.balance_due > 0 ? "Outstanding" : supplier.balance_due < 0 ? "Credit balance" : "Settled"}</small>
                </div>
                <div className="supplier-row-actions">
                  <button className="supplier-contact-action" onClick={() => openLedger(supplier)} type="button"><BookOpen size={14} /><span>Ledger</span></button>
                  <button className="supplier-contact-action supplier-payment-action" onClick={() => openPayment(supplier)} type="button"><CreditCard size={14} /><span>Payment</span></button>
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

      {ledgerSupplier && (
        <div className="dialog-backdrop inventory-dialog-backdrop purchase-detail-backdrop">
          <section aria-labelledby="supplier-ledger-title" aria-modal="true" className="workspace-dialog supplier-ledger-dialog" role="dialog">
            <header className="purchase-detail-top">
              <div className="purchase-detail-top-icon"><BookOpen size={19} /></div>
              <div className="purchase-detail-title-wrap">
                <span className="eyebrow">SUPPLIER ACCOUNT</span>
                <h2 id="supplier-ledger-title">{ledgerSupplier.name}</h2>
                <p>Ledger · Opening balance {formatMoney(ledger?.opening_balance ?? 0)}</p>
              </div>
              <button aria-label="Close supplier ledger" className="icon-button" onClick={() => setLedgerSupplier(null)} type="button"><X size={18} /></button>
            </header>
            <div className="purchase-detail-content">
              {ledger && <div className="supplier-ledger-balance"><div><span>Current balance</span><strong>{formatMoney(ledger.current_balance)}</strong></div><button className="button button-primary" onClick={() => openPayment(ledgerSupplier)} type="button"><CreditCard size={15} /> Record payment</button></div>}
              <div className="supplier-ledger-filters">
                <label className="inventory-search"><Search size={15} /><input aria-label="Search ledger entries" onChange={(event) => setLedgerSearch(event.target.value)} placeholder="Search reference or note" value={ledgerSearch} /></label>
                <label className="purchase-date-filter"><input aria-label="Ledger from date" onChange={(event) => setLedgerFrom(event.target.value)} type="date" value={ledgerFrom} /></label>
                <label className="purchase-date-filter"><span className="purchase-date-to">to</span><input aria-label="Ledger to date" onChange={(event) => setLedgerTo(event.target.value)} type="date" value={ledgerTo} /></label>
              </div>
              {ledgerError && <div className="workspace-error workspace-error--banner" role="alert"><CircleAlert size={15} />{ledgerError}<button className="button button-secondary" onClick={() => setLedgerRefreshKey((value) => value + 1)} type="button">Retry</button></div>}
              {ledgerLoading ? <div className="purchase-detail-loading"><i /><i /><i /></div> : ledger && ledger.entries.length === 0 ? <div className="workspace-empty supplier-ledger-empty"><BookOpen size={22} /><strong>No entries in this range</strong><span>Purchases, returns, and supplier payments will be listed here.</span></div> : ledger && (
                <div className="workspace-table-scroll supplier-ledger-table-scroll">
                  <table className="workspace-table supplier-ledger-table">
                    <thead><tr><th scope="col">Date / entry</th><th scope="col">Reference / note</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Balance</th></tr></thead>
                    <tbody>{ledger.entries.map((entry) => <tr key={entry.id}><td><span className={`supplier-ledger-type supplier-ledger-type--${entry.entry_type.toLowerCase()}`}>{entry.entry_type.replaceAll("_", " ")}</span><small>{formatDateTime(entry.created_at)}</small></td><td><strong>{entry.reference || entry.transaction_reference || "—"}</strong><small>{entry.note || (entry.payment_method ? `${entry.payment_method} payment` : "No note")}</small></td><td>{entry.debit > 0 ? <span className="ledger-debit"><ArrowUpRight size={13} />{formatMoney(entry.debit)}</span> : "—"}</td><td>{entry.credit > 0 ? <span className="ledger-credit"><ArrowDownLeft size={13} />{formatMoney(entry.credit)}</span> : "—"}</td><td><strong>{formatMoney(entry.running_balance)}</strong></td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {paymentSupplier && (
        <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
          <section aria-labelledby="supplier-payment-title" aria-modal="true" className="workspace-dialog supplier-payment-dialog" role="dialog">
            <header className="dialog-header">
              <div><span className="eyebrow">SUPPLIER ACCOUNT</span><h2 id="supplier-payment-title">Record a payment</h2><p>{paymentSupplier.name} · Current due {formatMoney(paymentSupplier.balance_due)}</p></div>
              <button aria-label="Close payment form" className="icon-button" disabled={isPaying} onClick={() => setPaymentSupplier(null)} type="button"><X size={18} /></button>
            </header>
            <form className="workspace-form supplier-payment-form" onSubmit={(event) => void handlePayment(event)}>
              <label className="field-label">Payment date<input autoFocus className="workspace-input" onChange={(event) => setPaymentDate(event.target.value)} required type="date" value={paymentDate} /></label>
              <label className="field-label">Amount<input className="workspace-input supplier-payment-amount" min="0.01" onChange={(event) => setPaymentAmount(event.target.value)} required step="0.01" type="number" value={paymentAmount} /></label>
              <label className="field-label">Payment method<select className="workspace-input" onChange={(event) => setPaymentMethod(event.target.value as SupplierPaymentInput["payment_method"])} value={paymentMethod}><option value="CASH">Cash</option><option value="BANK">Bank transfer</option><option value="UPI">UPI</option><option value="OTHER">Other</option></select></label>
              <label className="field-label">Reference <span className="field-optional">Optional</span><input className="workspace-input" maxLength={120} onChange={(event) => setPaymentReference(event.target.value)} placeholder="UTR, transaction ID, cheque…" value={paymentReference} /></label>
              <label className="field-label">Note <span className="field-optional">Optional</span><textarea className="workspace-input workspace-textarea" maxLength={500} onChange={(event) => setPaymentNote(event.target.value)} rows={2} value={paymentNote} /></label>
              {paymentError && <p className="workspace-error" role="alert">{paymentError}</p>}
              <footer className="dialog-actions"><button className="button button-secondary" disabled={isPaying} onClick={() => setPaymentSupplier(null)} type="button">Cancel</button><button className="button button-primary" disabled={isPaying} type="submit"><Wallet size={15} />{isPaying ? "Recording…" : "Record payment"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}