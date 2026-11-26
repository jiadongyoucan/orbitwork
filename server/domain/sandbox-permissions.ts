/**
 * Flags for the sandbox child process. Exported so the worker and the escape
 * regression test share one definition — a widened worker cannot pass tests
 * that still use a narrower hand-copied list.
 */
export function sandboxPermissionFlags(dir: string, realDir: string): string[] {
  return [
    '--permission',
    '--allow-fs-read=/tmp',
    '--allow-fs-read=/private/tmp',
    `--allow-fs-read=${dir}`,
    `--allow-fs-read=${realDir}`,
    '--frozen-intrinsics',
    '--max-old-space-size=128',
    '--no-warnings',
  ];
}
