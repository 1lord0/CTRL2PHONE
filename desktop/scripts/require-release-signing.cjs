'use strict';

const required = ['CSC_LINK', 'CSC_KEY_PASSWORD'];
const missing = required.filter((name) => !String(process.env[name] ?? '').trim());

if (missing.length > 0) {
  console.error(
    `Release signing is required. Missing environment variables: ${missing.join(', ')}`
  );
  process.exit(1);
}
