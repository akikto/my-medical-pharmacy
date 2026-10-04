export function printInventoryDocument(): void {
  const body = document.body;
  body.dataset.inventoryPrint = "true";
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    delete body.dataset.inventoryPrint;
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  cleanupTimer = window.setTimeout(cleanup, 60_000);
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}