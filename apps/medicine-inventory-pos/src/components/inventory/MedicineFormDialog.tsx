import { X } from "lucide-react";
import { useState } from "react";
import type { MedicineFormValues, MedicineInventoryRow } from "../../types";

interface MedicineFormDialogProps {
  medicine: MedicineInventoryRow | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: MedicineFormValues) => void;
}

export function MedicineFormDialog({
  medicine,
  error,
  isSaving,
  onClose,
  onSave,
}: MedicineFormDialogProps) {
  const [name, setName] = useState(medicine?.name ?? "");
  const [genericName, setGenericName] = useState(medicine?.generic_name ?? "");
  const [company, setCompany] = useState(medicine?.company ?? "");
  const [rackLocation, setRackLocation] = useState(medicine?.rack_location ?? "");
  const [minStockAlert, setMinStockAlert] = useState(
    String(medicine?.min_stock_alert ?? 10),
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      name,
      generic_name: genericName,
      company,
      rack_location: rackLocation,
      min_stock_alert: Number(minStockAlert),
    });
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="medicine-dialog-title"
        aria-modal="true"
        className="workspace-dialog"
        data-testid="dialog-medicine"
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">MEDICINE MASTER</span>
            <h2 id="medicine-dialog-title">
              {medicine ? "Edit medicine" : "Add medicine"}
            </h2>
            <p>Keep the medicine record and low-stock threshold up to date.</p>
          </div>
          <button
            aria-label="Close medicine form"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="workspace-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Medicine name
            <input
              autoFocus
              className="workspace-input"
              data-testid="input-medicine-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <div className="workspace-form-grid">
            <label className="field-label">
              Generic name <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={150}
                onChange={(event) => setGenericName(event.target.value)}
                value={genericName}
              />
            </label>
            <label className="field-label">
              Manufacturer <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={120}
                onChange={(event) => setCompany(event.target.value)}
                value={company}
              />
            </label>
            <label className="field-label">
              Rack location <span className="field-optional">Optional</span>
              <input
                className="workspace-input"
                maxLength={80}
                onChange={(event) => setRackLocation(event.target.value)}
                value={rackLocation}
              />
            </label>
            <label className="field-label">
              Low-stock alert level
              <input
                className="workspace-input"
                data-testid="input-medicine-low-stock"
                inputMode="numeric"
                max={1_000_000_000}
                min={0}
                onChange={(event) => setMinStockAlert(event.target.value)}
                required
                type="number"
                value={minStockAlert}
              />
            </label>
          </div>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-primary" data-testid="button-save-medicine" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : medicine ? "Save changes" : "Add medicine"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}