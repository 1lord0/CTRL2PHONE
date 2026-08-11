import fs from 'fs';
import path from 'path';
import ts from 'typescript';

describe('main renderer global-script contract', () => {
  it('does not emit a CommonJS exports preamble that crashes in Chromium', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        isolatedModules: true,
      },
    }).outputText;

    expect(output).not.toContain('Object.defineProperty(exports');
    expect(output).not.toMatch(/\bexports\./);
    expect(output).not.toContain('const bridge = window.bridge');
    expect(output).toContain('const mainBridge = window.bridge');
    expect(output).toContain("document.body.dataset.rendererReady = 'true'");
  });

  it('renders action task updates through text-only DOM sinks', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    expect(html).toContain('id="actionResultCard"');
    expect(html).toContain('id="actionProgressBar"');
    expect(html).toContain('id="actionSources"');
    expect(source).toContain('mainBridge.onActionTaskUpdated');
    expect(source).toContain('actionResultSummary.textContent');
    expect(source).toContain('url.textContent = source.url');
    expect(source).not.toContain('actionResultSummary.innerHTML');
    expect(source).not.toContain('actionSources.innerHTML');
  });
});
