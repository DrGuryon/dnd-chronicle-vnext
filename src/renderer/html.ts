import type { EntitySummary } from '../shared/read-models';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function entityReference(
  reference: EntitySummary | null,
  className = 'entity-reference',
): string {
  if (!reference) return '';
  return `
    <button
      type="button"
      class="${escapeHtml(className)}"
      data-entity-id="${escapeHtml(reference.id)}"
      data-entity-kind="${escapeHtml(reference.kind)}"
      data-character-context="${escapeHtml(reference.contextCharacterId ?? '')}"
      title="Otevřít ${escapeHtml(reference.kind)} Card"
    >
      <span>${escapeHtml(reference.label)}</span>
      ${reference.subtitle ? `<small>${escapeHtml(reference.subtitle)}</small>` : ''}
    </button>
  `;
}

export function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '');
}
