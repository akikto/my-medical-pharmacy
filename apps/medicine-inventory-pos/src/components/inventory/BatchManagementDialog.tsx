import { AlertCircle, PackagePlus, Pencil, RefreshCw, Warehouse, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getMedicineBatches, getMedicinePhoto } from "../../services/inventoryService";
import type { Medicine, MedicineBatch } from "../../types";
import { formatDate, formatMoney } from "../../utils/money";

interface BatchManagementDialogProps {
  medicine: Medicine;
  refreshKey: number;
  suspendFocusTrap?: boolean;
  onClose: () => void;
  onEditBatch: (batch: MedicineBatch) => void;
  onAdjustStock: (batch: MedicineBatch) => void;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function BatchManagementDialog({
  medicine,
  refreshKey,
  suspendFocusTrap = false,
  onClose,
  onEditBatch,
  onAdjustStock,
}: BatchManagementDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, onClose, !suspendFocusTrap);

  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getMedicineBatches(medicine.id)
      .then((rows) => {
        if (!cancelled) setBatches(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load batches.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medicine.id, refreshKey]);

  useEffect(() => {
    if (!medicine.photo_ref) {
      setPhotoUrl(null);
      setPhotoError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void getMedicinePhoto(medicine.id)
      .then((bytes) => {
        if (cancelled || !bytes) return;
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
        );
        setPhotoUrl(objectUrl);
        setPhotoError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPhotoError(cause instanceof Error ? cause.message : "Could not load the photo.");
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [medicine.id, medicine.photo_ref]);

  const today = localDateString(new Date());
  const nearExpiry = new Date();
  nearExpiry.setDate(nearExpiry.getDate() + 30);
  const nearExpiryDate = localDateString(nearExpiry);
  const medicineDetails: Array<[string, string | null]> = [
    ["Product type", medicine.product_type],
    ["Strength", medicine.strength],
    ["Composition", medicine.composition],
    ["Barcode", medicine.barcode],
    ["Uses", medicine.uses],
    ["Adult dose", medicine.adult_dose],
    ["Child dose", medicine.child_dose],
  ];

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop">
      <section
        aria-labelledby="batch-manager-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--wide"
        data-testid="dialog-batch-manager"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">INVENTORY BATCHES</span>
            <h2 id="batch-manager-title">{medicine.name}</h2>
            <p>
              {medicine.rack_location ? `Rack ${medicine.rack_location} · ` : ""}
              {medicine.generic_name || medicine.company || "Batch pricing and stock"}
            </p>
          </div>
          <button aria-label="Close batch list" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        {(medicine.photo_ref ||
          medicine.product_type ||
          medicine.strength ||
          medicine.composition ||
          medicine.barcode ||
          medicine.uses ||
          medicine.adult_dose ||
          medicine.child_dose) && (
          <section className="medicine-details-summary" data-testid="medicine-details-summary">
            {photoUrl && (
              <img
                alt={`Photo of ${medicine.name}`}
                className="medicine-details-photo"
                src={photoUrl}
              />
            )}
            <dl className="medicine-details-grid">
              {medicineDetails.filter(([, value]) => value).map(([label, value]) => (
                <div className="medicine-details-item" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              {photoError && <p className="medicine-details-photo-error">{photoError}</p>}
            </dl>
          </section>
        )}

        <div className="batch-summary-strip">
          <span><Warehouse size={15} /> {batches.length} batch{batches.length === 1 ? "" : "es"}</span>
          <span><PackagePlus size={15} /> {batches.reduce((sum, batch) => sum + batch.current_stock, 0)} total unit{batches.reduce((sum, batch) => sum + batch.current_stock, 0) === 1 ? "" : "s"}</span>
          <button
            aria-label="Refresh batches"
            className="button button-quiet"
            onClick={() => {
              setError(null);
              setIsLoading(true);
              void getMedicineBatches(medicine.id)
                .then(setBatches)
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load batches."))
                .finally(() => setIsLoading(false));
            }}
            type="button"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {error && (
          <div className="workspace-error workspace-error--banner" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {isLoading ? (
          <div className="workspace-empty">Loading batches…</div>
        ) : batches.length === 0 ? (
          <div className="workspace-empty">
            <PackagePlus size={25} />
            <strong>No batches recorded</strong>
            <span>Stock batches will appear here after a purchase is saved.</span>
          </div>
        ) : (
          <div className="workspace-table-scroll batch-table-scroll">
            <table className="workspace-table batch-table">
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Expiry</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Purchase</th>
                  <th scope="col">MRP</th>
                  <th scope="col">Sale rate</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Batch actions</span></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const isExpired = batch.expiry_date < today;
                  const isNearExpiry = !isExpired && batch.expiry_date <= nearExpiryDate;
                  const status = isExpired
                    ? "Expired"
                    : batch.current_stock === 0
                      ? "Out of stock"
                      : isNearExpiry
                        ? "Near expiry"
                        : "Active";
                  const statusClass = isExpired
                    ? "is-danger"
                    : batch.current_stock === 0
                      ? "is-muted"
                      : isNearExpiry
                        ? "is-warning"
                        : "is-good";
                  return (
                    <tr key={batch.id} data-testid={`row-batch-${batch.id}`}>
                      <td><strong>{batch.batch_no}</strong></td>
                      <td>{formatDate(batch.expiry_date)}</td>
                      <td className="workspace-number">{batch.current_stock}</td>
                      <td>{formatMoney(batch.purchase_rate)}</td>
                      <td>{formatMoney(batch.mrp)}</td>
                      <td><strong>{formatMoney(batch.sale_rate)}</strong></td>
                      <td><span className={`inventory-status ${statusClass}`}>{status}</span></td>
                      <td>
                        <div className="workspace-row-actions">
                          <button
                            aria-label={`Edit batch ${batch.batch_no}`}
                            className="icon-button"
                            onClick={() => onEditBatch(batch)}
                            type="button"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label={`Adjust stock for batch ${batch.batch_no}`}
                            className="icon-button"
                            onClick={() => onAdjustStock(batch)}
                            type="button"
                          >
                            <PackagePlus size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}