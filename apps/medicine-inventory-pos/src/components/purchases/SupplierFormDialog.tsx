import { X } from "lucide-react";
import { useState } from "react";
import type { Supplier, SupplierFormValues } from "../../types";

interface SupplierFormDialogProps {
  supplier: Supplier | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: SupplierFormValues) => void;
}

export function SupplierFormDialog({
  supplier,
  error,
  isSaving,
  onClose,
  onSave,
}: SupplierFormDialogProps) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactPerson, setContactPerson] = useState(supplier?.contact_person ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [whatsappPhone, setWhatsappPhone] = useState(supplier?.whatsapp_phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [stateCode, setStateCode] = useState(supplier?.state_code ?? "");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      name,
      contact_person: contactPerson,
      phone,
      whatsapp_phone: whatsappPhone,
      address,
      notes,
      state_code: stateCode,
    });
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="supplier-dialog-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--narrow"
        data-testid="dialog-supplier"
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">SUPPLIER RECORD</span>
            <h2 id="supplier-dialog-title">{supplier ? "Edit supplier" : "Add supplier"}</h2>
            <p>Keep wholesaler details available for purchase invoices and order lists.</p>
          </div>
          <button aria-label="Close supplier form" className="icon-button" disabled={isSaving} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <form className="workspace-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Supplier name
            <input
              autoFocus
              className="workspace-input"
              data-testid="input-supplier-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="field-label">
            Contact person <span className="field-optional">Optional</span>
            <input
              autoComplete="name"
              className="workspace-input"
              data-testid="input-supplier-contact-person"
              maxLength={120}
              onChange={(event) => setContactPerson(event.target.value)}
              value={contactPerson}
            />
          </label>
          <label className="field-label">
            Phone <span className="field-optional">Optional</span>
            <input
              autoComplete="tel"
              className="workspace-input"
              data-testid="input-supplier-phone"
              inputMode="tel"
              maxLength={40}
              onChange={(event) => setPhone(event.target.value)}
              value={phone}
            />
          </label>
          <label className="field-label">
            WhatsApp number <span className="field-optional">Optional</span>
            <input
              autoComplete="tel"
              className="workspace-input"
              data-testid="input-supplier-whatsapp-phone"
              inputMode="tel"
              maxLength={40}
              onChange={(event) => setWhatsappPhone(event.target.value)}
              value={whatsappPhone}
            />
          </label>
          <label className="field-label">
            Address <span className="field-optional">Optional</span>
            <textarea
              className="workspace-input workspace-textarea"
              data-testid="input-supplier-address"
              maxLength={500}
              onChange={(event) => setAddress(event.target.value)}
              rows={3}
              value={address}
            />
          </label>
          <label className="field-label">
            GST state code <span className="field-optional">Optional</span>
            <input
              className="workspace-input"
              data-testid="input-supplier-state-code"
              inputMode="numeric"
              maxLength={2}
              onChange={(event) => setStateCode(event.target.value.replace(/\D/g, ""))}
              pattern="\d{2}"
              placeholder="e.g. 29"
              value={stateCode}
            />
          </label>
          <label className="field-label">
            Notes <span className="field-optional">Optional</span>
            <textarea
              className="workspace-input workspace-textarea"
              data-testid="input-supplier-notes"
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              value={notes}
            />
          </label>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-primary" data-testid="button-save-supplier" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}