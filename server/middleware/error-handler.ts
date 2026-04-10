import type { Request, Response } from "express";

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, any>;
    request_id: string;
  };
}

/**
 * Generate a unique request ID for tracking/debugging.
 */
export function generateRequestId(req: Request): string {
  return (req.headers["x-request-id"] as string) || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send a structured error response following the PRM API error format.
 */
export function sendApiError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details: Record<string, any> = {},
  requestId?: string,
): void {
  const reqId = requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  res.status(statusCode).json({
    error: {
      code,
      message,
      details,
      request_id: reqId,
    },
  });
}

// Common error codes
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  SOCIAL_ACCOUNT_NOT_FOUND: "SOCIAL_ACCOUNT_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  BULK_LIMIT_EXCEEDED: "BULK_LIMIT_EXCEEDED",
} as const;
