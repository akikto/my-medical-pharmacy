import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createDatabaseBackup, restoreDatabaseBackup, selectBackupDestination, selectRestoreSource } from "../../services/backupService";
import { getStoreSettings, saveStoreSettings } from "../../services/settingsService";
import type { StoreSettings } from "../../types";
import { DataResetPanel } from "./DataResetPanel";
import { gstStates } from "../../utils/gstStates";
import "./settings.css";

interface SettingsPageProps {
  onDatabaseRestored: () => void;
}

type Notice = { kind: "success" | "error" | "info"; message: string } | null;
type BackupAction = "backup" | "restore" | null;

const emptySettings: StoreSettings = {
  pharmacy_name: "",
  address: "",
  contact_number: "",
  drug_license_number: "",
  receipt_footer_note: "",
  upi_id: "",
  upi_display_name: "",
  gst_enabled: false,
  gst_default_rate_basis_points: null,
  gst_pricing_mode: "EXCLUSIVE",
  gst_pharmacy_state_code: "",
};

function getError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SettingsPage({ onDatabaseRestored }: SettingsPageProps) {
  const [settings, setSettings] = useState<StoreSettings>(emptySettings);
  const [gstDefaultRateInput, setGstDefaultRateInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsRequestKey, setSettingsRequestKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [backupAction, setBackupAction] = useState<BackupAction>(null);
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);
  const [restorePath, setRestorePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    getStoreSettings()
      .then((currentSettings: StoreSettings) => {
        if (cancelled) return;
        setSettings(currentSettings);
        setGstDefaultRateInput(
          currentSettings.gst_default_rate_basis_points === null
            ? ""
            : (currentSettings.gst_default_rate_basis_points / 100).toString(),
        );
        setIsDirty(false);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getError(error, "Pharmacy settings could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsRequestKey]);

  function updateField<K extends keyof StoreSettings>(
    field: K,
    value: StoreSettings[K],
  ) {
    setSettings((current) => ({ ...current, [field]: value }));
    setIsDirty(true);
    setNotice(null);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);
    try {
      await saveStoreSettings(settings);
      setIsDirty(false);
      setNotice({ kind: "success", message: "Pharmacy details saved on this device." });
    } catch (error) {
      setNotice({ kind: "error", message: getError(error, "Pharmacy details could not be saved.") });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBackup() {
    setBackupAction("backup");
    setNotice(null);
    try {
      const destination = await selectBackupDestination();
      if (!destination) {
        setNotice({ kind: "info", message: "Backup cancelled. No file was created." });
        return;
      }
      const result = await createDatabaseBackup(destination);
      const photoLabel = result.photoCount === 1 ? "photo" : "photos";
      const attachmentLabel =
        result.attachmentCount === 1 ? "invoice attachment" : "invoice attachments";
      setNotice({
        kind: "success",
        message: `Complete backup created: ${result.path}. ${result.photoCount} referenced medicine ${photoLabel} and ${result.attachmentCount} purchase ${attachmentLabel} included. Omitted unreferenced files: ${result.ignoredOrphanedPhotoCount} medicine photos and ${result.ignoredOrphanedAttachmentCount} purchase attachments.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: getError(error, "Complete backup could not be created.") });
    } finally {
      setBackupAction(null);
    }
  }

  async function handleSeedDemoData() {
    setIsSeedingDemo(true);
    setNotice(null);
    try {
      const { seedDevelopmentDemoData } = await import(
        "../../services/developmentDemoSeed"
      );
      const result = await seedDevelopmentDemoData();
      setNotice({
        kind: "success",
        message: `Development-only demo data added: ${result.medicines} medicines, ${result.suppliers} suppliers, ${result.purchases} purchases, and ${result.sales} sales. Return to Home to review it.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: getError(error, "Development demo data could not be added."),
      });
    } finally {
      setIsSeedingDemo(false);
    }
  }

  async function beginRestore() {
    setBackupAction("restore");
    setNotice(null);
    try {
      const source = await selectRestoreSource();
      if (!source) {
        setNotice({ kind: "info", message: "Restore cancelled. The current database was not changed." });
        return;
      }
      setRestorePath(source);
    } catch (error) {
      setNotice({ kind: "error", message: getError(error, "A backup file could not be selected.") });
    } finally {
      setBackupAction(null);
    }
  }

  async function confirmRestore() {
    if (!restorePath) return;
    const source = restorePath;
    setBackupAction("restore");
    setNotice(null);
    try {
      const result = await restoreDatabaseBackup(source);
      setRestorePath(null);
      onDatabaseRestored();
      const photoLabel =
        result.restoredPhotoCount === 1 ? "photo" : "photos";
      const attachmentLabel =
        result.restoredAttachmentCount === 1
          ? "purchase attachment"
          : "purchase attachments";
      const restoreContents =
        result.sourceFormat === "complete"
          ? `${result.restoredPhotoCount} referenced medicine ${photoLabel} and ${result.restoredAttachmentCount} ${attachmentLabel} restored`
          : `${result.restoredPhotoCount} referenced medicine ${photoLabel} and ${result.restoredAttachmentCount} ${attachmentLabel} matched from this device`;
      const omittedPhotos =
        result.sourceFormat === "complete" &&
        (result.ignoredOrphanedPhotoCount > 0 ||
          result.ignoredOrphanedAttachmentCount > 0)
          ? ` Unreferenced files omitted from the backup: ${result.ignoredOrphanedPhotoCount} medicine photos and ${result.ignoredOrphanedAttachmentCount} purchase attachments.`
          : "";
      setNotice({
        kind: "success",
        message: `Backup restored. ${restoreContents}.${omittedPhotos} Safety copy saved at ${result.safetyBackupPath}. The app is refreshing its data.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: getError(
          error,
          "The database restore failed. Review the error and safety-backup status before retrying.",
        ),
      });
      setBackupAction(null);
      return;
    } finally {
      setBackupAction(null);
    }
  }

  return (
    <section className="workspace-page settings-page" data-testid="page-settings">
      <header className="workspace-page-header settings-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> DEVICE &amp; RECEIPT</div>
          <h1>Settings</h1>
          <p>Keep pharmacy identity and a safe local copy of your records up to date.</p>
        </div>
        <div className="settings-private-badge"><ShieldCheck size={15} /> Stored on this device</div>
      </header>

      {notice && (
        <div className={`workspace-notice settings-notice settings-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid={`status-settings-${notice.kind}`}>
          {notice.kind === "success" ? <CheckCircle2 size={16} /> : notice.kind === "error" ? <AlertCircle size={16} /> : <FolderOpen size={16} />}
          <span>{notice.message}</span>
          <button aria-label="Dismiss message" className="notice-close" data-testid="button-dismiss-settings-notice" onClick={() => setNotice(null)} type="button"><X size={15} /></button>
        </div>
      )}

      {loadError && (
        <div className="workspace-error workspace-error--banner settings-load-error" role="alert" data-testid="status-settings-load-error">
          <AlertCircle size={16} /><span>{loadError}</span>
          <button className="button button-secondary" data-testid="button-retry-settings-load" onClick={() => setSettingsRequestKey((current) => current + 1)} type="button"><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      <div className="settings-layout">
        <section className="workspace-card settings-card" aria-labelledby="pharmacy-profile-title">
          <div className="settings-card-heading">
            <span className="settings-heading-mark"><FileArchive size={17} /></span>
            <div><h2 id="pharmacy-profile-title">Pharmacy details</h2><p>Printed at the top and bottom of customer receipts.</p></div>
          </div>

          {isLoading ? (
            <div className="settings-form-skeleton" aria-busy="true" data-testid="loading-settings">
              {[1, 2, 3, 4, 5].map((row) => <span key={row} />)}
            </div>
          ) : !loadError && (
            <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
              <label className="settings-field settings-field--wide">
                <span>Pharmacy name <b aria-hidden="true">*</b></span>
                <input autoComplete="organization" className="workspace-input" data-testid="input-pharmacy-name" maxLength={160} onChange={(event) => updateField("pharmacy_name", event.target.value)} required value={settings.pharmacy_name} />
              </label>
              <label className="settings-field settings-field--wide">
                <span>Address</span>
                <textarea autoComplete="street-address" className="workspace-input workspace-textarea" data-testid="input-pharmacy-address" maxLength={500} onChange={(event) => updateField("address", event.target.value)} rows={3} value={settings.address} />
              </label>
              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>Contact number</span>
                  <input autoComplete="tel" className="workspace-input" data-testid="input-pharmacy-contact" inputMode="tel" maxLength={40} onChange={(event) => updateField("contact_number", event.target.value)} type="tel" value={settings.contact_number} />
                </label>
                <label className="settings-field">
                  <span>Drug license number</span>
                  <input className="workspace-input" data-testid="input-drug-license" maxLength={100} onChange={(event) => updateField("drug_license_number", event.target.value)} value={settings.drug_license_number} />
                </label>
              </div>
              <label className="settings-field settings-field--wide">
                <span>Receipt footer note</span>
                <textarea className="workspace-input workspace-textarea settings-footer-note" data-testid="input-receipt-footer-note" maxLength={300} onChange={(event) => updateField("receipt_footer_note", event.target.value)} placeholder="A short note printed at the bottom of each receipt" rows={3} value={settings.receipt_footer_note} />
                <small>Up to 300 characters.</small>
              </label>
              <section className="settings-subsection settings-field--wide" aria-labelledby="gst-settings-title">
                <div className="settings-subsection-heading">
                  <div>
                    <h3 id="gst-settings-title">GST configuration</h3>
                    <p>Rates and pricing mode are configurable. No rate is assumed.</p>
                  </div>
                  <label className="settings-toggle-field">
                    <input
                      checked={settings.gst_enabled}
                      data-testid="checkbox-gst-enabled"
                      onChange={(event) => updateField("gst_enabled", event.target.checked)}
                      type="checkbox"
                    />
                    <span>Enable GST</span>
                  </label>
                </div>
                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span>Default GST rate (%) <small>Optional</small></span>
                    <input
                      className="workspace-input"
                      data-testid="input-gst-default-rate"
                      inputMode="decimal"
                      max="100"
                      min="0"
                      onChange={(event) => {
                        const value = event.target.value;
                        setGstDefaultRateInput(value);
                        updateField(
                          "gst_default_rate_basis_points",
                          value.trim() === "" ? null : Math.round(Number(value) * 100),
                        );
                      }}
                      placeholder="Set only if applicable"
                      step="0.01"
                      type="number"
                      value={gstDefaultRateInput}
                    />
                    <small>Medicine-specific rates take precedence.</small>
                  </label>
                  <label className="settings-field">
                    <span>Default pricing mode</span>
                    <select
                      className="workspace-input"
                      data-testid="select-gst-pricing-mode"
                      onChange={(event) =>
                        updateField(
                          "gst_pricing_mode",
                          event.target.value as StoreSettings["gst_pricing_mode"],
                        )
                      }
                      value={settings.gst_pricing_mode}
                    >
                      <option value="EXCLUSIVE">GST added to the listed price</option>
                      <option value="INCLUSIVE">Listed price includes GST</option>
                    </select>
                  </label>
                  <label className="settings-field settings-field--wide">
                    <span>Pharmacy GST state</span>
                    <select
                      className="workspace-input"
                      data-testid="select-pharmacy-gst-state"
                      onChange={(event) =>
                        updateField("gst_pharmacy_state_code", event.target.value)
                      }
                      value={settings.gst_pharmacy_state_code}
                    >
                      <option value="">Choose a state or union territory</option>
                      {gstStates.map((state) => (
                        <option key={state.code} value={state.code}>
                          {state.code} · {state.name}
                        </option>
                      ))}
                    </select>
                    <small>Required to compare customer and pharmacy states for CGST/SGST or IGST.</small>
                  </label>
                </div>
              </section>
              <section className="settings-subsection settings-field--wide" aria-labelledby="upi-settings-title">
                <div className="settings-subsection-heading">
                  <div>
                    <h3 id="upi-settings-title">UPI payment link</h3>
                    <p>Used to create a payment-app link at checkout.</p>
                  </div>
                </div>
                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span>UPI ID</span>
                    <input
                      autoComplete="off"
                      className="workspace-input"
                      data-testid="input-pharmacy-upi-id"
                      maxLength={100}
                      onChange={(event) => updateField("upi_id", event.target.value)}
                      placeholder="name@bank"
                      value={settings.upi_id}
                    />
                  </label>
                  <label className="settings-field">
                    <span>Payee name</span>
                    <input
                      className="workspace-input"
                      data-testid="input-pharmacy-upi-name"
                      maxLength={120}
                      onChange={(event) => updateField("upi_display_name", event.target.value)}
                      value={settings.upi_display_name}
                    />
                  </label>
                  <p className="settings-upi-note settings-field--wide">
                    The app can create a UPI link, but cannot verify payment status. UPI invoices are saved as unverified.
                  </p>
                </div>
              </section>
              <footer className="settings-form-footer">
                <span className="settings-save-state" data-testid="status-settings-dirty">
                  {isDirty ? "Unsaved changes" : "All changes saved"}
                </span>
                <button className="button button-primary" data-testid="button-save-settings" disabled={!isDirty || isSaving || backupAction !== null || restorePath !== null} type="submit">
                  {isSaving ? <LoaderCircle className="settings-button-spin" size={15} /> : <Save size={15} />}
                  {isSaving ? "Saving details…" : "Save details"}
                </button>
              </footer>
            </form>
          )}
        </section>

        <aside className="settings-side-column">
          <section className="workspace-card backup-card" aria-labelledby="database-backup-title">
            <div className="settings-card-heading">
              <span className="settings-heading-mark settings-heading-mark--backup"><DatabaseBackup size={17} /></span>
              <div><h2 id="database-backup-title">Complete backup</h2><p>One local ZIP file contains the database and referenced medicine photos. Legacy .db restore is supported.</p></div>
            </div>
            <div className="backup-assurance">
              <ShieldCheck size={16} />
              <span><strong>Private and local</strong><small>Your sales, stock, settings, and medicine photos stay on this device unless you choose a destination.</small></span>
            </div>
            <div className="backup-actions">
              <button className="button button-primary settings-backup-button" data-testid="button-create-backup" disabled={backupAction !== null || restorePath !== null} onClick={() => void handleBackup()} type="button">
                {backupAction === "backup" ? <LoaderCircle className="settings-button-spin" size={15} /> : <ArrowDownToLine size={15} />}
                {backupAction === "backup" ? "Creating backup…" : "Create complete backup"}
              </button>
              <button className="button button-secondary settings-restore-button" data-testid="button-select-restore" disabled={backupAction !== null || restorePath !== null} onClick={() => void beginRestore()} type="button">
                {backupAction === "restore" ? <LoaderCircle className="settings-button-spin" size={15} /> : <RotateCcw size={15} />}
                Restore from backup
              </button>
            </div>
            <p className="backup-caution">A complete restore replaces the active database and medicine photos. Legacy .db files are accepted only when their referenced photos are already available locally. A safety copy is saved first.</p>
          </section>

          <DataResetPanel />

          <section className="settings-device-note">
            <span><CheckCircle2 size={15} /></span>
            <div><strong>Offline-first by design</strong><p>Pharmacy settings and backups are managed locally. No network connection is required.</p></div>
          </section>

          {import.meta.env.DEV && (
            <section className="workspace-card dev-demo-card" aria-labelledby="dev-demo-title" data-testid="panel-dev-demo-seed">
              <div className="settings-card-heading">
                <span className="settings-heading-mark settings-heading-mark--dev"><DatabaseBackup size={17} /></span>
                <div>
                  <span className="dev-demo-label">DEVELOPMENT ONLY</span>
                  <h2 id="dev-demo-title">Dashboard demo data</h2>
                  <p>Never used as real pharmacy or customer data.</p>
                </div>
              </div>
              <p className="dev-demo-safety">
                Uses existing app models and business rules. Seeding is refused unless every pharmacy data table is empty.
              </p>
              <button
                className="button button-secondary dev-demo-button"
                data-testid="button-seed-dev-demo"
                disabled={isSeedingDemo || isLoading || backupAction !== null || restorePath !== null}
                onClick={() => void handleSeedDemoData()}
                type="button"
              >
                {isSeedingDemo ? <LoaderCircle className="settings-button-spin" size={15} /> : <DatabaseBackup size={15} />}
                {isSeedingDemo ? "Adding demo data…" : "Seed development demo data"}
              </button>
            </section>
          )}
        </aside>
      </div>

      {restorePath && (
        <div className="inventory-dialog-backdrop settings-dialog-backdrop" data-testid="dialog-confirm-restore">
          <section aria-describedby="restore-confirm-description" aria-labelledby="restore-confirm-title" aria-modal="true" className="workspace-dialog workspace-dialog--narrow settings-restore-dialog" role="alertdialog">
            <span className="settings-restore-icon"><RotateCcw size={20} /></span>
            <span className="eyebrow">LOCAL BACKUP RESTORE</span>
            <h2 id="restore-confirm-title">Replace this device’s pharmacy data?</h2>
            <p id="restore-confirm-description">A complete .zip replaces the database and referenced medicine photos. A legacy .db backup is accepted only when all referenced photos are already available here. A safety copy is saved internally before restore.</p>
            <div className="restore-file-label"><FolderOpen size={14} /><span title={restorePath}>{restorePath}</span></div>
            <div className="dialog-actions settings-restore-actions">
              <button className="button button-secondary" data-testid="button-cancel-restore" disabled={backupAction === "restore"} onClick={() => {
                setRestorePath(null);
                setNotice({ kind: "info", message: "Restore cancelled. The current pharmacy data and photos were not changed." });
              }} type="button">Cancel</button>
              <button className="button button-primary" data-testid="button-confirm-restore" disabled={backupAction === "restore"} onClick={() => void confirmRestore()} type="button">
                {backupAction === "restore" ? <LoaderCircle className="settings-button-spin" size={15} /> : <RotateCcw size={15} />}
                {backupAction === "restore" ? "Restoring…" : "Restore backup"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}