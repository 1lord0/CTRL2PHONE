const fs = require('fs');
const { buildRlsSetupSql } = require('../dist/js/lib/supabaseSetup.js');
fs.writeFileSync('../setup_supabase.sql', buildRlsSetupSql('screenshots'), 'utf8');
console.log('Updated setup_supabase.sql successfully');
