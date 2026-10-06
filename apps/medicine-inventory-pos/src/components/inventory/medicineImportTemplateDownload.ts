type SetLoading = (loading: boolean) => void;
type SetMessage = (message: string | null) => void;

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return "Could not create the import template.";
}

export function createMedicineImportTemplateDownloadHandler(
  download: () => Promise<boolean>,
  setLoading: SetLoading,
  setError: SetMessage,
  setNotice: SetMessage,
): () => Promise<void> {
  let inProgress = false;

  return async () => {
    if (inProgress) return;
    inProgress = true;

    try {
      setLoading(true);
      setError(null);
      setNotice(null);
      const saved = await download();
      if (saved) setNotice("Template saved successfully.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
      inProgress = false;
    }
  };
}
