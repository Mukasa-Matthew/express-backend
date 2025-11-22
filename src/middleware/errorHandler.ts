import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/apiResponse';

/**
 * Global Error Handler Middleware
 * Standardizes error responses across all endpoints
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log error details
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
  });

  // Ensure CORS headers are set even on errors (if origin is present)
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Handle known error types
  if (err.name === 'ValidationError') {
    sendError(res, err.message || 'Validation error', 400, 'VALIDATION_ERROR', err.details);
    return;
  }

  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
    return;
  }

  if (err.name === 'CastError') {
    sendError(res, 'Invalid ID format', 400, 'INVALID_ID');
    return;
  }

  // Database errors
  if (err.code === '23505') { // Unique violation
    sendError(res, 'Duplicate entry', 409, 'DUPLICATE_ENTRY');
    return;
  }

  if (err.code === '23503') { // Foreign key violation
    sendError(res, 'Referenced record does not exist', 400, 'FOREIGN_KEY_VIOLATION');
    return;
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';
  
  sendError(
    res,
    process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    statusCode,
    'INTERNAL_ERROR',
    process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined
  );
}

/**
 * Async error wrapper - catches errors from async route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


