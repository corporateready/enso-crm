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
import { type MetaAudienceInput } from 'src/modules/enso/marketing-sync/dtos/meta-audience.input';
import { type SendSmsInput } from 'src/modules/enso/marketing-sync/dtos/send-sms.input';
import { MarketingConsentRevokeService } from 'src/modules/enso/marketing-sync/services/marketing-consent-revoke.service';
import { MarketingMetaService } from 'src/modules/enso/marketing-sync/services/marketing-meta.service';
import { MetaAudienceClientService } from 'src/modules/enso/marketing-sync/services/meta-audience-client.service';
import { MarketingJourneyCallbackService } from 'src/modules/enso/marketing-sync/services/marketing-journey-callback.service';
import { MarketingSmsService } from 'src/modules/enso/marketing-sync/services/marketing-sms.service';

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
    private readonly smsService: MarketingSmsService,
    private readonly metaService: MarketingMetaService,
    private readonly metaAudienceClientService: MetaAudienceClientService,
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

  // SMS journey step: a Dittofeed Webhook node relays the rendered SMS here, and
  // we send it via sms.md (which isn't a native Dittofeed channel). Same
  // shared-secret auth as the other callbacks.
  @Post('webhooks/enso/send-sms')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async sendSms(
    @Headers('x-enso-marketing-secret') secret: string | undefined,
    @Body() body: SendSmsInput,
  ): Promise<{ ok: true }> {
    this.assertSecret(secret);
    this.assertValidSmsBody(body);

    await this.smsService.send(body);

    return { ok: true };
  }

  // Meta Custom Audience step: a Dittofeed Webhook node (consent-gated via its
  // subscription group) relays the person here; the CRM hashes email/phone and
  // adds them to the audience. Same shared-secret auth.
  @Post('webhooks/enso/meta-audience')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async metaAudience(
    @Headers('x-enso-marketing-secret') secret: string | undefined,
    @Body() body: MetaAudienceInput,
  ): Promise<{ ok: true }> {
    this.assertSecret(secret);
    this.assertValidMetaBody(body);

    await this.metaService.addToAudience(body);

    return { ok: true };
  }

  // One-time setup: create the "customer file" Custom Audience and return its id
  // (to be saved as META_CUSTOM_AUDIENCE_ID). Needs META_ACCESS_TOKEN +
  // META_AD_ACCOUNT_ID in env; shared-secret guarded. Not called by the journey.
  @Post('webhooks/enso/meta-create-audience')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async metaCreateAudience(
    @Headers('x-enso-marketing-secret') secret: string | undefined,
    @Body() body: { workspaceId?: string; name?: string },
  ): Promise<{ ok: true; id: string }> {
    this.assertSecret(secret);

    if (!isNonEmptyString(body?.workspaceId)) {
      throw new BadRequestException('workspaceId is required');
    }

    const id = await this.metaAudienceClientService.createAudience(
      body.workspaceId,
      isNonEmptyString(body?.name) ? body.name : 'ENSO Estate',
    );

    return { ok: true, id };
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

  private assertValidSmsBody(body: SendSmsInput): void {
    if (
      !isNonEmptyString(body?.workspaceId) ||
      !isNonEmptyString(body?.to) ||
      !isNonEmptyString(body?.message)
    ) {
      throw new BadRequestException('workspaceId, to and message are required');
    }
  }

  private assertValidMetaBody(body: MetaAudienceInput): void {
    if (
      !isNonEmptyString(body?.workspaceId) ||
      (!isNonEmptyString(body?.email) && !isNonEmptyString(body?.phone))
    ) {
      throw new BadRequestException(
        'workspaceId and at least one of email/phone are required',
      );
    }
  }
}
