export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '没有权限执行此操作') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '资源不存在') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const rateLimited = (message = '操作过于频繁，请稍后再试') => new AppError(429, 'RATE_LIMITED', message);

export const ROLE_RANK = { member: 1, admin: 2, owner: 3 } as const;
export type WorkspaceRole = keyof typeof ROLE_RANK;
export type PlatformRole = 'user' | 'admin';

export function hasRole(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function assertRole(role: WorkspaceRole, min: WorkspaceRole): void {
  if (!hasRole(role, min)) throw forbidden(min === 'owner' ? '仅工作区所有者可操作' : '需要管理员权限');
}
