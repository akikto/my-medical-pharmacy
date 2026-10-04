import {
  AlertCircle,
  ArchiveX,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cancelPurchase,
  editPurchase,
  getPurchaseDetails,
  getPurchaseHistory,
  openPurchaseAttachment,
  returnPurchase,
  selectAndAddPurchaseAttachment,
} from "../../services/purchaseService";
import { getMedicineBatches } from "../../services/inventoryService";
import type {
  EntityId,
  PurchaseDetails,
  PurchaseHistoryRecord,
  PurchaseLineInput,
  Supplier,
} from "../../types";
import { formatDate, formatMoney } from "../../utils/money";

interface PurchaseHistoryWorkspaceProps {
  suppliers: Supplier[];
  refreshKey: number;
  onMutation: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "This purchase action could not be completed.";
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PurchaseHistoryWorkspace({ suppliers, refreshKey, onMutation }: PurchaseHistoryWorkspaceProps) {
  const [rows, setRows] = useState<PurchaseHistoryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "CANCELLED">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);
  const [details, setDetails] = useState<PurchaseDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editInvoice, setEditInvoice] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editLines, setEditLines] = useState<PurchaseLineInput[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnDate, setReturnDate] = useState(today);
  const [returnNote, setReturnNote] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({});
  const [returnError, setReturnError] = useState<string | null>(null);
  const visibleRows = useMemo(
    () => statusFilter === "ALL" ? rows : rows.filter((row) => row.status === statusFilter),
    [rows, statusFilter],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getPurchaseHistory({
      searchTerm: search,
      supplierId: supplierId ? Number(supplierId) : null,
      fromDate: fromDate || null,
      toDate: toDate || null,
    }).then((result) => {
      if (active) setRows(result);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [search, supplierId, fromDate, toDate, refreshKey, reloadKey]);

  async function loadDetails(id: EntityId) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await getPurchaseDetails(id);
      setDetails(result);
    } catch (reason) {
      setDetails(null);
      setDetailError(errorMessage(reason));
    } finally {
      setDetailLoading(false);
    }
  }

  function openDetails(id: EntityId) {
    setSelectedId(id);
    setDetails(null);
    setNotice(null);
    setEditing(false);
    setReturning(false);
    setConfirmCancel(false);
    void loadDetails(id);
  }

  function closeDetails() {
    if (busy) return;
    setSelectedId(null);
    setDetails(null);
    setDetailError(null);
    setEditing(false);
    setReturning(false);
  }

  async function startEdit() {
    if (!details || details.status !== "ACTIVE") return;
    setEditError(null);
    setBusy(true);
    try {
      const batchesByMedicine = new Map<number, Awaited<ReturnType<typeof getMedicineBatches>>>();
      await Promise.all([...new Set(details.lines.map((line) => line.medicine_id))].map(async (medicineId) => {
        batchesByMedicine.set(medicineId, await getMedicineBatches(medicineId));
      }));
      const lines = details.lines.map((line) => {
        const batch = batchesByMedicine.get(line.medicine_id)?.find((candidate) => candidate.id === line.batch_id);
        if (!batch) throw new Error(`Batch ${line.batch_no} is no longer available to edit safely.`);
        return {
          medicine_id: line.medicine_id,
          batch_no: line.batch_no,
          expiry_date: line.expiry_date,
          purchase_rate: line.rate,
          mrp: batch.mrp,
          sale_rate: batch.sale_rate,
          quantity: line.quantity,
          gst_rate_override_basis_points: line.gst_rate_basis_points,
        };
      });
      setEditInvoice(details.invoice_no);
      setEditDate(details.purchase_date);
      setEditSupplierId(details.supplier_id ? String(details.supplier_id) : "");
      setEditLines(lines);
      setEditing(true);
    } catch (reason) {
      setEditError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setBusy(true);
    setEditError(null);
    try {
      await editPurchase(details.id, {
        supplier_id: Number(editSupplierId),
        invoice_no: editInvoice,
        purchase_date: editDate,
        gst_pricing_mode: details.gst_pricing_mode,
        place_of_supply_state_code: details.place_of_supply_state_code,
        items: editLines,
      });
      setEditing(false);
      setNotice("Invoice changes saved. Batch stock and supplier balance were recalculated.");
      setReloadKey((key) => key + 1);
      onMutation();
      await loadDetails(details.id);
    } catch (reason) {
      setEditError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!details) return;
    setBusy(true);
    setDetailError(null);
    try {
      await cancelPurchase(details.id);
      setConfirmCancel(false);
      setNotice("Purchase cancelled. Stock and supplier balance were rolled back.");
      setReloadKey((key) => key + 1);
      onMutation();
      await loadDetails(details.id);
    } catch (reason) {
      setDetailError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachmentAdd() {
    if (!details) return;
    setBusy(true);
    setDetailError(null);
    try {
      const added = await selectAndAddPurchaseAttachment(details.id);
      if (added) {
        setNotice("Invoice paperwork attached to this purchase.");
        await loadDetails(details.id);
      }
    } catch (reason) {
      setDetailError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const items = details.lines
      .filter((line) => Number(returnQuantities[line.id]) > 0)
      .map((line) => ({ purchase_item_id: line.id, quantity: Number(returnQuantities[line.id]) }));
    if (items.length === 0) {
      setReturnError("Enter a return quantity on at least one available batch.");
      return;
    }
    setBusy(true);
    setReturnError(null);
    try {
      const result = await returnPurchase({
        purchase_id: details.id,
        return_date: returnDate,
        note: returnNote,
        items,
      });
      setReturning(false);
      setReturnQuantities({});
      setReturnNote("");
      setNotice(`Return recorded: ${formatMoney(result.totalCents / 100)} credited against supplier balance.`);
      setReloadKey((key) => key + 1);
      onMutation();
      await loadDetails(details.id);
    } catch (reason) {
      setReturnError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="workspace-card purchase-history-card">
        <div className="purchase-section-heading purchase-history-heading">
          <div className="purchase-section-icon"><FileText size={18} /></div>
          <div>
            <h2>Purchase register</h2>
            <p>Search invoices, review batch movement, and keep supplier paperwork together.</p>
          </div>
          <span className="purchase-register-count">{visibleRows.length} {visibleRows.length === 1 ? "record" : "records"}</span>
        </div>
        <div className="purchase-history-filters">
          <label className="purchase-history-search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search purchase history" onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, supplier, or medicine" value={search} />
            {search && <button aria-label="Clear search" onClick={() => setSearch("")} type="button"><X size={14} /></button>}
          </label>
          <select aria-label="Filter by supplier" className="workspace-input" onChange={(event) => setSupplierId(event.target.value)} value={supplierId}>
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <select aria-label="Filter by purchase status" className="workspace-input purchase-status-filter" onChange={(event) => setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "CANCELLED")} value={statusFilter}>
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <label className="purchase-date-filter"><CalendarDays size={14} /><input aria-label="From date" onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} /></label>
          <label className="purchase-date-filter"><span className="purchase-date-to">to</span><input aria-label="To date" onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} /></label>
          {(search || supplierId || statusFilter !== "ALL" || fromDate || toDate) && (
            <button className="purchase-filter-reset" onClick={() => { setSearch(""); setSupplierId(""); setStatusFilter("ALL"); setFromDate(""); setToDate(""); }} type="button">Reset</button>
          )}
        </div>
        {error && <div className="workspace-error workspace-error--banner purchase-history-error" role="alert"><AlertCircle size={16} />{error}<button className="button button-secondary" onClick={() => setReloadKey((key) => key + 1)} type="button">Retry</button></div>}
        {loading ? (
          <div className="purchase-history-skeleton" aria-label="Loading purchase history"><i /><i /><i /></div>
        ) : visibleRows.length === 0 ? (
          <div className="workspace-empty purchase-history-empty">
            <span className="purchase-empty-mark"><FileText size={22} /></span>
            <strong>{search || supplierId || statusFilter !== "ALL" || fromDate || toDate ? "No invoices match these filters" : "Your purchase register is ready"}</strong>
            <span>{search || supplierId || statusFilter !== "ALL" || fromDate || toDate ? "Adjust the search or date range to see more records." : "Saved supplier invoices will appear here with their batch and account history."}</span>
          </div>
        ) : (
          <div className="workspace-table-scroll purchase-register-scroll">
            <table className="workspace-table purchase-register-table">
              <thead><tr><th scope="col">Invoice</th><th scope="col">Supplier</th><th scope="col">Date</th><th scope="col">Lines / units</th><th scope="col">GST</th><th scope="col" className="purchase-register-amount">Invoice total</th><th scope="col"><span className="sr-only">Open invoice</span></th></tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} data-testid={`row-purchase-history-${row.id}`}>
                    <td><button className="purchase-invoice-link" onClick={() => openDetails(row.id)} type="button"><span className="purchase-invoice-glyph"><FileText size={15} /></span><span><strong>{row.invoice_no}</strong><small>#{row.id}</small></span></button></td>
                    <td>{row.supplier_name || "Supplier not available"}</td>
                    <td>{formatDate(row.purchase_date)}</td>
                    <td><strong>{row.item_count}</strong><span className="purchase-row-subtle"> lines · {row.total_units} units</span></td>
                    <td>{row.total_gst > 0 ? formatMoney(row.total_gst) : <span className="purchase-row-subtle">—</span>}</td>
                    <td className="purchase-register-amount"><strong>{formatMoney(row.total_amount)}</strong><span className={`purchase-status-pill ${row.status === "CANCELLED" ? "is-cancelled" : ""}`}>{row.status === "ACTIVE" ? "Active" : "Cancelled"}</span></td>
                    <td><button aria-label={`View invoice ${row.invoice_no}`} className="purchase-open-row" onClick={() => openDetails(row.id)} type="button"><ChevronRight size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId !== null && (
        <div className="dialog-backdrop inventory-dialog-backdrop purchase-detail-backdrop">
          <section aria-labelledby="purchase-detail-title" aria-modal="true" className="workspace-dialog purchase-detail-dialog" data-testid="dialog-purchase-details" role="dialog">
            <header className="purchase-detail-top">
              <div className="purchase-detail-top-icon"><FileText size={19} /></div>
              <div className="purchase-detail-title-wrap">
                <span className="eyebrow">PURCHASE RECORD · #{selectedId}</span>
                <h2 id="purchase-detail-title">{details?.invoice_no || "Invoice detail"}</h2>
                {details && <p>{details.supplier_name || "Supplier not available"} <span>·</span> {formatDate(details.purchase_date)}</p>}
              </div>
              {details && <span className={`purchase-status-pill purchase-status-pill--detail ${details.status === "CANCELLED" ? "is-cancelled" : ""}`}>{details.status === "ACTIVE" ? "Active" : "Cancelled"}</span>}
              <button aria-label="Close purchase details" className="icon-button" disabled={busy} onClick={closeDetails} type="button"><X size={18} /></button>
            </header>
            <div className="purchase-detail-content">
              {detailLoading ? <div className="purchase-detail-loading"><i /><i /><i /></div> : detailError ? (
                <div className="workspace-error workspace-error--banner" role="alert"><AlertCircle size={16} />{detailError}<button className="button button-secondary" onClick={() => void loadDetails(selectedId)} type="button">Retry</button></div>
              ) : details ? (
                <>
                  {notice && <div className="workspace-notice workspace-notice--success purchase-detail-notice" role="status"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss notice" className="notice-close" onClick={() => setNotice(null)} type="button"><X size={14} /></button></div>}
                  {details.status === "CANCELLED" && <div className="purchase-cancelled-banner"><ArchiveX size={16} /><span>This invoice was cancelled. Its stock and supplier account effects have been reversed.</span></div>}
                  <section className="purchase-detail-summary">
                    <div><span>Invoice amount</span><strong>{formatMoney(details.total_amount)}</strong><small>{details.gst_enabled ? `${details.gst_pricing_mode.toLowerCase()} pricing · ${details.tax_type === "IGST" ? "IGST" : details.tax_type === "CGST_SGST" ? "CGST + SGST" : "No GST"}` : "GST not applied"}</small></div>
                    <div><span>Supplier balance</span><strong>{formatMoney(rows.find((row) => row.id === details.id)?.supplier_balance_due ?? suppliers.find((supplier) => supplier.id === details.supplier_id)?.balance_due ?? 0)}</strong><small>{details.lines.reduce((sum, line) => sum + line.quantity, 0)} units received</small></div>
                    <div><span>Tax breakdown</span><strong>{formatMoney(details.total_gst)}</strong><small>Taxable {formatMoney(details.taxable_amount)} · CGST {formatMoney(details.cgst_amount)} · SGST {formatMoney(details.sgst_amount)} · IGST {formatMoney(details.igst_amount)}</small></div>
                  </section>
                  <section className="purchase-detail-section">
                    <div className="purchase-detail-section-title"><div><h3>Batch lines</h3><span>Returns reduce available stock by batch</span></div>{details.status === "ACTIVE" && !returning && !editing && details.lines.some((line) => line.available_quantity > 0) && <button className="button button-secondary purchase-detail-action" onClick={() => { setReturning(true); setReturnError(null); setReturnDate(today()); }} type="button"><RotateCcw size={14} /> Record return</button>}</div>
                    <div className="workspace-table-scroll purchase-detail-lines-scroll">
                      <table className="workspace-table purchase-detail-lines-table">
                        <thead><tr><th scope="col">Medicine / batch</th><th scope="col">Expiry</th><th scope="col">Received</th><th scope="col">Returned</th><th scope="col">Available</th><th scope="col">Rate</th><th scope="col">Line total</th></tr></thead>
                        <tbody>{details.lines.map((line) => <tr key={line.id}><td><strong>{line.medicine_name}</strong><small>Batch {line.batch_no}</small></td><td>{formatDate(line.expiry_date)}</td><td>{line.quantity}</td><td>{line.returned_quantity}</td><td><span className={line.available_quantity === 0 ? "purchase-qty-empty" : "purchase-qty-available"}>{line.available_quantity}</span></td><td>{formatMoney(line.rate)}</td><td><strong>{formatMoney(line.total)}</strong><small>{(line.gst_rate_basis_points / 100).toFixed(2)}% GST</small></td></tr>)}</tbody>
                      </table>
                    </div>
                  </section>
                  {returning && (
                    <form className="purchase-return-form" onSubmit={(event) => void handleReturn(event)}>
                      <div className="purchase-detail-section-title"><div><h3>Return to supplier</h3><span>Enter quantities for the batches leaving stock.</span></div><button aria-label="Close return form" className="icon-button" disabled={busy} onClick={() => setReturning(false)} type="button"><X size={16} /></button></div>
                      <div className="purchase-return-fields">
                        <label className="field-label">Return date<input className="workspace-input" onChange={(event) => setReturnDate(event.target.value)} required type="date" value={returnDate} /></label>
                        <label className="field-label purchase-return-note">Note <span className="field-optional">Optional</span><input className="workspace-input" maxLength={500} onChange={(event) => setReturnNote(event.target.value)} value={returnNote} /></label>
                      </div>
                      <div className="purchase-return-lines">{details.lines.filter((line) => line.available_quantity > 0).map((line) => <label className="purchase-return-line" key={line.id}><span><strong>{line.medicine_name}</strong><small>Batch {line.batch_no} · {line.available_quantity} available</small></span><input aria-label={`Return quantity for ${line.medicine_name} batch ${line.batch_no}`} className="workspace-input" max={line.available_quantity} min={0} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="0" step={1} type="number" value={returnQuantities[line.id] ?? ""} /></label>)}</div>
                      {returnError && <p className="workspace-error" role="alert">{returnError}</p>}
                      <footer className="purchase-inline-form-actions"><button className="button button-secondary" disabled={busy} onClick={() => setReturning(false)} type="button">Keep invoice</button><button className="button button-primary" disabled={busy} type="submit"><ArrowUpRight size={15} />{busy ? "Recording…" : "Record return"}</button></footer>
                    </form>
                  )}
                  <section className="purchase-detail-section purchase-attachments-section">
                    <div className="purchase-detail-section-title"><div><h3>Supplier paperwork</h3><span>PDF, JPG, or PNG · stored with the local purchase record</span></div><button className="button button-secondary purchase-detail-action" disabled={busy} onClick={() => void handleAttachmentAdd()} type="button"><Plus size={14} /> Attach file</button></div>
                    {details.attachments.length === 0 ? <div className="purchase-attachment-empty"><Paperclip size={16} /><span>No invoice files attached</span></div> : <div className="purchase-attachment-list">{details.attachments.map((attachment) => <button className="purchase-attachment-row" key={attachment.id} disabled={busy} onClick={() => void openPurchaseAttachment(attachment.id).catch((reason: unknown) => setDetailError(errorMessage(reason)))} type="button"><span className="purchase-attachment-icon"><FileText size={16} /></span><span><strong>{attachment.file_name}</strong><small>{attachment.mime_type.toUpperCase().replace("APPLICATION/", "").replace("IMAGE/", "")} · {fileSize(attachment.size_bytes)}</small></span><ArrowDownLeft size={15} /></button>)}</div>}
                  </section>
                  {editing && (
                    <form className="purchase-edit-form" onSubmit={(event) => void saveEdit(event)}>
                      <div className="purchase-detail-section-title"><div><h3>Edit purchase invoice</h3><span>Header details and received quantities can be corrected; batch identity stays fixed.</span></div><button aria-label="Close edit form" className="icon-button" disabled={busy} onClick={() => setEditing(false)} type="button"><X size={16} /></button></div>
                      <div className="purchase-edit-header-fields">
                        <label className="field-label">Supplier<select className="workspace-input" onChange={(event) => setEditSupplierId(event.target.value)} required value={editSupplierId}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                        <label className="field-label">Invoice number<input className="workspace-input" maxLength={100} onChange={(event) => setEditInvoice(event.target.value)} required value={editInvoice} /></label>
                        <label className="field-label">Purchase date<input className="workspace-input" onChange={(event) => setEditDate(event.target.value)} required type="date" value={editDate} /></label>
                      </div>
                      <div className="purchase-edit-line-list">{details.lines.map((line, index) => <div className="purchase-edit-line" key={line.id}><span><strong>{line.medicine_name}</strong><small>{line.batch_no} · {formatDate(line.expiry_date)}</small></span><label>Qty<input className="workspace-input" min={1} onChange={(event) => setEditLines((current) => current.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} required type="number" value={editLines[index]?.quantity ?? line.quantity} /></label><label>Rate<input className="workspace-input" min={0} onChange={(event) => setEditLines((current) => current.map((item, i) => i === index ? { ...item, purchase_rate: Number(event.target.value) } : item))} required step="0.01" type="number" value={editLines[index]?.purchase_rate ?? line.rate} /></label></div>)}</div>
                      {editError && <p className="workspace-error" role="alert">{editError}</p>}
                      <footer className="purchase-inline-form-actions"><button className="button button-secondary" disabled={busy} onClick={() => setEditing(false)} type="button">Discard</button><button className="button button-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save invoice changes"}</button></footer>
                    </form>
                  )}
                  {confirmCancel && <div className="purchase-cancel-confirm" role="alert"><ArchiveX size={17} /><span><strong>Cancel this purchase?</strong><small>Stock changes and supplier account entries will be reversed. This cannot be undone.</small></span><button className="button button-secondary" disabled={busy} onClick={() => setConfirmCancel(false)} type="button">Keep invoice</button><button className="button button-danger" disabled={busy} onClick={() => void handleCancel()} type="button">{busy ? "Cancelling…" : "Confirm cancel"}</button></div>}
                  {!editing && !returning && <footer className="purchase-detail-footer"><span>Invoice date {formatDate(details.purchase_date)}</span><div>{details.status === "ACTIVE" && <><button className="button button-secondary" disabled={busy} onClick={() => void startEdit()} type="button"><FileText size={14} /> Edit invoice</button><button className="button button-danger purchase-cancel-button" disabled={busy} onClick={() => setConfirmCancel(true)} type="button"><ArchiveX size={14} /> Cancel purchase</button></>}</div></footer>}
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </>
  );
}