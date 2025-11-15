/**
 * Standardized API Response Utilities
 * Ensures consistent response format across all endpoints
 */

export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error?: {
    code?: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

/**
 * Create a success response
 */
export function successResponse<T>(
  data?: T,
  message?: string,
  meta?: ApiResponse<T>['meta']
): ApiResponse<T> {
  const response: ApiResponse<T> = {
    status: 'success',
  };

  if (data !== undefined) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  if (meta) {
    response.meta = meta;
  }

  return response;
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  code?: string,
  details?: any
): ApiResponse {
  const response: ApiResponse = {
    status: 'error',
    message,
  };

  if (code || details) {
    response.error = {};
    if (code) response.error.code = code;
    if (details) response.error.details = details;
  }

  return response;
}

/**
 * Express response helper - send success response
 */
export function sendSuccess<T>(
  res: any,
  data?: T,
  message?: string,
  statusCode: number = 200,
  meta?: ApiResponse<T>['meta']
): void {
  res.status(statusCode).json(successResponse(data, message, meta));
}

/**
 * Express response helper - send error response
 */
export function sendError(
  res: any,
  message: string,
  statusCode: number = 400,
  code?: string,
  details?: any
): void {
  res.status(statusCode).json(errorResponse(message, code, details));
}


