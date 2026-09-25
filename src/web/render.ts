import type { WorkbenchDiagnostic } from "./types.js";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderDiagnostics(diagnostics: WorkbenchDiagnostic[], title: string): string {
  if (diagnostics.length === 0) return "";
  const items = diagnostics
    .map((diag) => {
      const ref = diag.reference
        ? ` <span class="diagnostic-ref">(${escapeHtml(diag.reference)})</span>`
        : "";
      return `
        <li class="diagnostic-item">
          <span class="diagnostic-source-badge">${escapeHtml(diag.source)}</span>
          <code class="diagnostic-code">${escapeHtml(diag.code)}</code>:
          <span class="diagnostic-message">${escapeHtml(diag.message)}</span>${ref}
        </li>
      `;
    })
    .join("\n");

  return `
    <section class="diagnostics-panel" aria-label="${escapeHtml(title)}">
      <div class="diagnostics-header">
        <span class="diagnostics-icon" aria-hidden="true">⚠️</span>
        <h3 class="diagnostics-title">${escapeHtml(title)} (${diagnostics.length})</h3>
      </div>
      <ul class="diagnostics-list">
        ${items}
      </ul>
    </section>
  `;
}
