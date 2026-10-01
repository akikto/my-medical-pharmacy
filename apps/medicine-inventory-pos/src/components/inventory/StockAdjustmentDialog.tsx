import { ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";
import { useState } from "react";
import type { Medicine, MedicineBatch } from "../../types";

interface StockAdjustmentDialogProps {
  medicine: Medicine;
  batch: MedicineBatch;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (quantityChange: number, reason: string) => void;
}

export function StockAdjustmentDialog({
  medicine,
  batch,
  error,
  isSaving,
  onClose,
  onSave,
}: StockAdjustmentDialogProps) {
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(quantity);
    onSave(direction === "add" ? amount : -amount, reason);
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="stock-adjustment-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--narrow"
        data-testid="dialog-stock-adjustment"
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">MANUAL STOCK CONTROL</span>
            <h2 id="stock-adjustment-title">Adjust stock</h2>
            <p>{medicine.name} · Batch {batch.batch_no} · Current stock {batch.current_stock}</p>
          </div>
          <button aria-label="Close stock adjustment" className="icon-button" disabled={isSaving} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        <form className="workspace-form" onSubmit={handleSubmit}>
          <fieldset className="stock-direction">
            <legend>Adjustment</legend>
            <button
              aria-pressed={direction === "add"}
              className={direction === "add" ? "is-selected" : ""}
              onClick={() => setDirection("add")}
              type="button"
            >
              <ArrowDownToLine size={16} /> Add stock
            </button>
            <button
              aria-pressed={direction === "remove"}
              className={direction === "remove" ? "is-selected" : ""}
              onClick={() => setDirection("remove")}
              type="button"
            >
              <ArrowUpFromLine size={16} /> Remove stock
            </button>
          </fieldset>
          <label className="field-label">
            Units
            <input
              autoFocus
              className="workspace-input"
              data-testid="input-stock-adjustment-quantity"
              inputMode="numeric"
              max={direction === "remove" ? batch.current_stock : 1_000_000_000}
              min={1}
              onChange={(event) => setQuantity(event.target.value)}
              required
              type="number"
              value={quantity}
            />
          </label>
          <label className="field-label">
            Reason
            <input
              className="workspace-input"
              data-testid="input-stock-adjustment-reason"
              maxLength={250}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: count correction or damaged stock"
              required
              value={reason}
            />
          </label>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Save adjustment"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}