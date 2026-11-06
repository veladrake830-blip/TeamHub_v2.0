export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Please log in.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message);
