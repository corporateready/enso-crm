import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { timingSafeEqual } from 'node:crypto';

import { isNonEmptyString } from '@sniptt/guards';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import {
  isMarketingEnrollmentStatus,
  type JourneyCallbackInput,
} from 'src/modules/enso/marketing-sync/dtos/journey-callback.input';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';

// Public (no-JWT) receiver for Dittofeed journey callbacks — the only inbound
// machine endpoint in the enso modules, so it does NOT use the JwtAuthGuard the
// other enso controllers do. It is authenticated by a shared secret in the
// `x-enso-marketing-secret` header (constant-time compare against
// DITTOFEED_CALLBACK_SECRET); the workspace is taken from the body since there
// is no auth context. Reachable at POST /rest/enso/marketing/journey-callback.
@Controller('rest/enso/marketing')
export class MarketingController {
  constructor(
    private readonly callbackService: MarketingJourneyCallbackService,
  ) {}

  @Post('journey-callback')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async journeyCallback(
    @Headers('x-enso-marketing-secret') secret: string | undefined,
    @Body() body: JourneyCallbackInput,
  ): Promise<{ ok: true }> {
    this.assertSecret(secret);
    this.assertValidBody(body);

    await this.callbackService.recordEvent(body);

    return { ok: true };
  }

  private assertSecret(secret: string | undefined): void {
    const expected = process.env.DITTOFEED_CALLBACK_SECRET;

    // Refuse rather than silently accept unauthenticated writes when the secret
    // isn't configured.
    if (!isNonEmptyString(expected)) {
      throw new UnauthorizedException(
        'Marketing callback secret is not configured',
      );
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(secret ?? '');

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Invalid marketing callback secret');
    }
  }

  private assertValidBody(body: JourneyCallbackInput): void {
    if (
      !isNonEmptyString(body?.workspaceId) ||
      !isNonEmptyString(body?.userId) ||
      !isNonEmptyString(body?.journey) ||
      !isNonEmptyString(body?.step) ||
      !isMarketingEnrollmentStatus(body?.status)
    ) {
      throw new BadRequestException(
        'workspaceId, userId, journey, step and a valid status are required',
      );
    }
  }
}
