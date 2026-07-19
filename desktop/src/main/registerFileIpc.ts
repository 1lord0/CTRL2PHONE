import { IpcMain } from 'electron';

export interface FileIpcDeps {
  isShutdownStarted(): boolean;
  isMainWindowSender(sender: any): boolean;
  uploadFileToPhone(filePath: string): Promise<boolean>;
  resolveMainWindowDownload(sender: any, requestedPath: any): string | null;
  unlinkFile(filePath: string): Promise<void>;
  removeDownloadedFile(filePath: string): void;
  broadcastPhoneDownloads(): void;
  createNativeImageFromPath(filePath: string): any;
  createNativeImageFromBuffer(buffer: Buffer): any;
  getDownloadedPhoneFiles(): string[];
}

export function registerFileIpc(ipc: IpcMain, deps: FileIpcDeps): () => void {
  ipc.handle('upload-file-to-phone', async (event: any, filePath: unknown) => {
    if (!deps.isMainWindowSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted() || typeof filePath !== 'string') {
      return { ok: false };
    }
    const ok = await deps.uploadFileToPhone(filePath);
    return { ok };
  });

  ipc.handle('delete-downloaded-file', async (event: any, requestedPath: unknown) => {
    if (!deps.isMainWindowSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const filePath = deps.resolveMainWindowDownload(event.sender, requestedPath);
    if (!filePath) return { ok: false };

    try {
      await deps.unlinkFile(filePath);
    } catch (error) {
      console.error('Failed to delete downloaded phone file:', error);
      return { ok: false };
    }

    deps.removeDownloadedFile(filePath);
    deps.broadcastPhoneDownloads();
    return { ok: true };
  });

  const onDrag = (event: any, requestedPath: unknown) => {
    if (!deps.isMainWindowSender(event.sender)) return;
    if (deps.isShutdownStarted()) return;
    const filePath = deps.resolveMainWindowDownload(event.sender, requestedPath);
    if (!filePath) return;
    console.log('[main.ts] start-drag-downloaded-file:', filePath);
    let icon = deps.createNativeImageFromPath(filePath);
    if (icon.isEmpty()) {
      icon = deps.createNativeImageFromBuffer(
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
          0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
          0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
          0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ])
      );
    } else {
      const size = icon.getSize();
      const maxDim = 150;
      if (size.width > maxDim || size.height > maxDim) {
        const scale = Math.min(maxDim / size.width, maxDim / size.height);
        icon = icon.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: 'good',
        });
      }
    }
    try {
      event.sender.startDrag({
        file: filePath,
        icon: icon,
      });
    } catch (error) {
      console.error('startDrag for downloaded file failed:', error);
    }
  };

  ipc.on('start-drag-downloaded-file', onDrag);

  return () => {
    ipc.removeHandler('upload-file-to-phone');
    ipc.removeHandler('delete-downloaded-file');
    ipc.removeListener('start-drag-downloaded-file', onDrag);
  };
}
