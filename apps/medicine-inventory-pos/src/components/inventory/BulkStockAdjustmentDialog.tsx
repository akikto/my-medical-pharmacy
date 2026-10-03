import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getMedicineBatches } from "../../services/inventoryService";
import type {
  BulkStockAdjustmentInput,
} from "../../services/inventoryService";
import type { MedicineBatch, MedicineInventoryRow } from "../../types";
import { formatDate } from "../../utils/money";

interface BulkStockAdjustmentDialogProps {
  medicines: MedicineInventoryRow[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (adjustments: BulkStockAdjustmentInput[], reason: string) => void;
}

type BulkRowDraft = {
  batchId: number | null;
  direction: "add" | "remove";
  quantity: string;
};

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function BulkStockAdjustmentDialog({
  medicines,
  error,
  isSaving,
  onClose,
  onSave,
}: BulkStockAdjustmentDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const [batchesByMedicine, setBatchesByMedicine] = useState<
    Record<string, MedicineBatch[]>
  >({});
  const [drafts, setDrafts] = useState<Record<string, BulkRowDraft>>({});
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void Promise.all(
      medicines.map(async (medicine) => [
        String(medicine.id),
        await getMedicineBatches(medicine.id),
      ] as const),
    )
      .then((entries) => {
        if (cancelled) return;
        const batches = Object.fromEntries(entries) as Record<string, MedicineBatch[]>;
        setBatchesByMedicine(batches);
        setDrafts(
          Object.fromEntries(
            entries.map(([medicineId, rows]) => [
              medicineId,
              {
                batchId:
                  rows.find((batch) => batch.expiry_date >= localDateString(new Date()))?.id ??
                  rows[0]?.id ??
                  null,
                direction: "add",
                quantity: "",
              },
            ]),
          ) as Record<string, BulkRowDraft>,
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error ? cause.message : "Could not load the selected medicine batches.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medicines]);

  const today = localDateString(new Date());
  const selectedBatches = useMemo(
    () =>
      medicines.map((medicine) => {
        const batches = batchesByMedicine[String(medicine.id)] ?? [];
        const draft = drafts[String(medicine.id)];
        return {
          medicine,
          batches,
          draft,
          selectedBatch:
            batches.find((batch) => batch.id === draft?.batchId) ?? null,
        };
      }),
    [batchesByMedicine, drafts, medicines],
  );

  const allRowsValid =
    !isLoading &&
    !loadError &&
    reason.trim().length > 0 &&
    selectedBatches.every(({ batches, draft, selectedBatch }) => {
      const amount = Number(draft?.quantity);
      if (
        batches.length === 0 ||
        !selectedBatch ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1_000_000_000
      ) {
        return false;
      }
      if (draft.direction === "add") {
        return selectedBatch.current_stock + amount <= 1_000_000_000;
      }
      return amount <= selectedBatch.current_stock;
    });

  function updateDraft(medicineId: number, patch: Partial<BulkRowDraft>) {
    setDrafts((current) => ({
      ...current,
      [medicineId]: {
        ...current[String(medicineId)],
        ...patch,
      },
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allRowsValid) setShowConfirmation(true);
  }

  function confirmAdjustments() {
    if (!allRowsValid) return;
    onSave(
      selectedBatches.map(({ medicine, draft }) => ({
        medicineId: medicine.id,
        batchId: draft.batchId!,
        quantityChange:
          draft.direction === "add"
            ? Number(draft.quantity)
            : -Number(draft.quantity),
      })),
      reason,
    );
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="bulk-stock-adjustment-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--wide"
        data-testid="dialog-bulk-stock-adjustment"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">BULK STOCK CONTROL</span>
            <h2 id="bulk-stock-adjustment-title">Adjust selected stock</h2>
            <p>
              Select a batch and enter units for each medicine. Changes are saved together
              with an audit reason.
            </p>
          </div>
          <button
            aria-label="Close bulk stock adjustment"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="workspace-form" onSubmit={handleSubmit}>
          {isLoading ? (
            <div className="workspace-empty">Loading batches for selected medicines…</div>
          ) : loadError ? (
            <div className="workspace-error workspace-error--banner" role="alert">
              {loadError}
            </div>
          ) : showConfirmation ? (
            <div
              className="bulk-operation-confirmation"
              data-testid="confirmation-bulk-stock-adjustment"
            >
              <strong>Apply adjustments to {selectedBatches.length} batches?</strong>
              <span>
                All changes will be saved together with the same audit reason. If any
                batch fails validation, none of these changes will be applied.
              </span>
              <div className="bulk-operation-confirmation-list">
                {selectedBatches.map(({ medicine, draft, selectedBatch }) => {
                  const amount = Number(draft?.quantity);
                  const newStock =
                    selectedBatch &&
                    selectedBatch.current_stock +
                      (draft?.direction === "add" ? amount : -amount);
                  return (
                    <span key={medicine.id}>
                      {medicine.name}
                      {selectedBatch
                        ? ` · ${selectedBatch.batch_no}: ${selectedBatch.current_stock} → ${newStock} units`
                        : " · no batch selected"}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bulk-stock-adjustment-list">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th scope="col">Medicine</th>
                    <th scope="col">Batch</th>
                    <th scope="col">Change</th>
                    <th scope="col">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBatches.map(({ medicine, batches, draft, selectedBatch }) => (
                    <tr key={medicine.id}>
                      <td>
                        <strong>{medicine.name}</strong>
                        <small className="bulk-stock-current">
                          Sellable total: {medicine.available_stock}
                        </small>
                      </td>
                      <td>
                        {batches.length === 0 ? (
                          <span className="workspace-muted">
                            No batch yet; record a purchase first
                          </span>
                        ) : (
                          <>
                            <select
                              aria-label={`Batch for ${medicine.name}`}
                              className="workspace-input"
                              data-testid={`select-bulk-stock-batch-${medicine.id}`}
                              disabled={isSaving}
                              onChange={(event) =>
                                updateDraft(medicine.id, {
                                  batchId: Number(event.target.value),
                                })
                              }
                              value={draft?.batchId ?? ""}
                            >
                              {batches.map((batch) => {
                                const expired = batch.expiry_date < today;
                                return (
                                  <option
                                    key={batch.id}
                                    value={batch.id}
                                  >
                                    {batch.batch_no} · {formatDate(batch.expiry_date)} ·{" "}
                                    {batch.current_stock} units{expired ? " · expired" : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`Stock change direction for ${medicine.name}`}
                          className="workspace-input"
                          data-testid={`select-bulk-stock-direction-${medicine.id}`}
                          disabled={isSaving || batches.length === 0}
                          onChange={(event) =>
                            updateDraft(medicine.id, {
                              direction: event.target.value as "add" | "remove",
                            })
                          }
                          value={draft?.direction ?? "add"}
                        >
                          <option value="add">Add</option>
                          <option value="remove">Remove</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Units to ${draft?.direction ?? "add"} for ${medicine.name}`}
                          className="workspace-input"
                          data-testid={`input-bulk-stock-quantity-${medicine.id}`}
                          disabled={isSaving || batches.length === 0}
                          inputMode="numeric"
                          max={
                            selectedBatch
                              ? draft?.direction === "remove"
                                ? selectedBatch.current_stock
                                : 1_000_000_000 - selectedBatch.current_stock
                              : 1_000_000_000
                          }
                          min={1}
                          onChange={(event) =>
                            updateDraft(medicine.id, { quantity: event.target.value })
                          }
                          required
                          step={1}
                          type="number"
                          value={draft?.quantity ?? ""}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="field-label">
            Audit reason for all rows
            <input
              className="workspace-input"
              data-testid="input-bulk-stock-reason"
              disabled={isSaving}
              maxLength={250}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: physical count correction"
              required
              value={reason}
            />
          </label>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button
              className="button button-secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            {showConfirmation ? (
              <>
                <button
                  className="button button-secondary"
                  disabled={isSaving}
                  onClick={() => setShowConfirmation(false)}
                  type="button"
                >
                  Back to review
                </button>
                <button
                  className="button button-primary"
                  data-testid="button-confirm-bulk-stock-adjustment"
                  disabled={isSaving || !allRowsValid}
                  onClick={confirmAdjustments}
                  type="button"
                >
                  {isSaving ? "Saving…" : `Confirm ${selectedBatches.length} adjustments`}
                </button>
              </>
            ) : (
              <button
                className="button button-primary"
                disabled={isSaving || !allRowsValid}
                type="submit"
              >
                Review {medicines.length} adjustments
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}