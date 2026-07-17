import {
  executeCopySelection,
  CopySelectionPorts,
  NativeImageLike,
} from '../src/lib/copySelection';

describe('executeCopySelection', () => {
  let mockPorts: CopySelectionPorts<NativeImageLike> & {
    isSenderAuthorized: jest.Mock;
    isSessionCurrent: jest.Mock;
    getSelectionImage: jest.Mock;
    writeImageToClipboard: jest.Mock;
    readImageFromClipboard: jest.Mock;
    setStatus: jest.Mock;
  };

  const createMockImage = (empty = false): NativeImageLike => ({
    isEmpty: () => empty,
  });

  beforeEach(() => {
    mockPorts = {
      isSenderAuthorized: jest.fn().mockReturnValue(true),
      isSessionCurrent: jest.fn().mockReturnValue(true),
      getSelectionImage: jest.fn().mockResolvedValue(createMockImage(false)),
      writeImageToClipboard: jest.fn(),
      readImageFromClipboard: jest.fn().mockReturnValue(createMockImage(false)),
      setStatus: jest.fn(),
      onSuccess: jest.fn(),
    };
  });

  it('successful path: writes to clipboard, reads back to verify, and sets status', async () => {
    const mockImg = createMockImage(false);
    mockPorts.getSelectionImage.mockResolvedValue(mockImg);

    const result = await executeCopySelection(mockPorts);

    expect(result).toEqual({ ok: true });
    expect(mockPorts.writeImageToClipboard).toHaveBeenCalledWith(mockImg);
    expect(mockPorts.readImageFromClipboard).toHaveBeenCalled();
    expect(mockPorts.setStatus).toHaveBeenCalledWith('Seçim panoya kopyalandı');
    expect(mockPorts.onSuccess).toHaveBeenCalled();
  });

  it('fails if sender is not authorized', async () => {
    mockPorts.isSenderAuthorized.mockReturnValue(false);

    const result = await executeCopySelection(mockPorts);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized sender');
    expect(mockPorts.writeImageToClipboard).not.toHaveBeenCalled();
    expect(mockPorts.onSuccess).not.toHaveBeenCalled();
  });

  it('fails if session is stale', async () => {
    mockPorts.isSessionCurrent.mockReturnValue(false);

    const result = await executeCopySelection(mockPorts);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Stale session');
    expect(mockPorts.writeImageToClipboard).not.toHaveBeenCalled();
    expect(mockPorts.onSuccess).not.toHaveBeenCalled();
  });

  it('fails if selection image is empty', async () => {
    const emptyImg = createMockImage(true);
    mockPorts.getSelectionImage.mockResolvedValue(emptyImg);

    const result = await executeCopySelection(mockPorts);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Empty selection image');
    expect(mockPorts.writeImageToClipboard).not.toHaveBeenCalled();
    expect(mockPorts.onSuccess).not.toHaveBeenCalled();
  });

  it('fails if clipboard verification fails (readback image is empty)', async () => {
    const mockImg = createMockImage(false);
    const emptyImg = createMockImage(true);
    mockPorts.getSelectionImage.mockResolvedValue(mockImg);
    mockPorts.readImageFromClipboard.mockReturnValue(emptyImg);

    const result = await executeCopySelection(mockPorts);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Clipboard write verification failed');
    expect(mockPorts.writeImageToClipboard).toHaveBeenCalledWith(mockImg);
    expect(mockPorts.onSuccess).not.toHaveBeenCalled();
  });

  it('normalizes unexpected exception into ok: false and doesn not bubble up', async () => {
    mockPorts.getSelectionImage.mockRejectedValue(new Error('Composite rendering failed'));

    const result = await executeCopySelection(mockPorts);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Composite rendering failed');
    expect(mockPorts.onSuccess).not.toHaveBeenCalled();
  });
});
