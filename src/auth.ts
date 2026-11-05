import { Request, Response, NextFunction } from "express";
import { verifyToken, getAdminById } from "./services/adminService";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

// JWT auth middleware
export function requireAuth(requiredRoles?: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Verify user still exists and is active
    const user = await getAdminById(payload.userId);
    if (!user || !user.is_active) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }

    // Check role if required
    if (requiredRoles && !requiredRoles.includes(payload.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    req.user = payload;
    next();
  };
}

// In-memory rate limiter
const rateLimitMap = new Map<
  string,
  { count: number; resetTime: number }
>();

export function rateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetIn: number } {
  // Bypass rate limiting in development
  if (process.env.NODE_ENV === "development") {
    return { allowed: true, remaining: maxRequests, resetIn: 0 };
  }

  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetIn: entry.resetTime - now,
  };
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);
