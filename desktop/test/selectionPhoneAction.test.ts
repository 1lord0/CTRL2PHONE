import { executeSelectionPhoneAction, type SelectionPhoneActionPorts } from '../src/main/selectionPhoneAction';

describe('SelectionPhoneAction', () => {
  let isCurrent = true;
  let isAction = true;
  let supabaseContext: any = { generation: 1 };
  let isContextCurrent = true;
  let uploadError: any = null;
  let signedUrl: string | null = 'http://supabase.com/signed-url';
  
  // Triggers
  let hiddenOverlay = false;
  let resetSession = false;
  let statusMsg = '';
  let responseMsg = '';
  let transientPillActivated = false;
  let uploadCalled = false;
  let uuidGenerated = false;

  const ports: SelectionPhoneActionPorts<string, any> = {
    isSelectionSessionCurrent: () => isCurrent,
    isActionCurrent: () => isAction,
    beginSelectionAction: () => 100,
    endSelectionAction: () => {},
    getSupabaseContext: () => supabaseContext,
    isSupabaseContextCurrent: () => isContextCurrent,
    hideSelectionOverlay: () => { hiddenOverlay = true; },
    resetSelectionSession: () => { resetSession = true; },
    setStatus: (msg) => { statusMsg = msg; },
    setResponse: (msg) => { responseMsg = msg; },
    activateTransientPill: () => { transientPillActivated = true; },
    uploadToSupabase: async () => {
      uploadCalled = true;
      return { error: uploadError };
    },
    createSignedUrl: async () => signedUrl,
    generateRandomUUID: () => {
      uuidGenerated = true;
      return '1234-uuid';
    },
    resolveSelectionImage: async () => 'mock-image',
    getImagePngBuffer: () => Buffer.from('mock-png'),
  };

  beforeEach(() => {
    isCurrent = true;
    isAction = true;
    supabaseContext = { generation: 1 };
    isContextCurrent = true;
    uploadError = null;
    signedUrl = 'http://supabase.com/signed-url';
    hiddenOverlay = false;
    resetSession = false;
    statusMsg = '';
    responseMsg = '';
    transientPillActivated = false;
    uploadCalled = false;
    uuidGenerated = false;
  });

  it('uploads image and sets signed url correctly on success', async () => {
    const success = await executeSelectionPhoneAction(1, ports);

    expect(success).toBe(true);
    expect(uploadCalled).toBe(true);
    expect(uuidGenerated).toBe(true);
    expect(responseMsg).toContain('http://supabase.com/signed-url');
    expect(statusMsg).toBe('Seçilen görsel telefona gönderildi (Supabase)');
  });

  it('fails if supabase context is missing', async () => {
    supabaseContext = null;
    const success = await executeSelectionPhoneAction(1, ports);

    expect(success).toBe(false);
    expect(statusMsg).toBe('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
  });

  it('fails if context changes during upload', async () => {
    isContextCurrent = false;
    const success = await executeSelectionPhoneAction(1, ports);

    expect(success).toBe(false);
    expect(statusMsg).toBe('Supabase yükleme hatası');
    expect(responseMsg).toContain('Supabase ayarları yükleme sırasında değişti');
  });

  it('handles upload errors', async () => {
    uploadError = { message: 'Network error' };
    const success = await executeSelectionPhoneAction(1, ports);

    expect(success).toBe(false);
    expect(statusMsg).toBe('Supabase yükleme hatası');
    expect(responseMsg).toContain('Network error');
  });
});
