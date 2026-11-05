import { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, RateBucket>();
const userBuckets = new Map<string, RateBucket>();

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

export function traceRateLimiter(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const windowMs = 60_000;
  const userId = req.headers['x-user-uid'] as string | undefined;

  if (userId) {
    const limit = 60;
    const bucket = userBuckets.get(userId);
    if (!bucket || now > bucket.resetAt) {
      userBuckets.set(userId, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= limit) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message_bn: 'আপনি প্রতি মিনিটে ৬০টির বেশি অনুরোধ পাঠিয়েছেন। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।',
          message_en: 'Rate limit exceeded (60 requests/min per user). Please wait a moment.',
        },
      });
    }
    bucket.count += 1;
    return next();
  }

  const ip = (req.ip || req.socket.remoteAddress || 'anon').toString();
  const limit = 20;
  const bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (bucket.count >= limit) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message_bn: 'প্রতি মিনিটে সর্বোচ্চ ২০টি ভিজ্যুয়ালাইজ অনুরোধ করা যায়। অনুগ্রহ করে একটু পর আবার চেষ্টা করুন।',
        message_en: 'Rate limit exceeded (20 requests/min per IP). Please try again shortly.',
      },
    });
  }
  bucket.count += 1;
  next();
}

export function centralErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: {
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      message_bn:
        err?.message_bn ||
        'সার্ভারে একটি অপ্রত্যাশিত সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
      message_en:
        err?.message_en ||
        err?.message ||
        'An unexpected server error occurred. Please try again.',
    },
  });
}
