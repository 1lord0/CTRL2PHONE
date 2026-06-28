const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  try {
    const settingsPath = path.join(app.getPath('appData'), 'ctrl2phone', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      let key = settings.supabaseKey;
      if (key && safeStorage.isEncryptionAvailable()) {
        const encrypted = Buffer.from(key, 'base64');
        key = safeStorage.decryptString(encrypted);
      }
      console.log('SUPABASE_URL=' + settings.supabaseUrl);
      console.log('SUPABASE_KEY=' + key);
    } else {
      console.error('Settings not found');
    }
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
