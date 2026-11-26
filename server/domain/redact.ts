/** Removes credentials and query strings from provider/error text before storage. */
export function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|signature|password)=([^&\s]+)/gi, '$1=***')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?…');
}
