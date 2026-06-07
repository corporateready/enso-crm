import { Injectable, type NestMiddleware } from '@nestjs/common';

import { type NextFunction, type Request, type Response } from 'express';

import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';

// Gates the static /docs site (Fumadocs export served from dist/front/docs).
// Browser navigation to /docs carries no Authorization header, but twenty-front
// persists the access token in a non-httpOnly `tokenPair` cookie (sameSite=lax)
// that rides along on same-origin requests. We verify that token's signature and
// expiry; anything missing/invalid is redirected to the app sign-in.
@Injectable()
export class DocsAuthMiddleware implements NestMiddleware {
  constructor(private readonly jwtWrapperService: JwtWrapperService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Only gate the /docs site; pass everything else straight through.
    if (req.path !== '/docs' && !req.path.startsWith('/docs/')) {
      next();

      return;
    }

    const token = this.extractAccessToken(req.headers.cookie);

    if (token) {
      try {
        await this.jwtWrapperService.verifyJwtToken(token);

        next();

        return;
      } catch {
        // fall through to redirect
      }
    }

    // Not authenticated: send to the SPA sign-in. `next` lets the app return
    // here after login (the SPA may honor it).
    const returnTo = encodeURIComponent(req.originalUrl);

    res.redirect(302, `/?next=${returnTo}`);
  }

  private extractAccessToken(cookieHeader?: string): string | null {
    if (!cookieHeader) {
      return null;
    }

    const tokenPairCookie = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('tokenPair='));

    if (!tokenPairCookie) {
      return null;
    }

    const rawValue = tokenPairCookie.slice('tokenPair='.length);

    try {
      const parsed = JSON.parse(decodeURIComponent(rawValue));

      return parsed?.accessOrWorkspaceAgnosticToken?.token ?? null;
    } catch {
      return null;
    }
  }
}
