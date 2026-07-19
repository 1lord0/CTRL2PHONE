# Ctrl2Phone Desktop

Electron-based desktop application for Ctrl2Phone project.

## Development

### Prerequisites
- Node.js
- npm

### Installation
```bash
npm install
```

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

### Format
```bash
npm run format
```

### Lint
```bash
npm run lint
```

## Security Hardening

This application implements several security measures:
- Scoped preload scripts (main, overlay, notification)
- IPC sender validation
- Path containment checks for file downloads
- Navigation/window-open blocking
- Windows junction/reparse point protection

## Project Structure
- `src/main/` - Main process code
- `src/preload-*.ts` - Scoped preload scripts
- `test/` - Jest test suites
- `dist/` - Build output (gitignored)
