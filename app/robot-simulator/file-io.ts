type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

export type SaveResult =
  | { status: 'saved'; filename: string }
  | { status: 'cancelled' }
  | { status: 'download-started' };

export async function saveJsonFile(filename: string, content: string): Promise<SaveResult> {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  const blob = new Blob([content], { type: 'application/json' });

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', filename: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' };
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { status: 'download-started' };
}
