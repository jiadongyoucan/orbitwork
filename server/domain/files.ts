/**
 * Pure file-name and content-type rules. No I/O, no Fastify, no DB.
 * Kept pure so the security-critical parts are unit-testable.
 */

export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'env', 'log',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'htm', 'xml', 'sh', 'bash', 'zsh',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'vue', 'svelte',
]);

/** Returns a display-safe name, or null when the input cannot be used. */
export function normalizeFileName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ');
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  if (cleaned.length > 120) return null;
  return cleaned;
}

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function isTextLike(name: string, mime = ''): boolean {
  const value = mime.toLowerCase();
  if (value.startsWith('text/')) return true;
  if (/^application\/(json|xml|x-yaml|yaml|javascript|x-sh|x-httpd-php|sql|toml)/.test(value)) return true;
  return TEXT_EXTENSIONS.has(extensionOf(name));
}

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpeg|jpg|webp|gif|avif)$/.test(mime.toLowerCase());
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', jsonl: 'application/x-ndjson',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', ini: 'text/plain', env: 'text/plain',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain', xml: 'application/xml', svg: 'image/svg+xml',
  py: 'text/plain', sh: 'text/plain', sql: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  pdf: 'application/pdf', zip: 'application/zip',
};

export function mimeFromName(name: string, fallback = 'application/octet-stream'): string {
  return MIME_BY_EXT[extensionOf(name)] ?? fallback;
}
