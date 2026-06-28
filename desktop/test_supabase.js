const { app, safeStorage } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const settingsPath = path.join(app.getPath('appData'), 'ctrl2phone', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      console.error('Settings file not found at:', settingsPath);
      app.quit();
      return;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    let key = settings.supabaseKey;

    if (key && safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = Buffer.from(key, 'base64');
        key = safeStorage.decryptString(encrypted);
      } catch (e) {
        console.warn('Decryption failed, using key as plain text');
      }
    }

    console.log('Supabase URL:', settings.supabaseUrl);
    console.log('Decrypted Key length:', key ? key.length : 0);

    const supabase = createClient(settings.supabaseUrl, key);

    // 1. Fetch current contents of clipboard_sync
    console.log('--- Fetching current clipboard_sync rows ---');
    const { data: selectData, error: selectError } = await supabase
      .from('clipboard_sync')
      .select('*')
      .limit(10);

    if (selectError) {
      console.error('Fetch error:', selectError.message);
    } else {
      console.log('Current rows:', selectData);
    }

    // 2. Try inserting a test row
    console.log('--- Inserting test row ---');
    const { data: insertData, error: insertError } = await supabase
      .from('clipboard_sync')
      .insert({
        content: 'Test message from Electron CLI ' + new Date().toISOString(),
        source: 'desktop'
      })
      .select();

    if (insertError) {
      console.error('Insert error:', insertError.message);
    } else {
      console.log('Insert success:', insertData);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    app.quit();
  }
});
