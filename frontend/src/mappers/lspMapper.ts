import type * as Monaco from 'monaco-editor';

export function mapLspDiagnosticsToMonacoMarkers(
  diagnostics: any[],
  monacoInstance: typeof Monaco
): Monaco.editor.IMarkerData[] {
  return (diagnostics ?? []).map((d: any) => ({
    startLineNumber: (d.range?.start?.line ?? 0) + 1,
    startColumn:     (d.range?.start?.character ?? 0) + 1,
    endLineNumber:   (d.range?.end?.line ?? 0) + 1,
    endColumn:       (d.range?.end?.character ?? 0) + 1,
    message:         d.message ?? '',
    severity: ({
      1: monacoInstance.MarkerSeverity.Error,
      2: monacoInstance.MarkerSeverity.Warning,
      3: monacoInstance.MarkerSeverity.Info,
      4: monacoInstance.MarkerSeverity.Hint,
    } as Record<number, Monaco.MarkerSeverity>)[d.severity] ?? monacoInstance.MarkerSeverity.Error,
    source: d.source ?? 'lsp',
    code: d.code != null ? String(d.code) : undefined,
  }));
}
