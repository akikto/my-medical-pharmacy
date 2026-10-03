import { Download, Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getMedicineBatches } from "../../services/inventoryService";
import { printInventoryDocument } from "../../utils/inventoryPrint";
import {
  downloadStockWorkbook,
  filterStockExportRows,
  type StockExportRow,
} from "../../services/inventoryWorkbookService";
import type { InventoryFilter, MedicineBatch, MedicineInventoryRow } from "../../types";
import { formatMoney } from "../../utils/money";

interface StockExportDialogProps {
  medicines: MedicineInventoryRow[];
  activeFilter: InventoryFilter;
  filterLabel: string;
  searchQuery: string;
  onClose: () => void;
}

function localDateIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function stockRowStatus(row: StockExportRow): string {
  const today = localDateIso(new Date());
  if (row.batch && row.batch.expiry_date < today) return "Expired";
  if (row.medicine.available_stock <= row.medicine.min_stock_alert) return "Low stock";
  if (row.medicine.near_expiry_stock > 0) return "Near expiry";
  return "Healthy";
}

export function StockExportDialog({
  medicines,
  activeFilter,
  filterLabel,
  searchQuery,
  onClose,
}: StockExportDialogProps) {
  const [rows, setRows] = useState<StockExportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isExporting ? undefined : onClose);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void Promise.all(
      medicines.map(async (medicine) => {
        const batches = await getMedicineBatches(medicine.id);
        return batches.length > 0
          ? batches.map((batch: MedicineBatch) => ({ medicine, batch }))
          : [{ medicine, batch: null }];
      }),
    )
      .then((groups) => {
        if (!cancelled) setRows(filterStockExportRows(groups.flat(), activeFilter));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not read batch stock.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFilter, medicines]);

  async function exportExcel() {
    setIsExporting(true);
    setExportError(null);
    try {
      await downloadStockWorkbook(rows);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Could not create the Excel export.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="stock-export-title"
        aria-modal="true"
        className="workspace-dialog stock-export-dialog"
        data-testid="dialog-stock-export"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">LOCAL STOCK EXPORT</span>
            <h2 id="stock-export-title">Export filtered stock</h2>
            <p>
              {filterLabel}
              {searchQuery.trim() ? ` · Search: “${searchQuery.trim()}”` : " · No search term"}
            </p>
          </div>
          <button
            aria-label="Close stock export"
            className="icon-button"
            disabled={isExporting}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="stock-export-body">
          <div className="stock-export-count" aria-live="polite">
            {isLoading ? "Loading filtered batch stock…" : `${rows.length} stock rows in this export`}
          </div>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          {exportError && <p className="workspace-error" role="alert">{exportError}</p>}

          <div className="stock-export-preview-scroll">
            {isLoading ? (
              <div className="workspace-empty">Reading local batch records…</div>
            ) : (
              <div
                className="inventory-print-root stock-export-print-root"
                data-testid="stock-export-print-content"
              >
                <header className="stock-export-report-heading">
                  <span>MY MEDICAL</span>
                  <h1>Stock report</h1>
                  <p>
                    {filterLabel}
                    {searchQuery.trim() ? ` · Search: ${searchQuery.trim()}` : ""}
                    {" · "}{rows.length} stock rows
                  </p>
                  <small>Generated {new Date().toLocaleString()}</small>
                </header>
                {rows.length === 0 ? (
                  <div className="stock-export-empty">
                    No stock rows match the current search and filter.
                  </div>
                ) : (
                  <table className="stock-export-table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Company</th>
                        <th>Barcode</th>
                        <th>Batch</th>
                        <th>Expiry</th>
                        <th>Stock</th>
                        <th>Reorder</th>
                        <th>MRP</th>
                        <th>Sale</th>
                        <th>Purchase</th>
                        <th>GST %</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ medicine, batch }, index) => (
                        <tr key={`${medicine.id}-${batch?.id ?? "none"}-${index}`}>
                          <td>
                            <strong>{medicine.name}</strong>
                            {medicine.strength && <small>{medicine.strength}</small>}
                          </td>
                          <td>{medicine.company ?? "—"}</td>
                          <td>{batch?.barcode ?? medicine.barcode ?? "—"}</td>
                          <td>{batch?.batch_no ?? "—"}</td>
                          <td>{batch?.expiry_date ?? "—"}</td>
                          <td>{batch?.current_stock ?? 0}</td>
                          <td>{medicine.min_stock_alert}</td>
                          <td>{batch ? formatMoney(batch.mrp) : "—"}</td>
                          <td>{batch ? formatMoney(batch.sale_rate) : "—"}</td>
                          <td>{batch ? formatMoney(batch.purchase_rate) : "—"}</td>
                          <td>
                            {medicine.gst_rate_basis_points == null
                              ? "—"
                              : (medicine.gst_rate_basis_points / 100).toFixed(2)}
                          </td>
                          <td>{stockRowStatus({ medicine, batch })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <footer className="dialog-actions stock-export-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Close
            </button>
            <button
              className="button button-secondary"
              disabled={isLoading || Boolean(error)}
              onClick={printInventoryDocument}
              type="button"
            >
              <Printer size={15} /> Print / Save PDF
            </button>
            <button
              className="button button-primary"
              disabled={isLoading || Boolean(error) || isExporting}
              onClick={() => void exportExcel()}
              type="button"
            >
              <Download size={15} /> {isExporting ? "Preparing…" : "Download Excel"}
            </button>
          </footer>
          <p className="stock-export-note">
            Exports are generated locally. The expired and near-expiry filters export only
            matching batches; other filters include all batches for visible medicines.
          </p>
        </div>
      </section>
    </div>
  );
}