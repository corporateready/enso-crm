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
import { isDefined } from 'twenty-shared/utils';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import {
  type ConsentUnsubscribeInput,
  isConsentRevokeMethod,
  isConsentUnsubscribeChannel,
} from 'src/modules/enso/marketing-sync/dtos/consent-unsubscribe.input';
import {
  isMarketingEnrollmentStatus,
  type JourneyCallbackInput,
} from 'src/modules/enso/marketing-sync/dtos/journey-callback.input';
import { MarketingConsentRevokeService } from 'src/modules/enso/marketing-sync/services/marketing-consent-revoke.service';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';

// Public (no-JWT) receiver for Dittofeed journey callbacks. It must live OUTSIDE
// the `/rest/*` namespace — that namespace is owned by the authenticated REST
// API catch-all (rest-api-core, JwtAuthGuard), which would intercept the route
// and reject it with "Missing authentication token" regardless of our guards.
// So we follow the public-webhook convention (billing → webhooks/stripe,
// messaging → webhooks/messaging/ses): a root @Controller() + a webhooks/* path,
// public via PublicEndpointGuard, authenticated by a shared secret in the
// `x-enso-marketing-secret` header (constant-time compare against
// DITTOFEED_CALLBACK_SECRET). The workspace is taken from the body since there
// is no auth context. Reachable at POST /webhooks/enso/journey-callback.
@Controller()
export class MarketingController {
  constructor(
    private readonly callbackService: MarketingJourneyCallbackService,
    private readonly consentRevokeService: MarketingConsentRevokeService,
  ) {}

  @Post('webhooks/enso/journey-callback')
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

  // Reverse consent mirror: a Dittofeed unsubscribe (entry into a subscription
  // group's "unsubscribed" segment → Webhook node) revokes the matching CRM
  // consent. Same shared-secret auth as the journey callback.
  @Post('webhooks/enso/consent-unsubscribe')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async consentUnsubscribe(
    @Headers('x-enso-marketing-secret') secret: string | undefined,
    @Body() body: ConsentUnsubscribeInput,
  ): Promise<{ ok: true }> {
    this.assertSecret(secret);
    this.assertValidUnsubscribeBody(body);

    await this.consentRevokeService.revoke(body);

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

  private assertValidUnsubscribeBody(body: ConsentUnsubscribeInput): void {
    if (
      !isNonEmptyString(body?.workspaceId) ||
      !isNonEmptyString(body?.userId) ||
      !isNonEmptyString(body?.projectId) ||
      !isConsentUnsubscribeChannel(body?.channel) ||
      (isDefined(body?.method) && !isConsentRevokeMethod(body.method))
    ) {
      throw new BadRequestException(
        'workspaceId, userId, projectId and a valid channel are required',
      );
    }
  }
}
