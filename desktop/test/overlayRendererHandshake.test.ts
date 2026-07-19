import fs from 'fs';
import path from 'path';
import ts from 'typescript';

function bridgeCallNames(source: string): ReadonlySet<string> {
  const sourceFile = ts.createSourceFile('overlay.ts', source, ts.ScriptTarget.ES2022, true);
  const calls = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const expr = node.expression.expression;
      if (
        (ts.isPropertyAccessExpression(expr) &&
          expr.expression.getText(sourceFile) === 'window' &&
          expr.name.text === 'bridge') ||
        (ts.isIdentifier(expr) && expr.text === 'overlayBridge')
      ) {
        calls.add(node.expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

describe('overlay renderer handshake contract', () => {
  it('announces initial renderer readiness and acknowledges applied session state', () => {
    // Given
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.ts'), 'utf8');

    // When
    const calls = bridgeCallNames(source);

    // Then
    expect(calls.has('notifyOverlayReady')).toBe(true);
    expect(calls.has('notifyOverlayRendered')).toBe(true);
  });
});
