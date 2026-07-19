import { executeSelectionOcrAction, type SelectionOcrActionPorts } from '../src/main/selectionOcrAction';

describe('SelectionOcrAction', () => {
  let isCurrent = true;
  let isAction = true;
  let ocrInFlight = false;
  let extractedText = 'Hello World';
  let extractedSource = 'windows';
  let clipboardWriteSuccess = true;
  
  // Triggers
  let hiddenOverlay = false;
  let resetSession = false;
  let statusMsg = '';
  let responseMsg = '';
  let transientPillActivated = false;
  let ocrStateChanges: boolean[] = [];
  let clipboardText = '';
  let guardClipboardCalled = false;

  const ports: SelectionOcrActionPorts<string> = {
    isSelectionSessionCurrent: () => isCurrent,
    isActionCurrent: () => isAction,
    beginSelectionAction: () => 100,
    endSelectionAction: () => {},
    isOcrInFlight: () => ocrInFlight,
    setOcrInFlight: (val) => {
      ocrInFlight = val;
      ocrStateChanges.push(val);
    },
    hideSelectionOverlay: () => { hiddenOverlay = true; },
    resetSelectionSession: () => { resetSession = true; },
    setStatus: (msg) => { statusMsg = msg; },
    setResponse: (msg) => { responseMsg = msg; },
    activateTransientPill: () => { transientPillActivated = true; },
    guardLocalClipboard: () => { guardClipboardCalled = true; },
    writeTextToClipboardReliable: async (text) => {
      if (clipboardWriteSuccess) {
        clipboardText = text;
        return true;
      }
      return false;
    },
    extractTextFromImage: async () => {
      return { text: extractedText, source: extractedSource };
    },
    getProviderName: () => 'mock-ai',
    resolveSelectionImage: async () => 'mock-image',
    getImagePngBuffer: () => Buffer.from('mock-png'),
  };

  beforeEach(() => {
    isCurrent = true;
    isAction = true;
    ocrInFlight = false;
    extractedText = 'Hello World';
    extractedSource = 'windows';
    clipboardWriteSuccess = true;
    hiddenOverlay = false;
    resetSession = false;
    statusMsg = '';
    responseMsg = '';
    transientPillActivated = false;
    ocrStateChanges = [];
    clipboardText = '';
    guardClipboardCalled = false;
  });

  it('runs OCR and copies result to clipboard successfully', async () => {
    await executeSelectionOcrAction(1, ports);

    expect(ocrStateChanges).toEqual([true, false]);
    expect(clipboardText).toBe('Hello World');
    expect(statusMsg).toBe('Metin panoya kopyalandı (Windows OCR) - Ctrl+V ile yapıştır');
  });

  it('aborts immediately if OCR is already in flight', async () => {
    ocrInFlight = true;
    await executeSelectionOcrAction(1, ports);

    expect(statusMsg).toBe('OCR zaten çalışıyor, lütfen bekleyin...');
    expect(ocrStateChanges).toEqual([]);
  });

  it('handles empty extracted text', async () => {
    extractedText = '';
    await executeSelectionOcrAction(1, ports);

    expect(statusMsg).toBe('OCR tamamlandı - metin yok');
    expect(responseMsg).toBe('Seçilen alanda okunabilir metin bulunamadı.');
  });

  it('handles clipboard write failure gracefully', async () => {
    clipboardWriteSuccess = false;
    await executeSelectionOcrAction(1, ports);

    expect(statusMsg).toBe('OCR metni üretildi ama panoya yazılamadı - metni response alanından kopyalayın');
    expect(responseMsg).toContain('Panoya otomatik kopyalanamadı');
  });
});
