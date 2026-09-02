import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { timingSafeEqual } from 'node:crypto';

import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { IngestCallEventJob } from 'src/modules/enso/telephony/jobs/ingest-call-event.job';
import {
  type IngestCallEventJobData,
  serializeCallEvent,
} from 'src/modules/enso/telephony/jobs/telephony-job.types';
import {
  MOLDCELL_CRM_TOKEN,
  ROISTAT_WEBHOOK_SECRET,
  TELEPHONY_WORKSPACE_ID,
} from 'src/modules/enso/telephony/telephony.constants';
import {
  type MoldcellContactPush,
  type MoldcellContactResponse,
  type MoldcellEventPush,
  type MoldcellHistoryPush,
  type MoldcellPush,
  type NormalizedCallEvent,
  type RoistatCallWebhook,
} from 'src/modules/enso/telephony/types/telephony.types';
import {
  normalizeMoldcellContact,
  normalizeMoldcellEvent,
  normalizeMoldcellHistory,
  normalizeRoistatCall,
} from 'src/modules/enso/telephony/utils/normalize-call-event.util';

// Public (no-JWT) telephony receivers. Same convention as the marketing
// callback: a root @Controller() with a webhooks/* path, because /rest/* is
// owned by the authenticated REST catch-all and would reject these regardless of
// guards. Form-encoded bodies (which the PBX sends) are already handled by the
// global urlencoded body parser in main.ts.
//
//   POST /webhooks/enso/telephony/moldcell          — one url for all three cmds
//   POST /webhooks/enso/telephony/roistat/:secret   — Roistat has no signing
//
// Moldcell authenticates with `crm_token` in the body; Roistat cannot sign at
// all, so its secret rides in the path.
@Controller()
export class TelephonyController {
  private readonly logger = new Logger(TelephonyController.name);

  constructor(
    @InjectMessageQueue(MessageQueue.ensoTelephonyQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {}

  // The PBX posts `event`, `history` and `contact` to this single address and
  // distinguishes them by `cmd`. Everything returns 200 quickly; the ingest work
  // happens on the queue.
  @Post('webhooks/enso/telephony/moldcell')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async moldcell(
    @Body() body: MoldcellPush,
  ): Promise<MoldcellContactResponse | { ok: true }> {
    this.assertMoldcellToken(body?.crm_token);

    const cmd = String(body?.cmd ?? '').toLowerCase();

    if (cmd === 'contact') {
      // Fires while the phone is ringing. Record it — it is the earliest signal
      // for a call, and its real payload shape is undocumented — but never let
      // that affect the response: a slow or failed answer here delays a live
      // call. So recording is best-effort and the reply is always the same.
      try {
        await this.enqueue(
          normalizeMoldcellContact(body as MoldcellContactPush),
        );
      } catch (error) {
        this.logger.warn(
          `Could not record contact push: ${(error as Error).message}`,
        );
      }

      // Returning no `responsible` is the deliberate fallback: the PBX then
      // applies its own dial plan, so a call is never delayed or dropped by us.
      // Route-to-owner lands with Module A.
      return {};
    }

    if (cmd === 'event') {
      const event = normalizeMoldcellEvent(body as MoldcellEventPush);

      await this.enqueue(event);

      return { ok: true };
    }

    if (cmd === 'history') {
      const event = normalizeMoldcellHistory(body as MoldcellHistoryPush);

      await this.enqueue(event);

      return { ok: true };
    }

    // Unknown cmd: ack rather than error, so an unrecognised push never makes
    // the PBX retry against us in a loop.
    return { ok: true };
  }

  // Roistat posts here from both scenario slots — `webhook_start` (at-call) and
  // `webhook` (after-call). Both carry attribution; only the second carries the
  // outcome. The same handler serves both; the payload shape tells them apart.
  @Post('webhooks/enso/telephony/roistat/:secret')
  @HttpCode(200)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async roistat(
    @Param('secret') secret: string,
    @Body() body: RoistatCallWebhook,
  ): Promise<{ ok: true }> {
    this.assertRoistatSecret(secret);

    const event = normalizeRoistatCall(body ?? {});

    await this.enqueue(event);

    return { ok: true };
  }

  private async enqueue(event: NormalizedCallEvent | undefined): Promise<void> {
    if (!isDefined(event)) {
      return;
    }

    if (!isNonEmptyString(TELEPHONY_WORKSPACE_ID)) {
      throw new UnauthorizedException(
        'Telephony workspace is not configured (ENSO_TELEPHONY_WORKSPACE_ID)',
      );
    }

    await this.messageQueueService.add<IngestCallEventJobData>(
      IngestCallEventJob.name,
      {
        workspaceId: TELEPHONY_WORKSPACE_ID,
        event: serializeCallEvent(event),
      },
      // One job per (call, specific push) so a redelivered push collapses
      // instead of racing itself through the correlation lookup. Keyed on
      // eventKey rather than the call id alone: an `event COMPLETED` and a
      // `history` push share the same `callid`, and collapsing those two would
      // silently discard the history record that carries duration and recording.
      { id: `enso-telephony-ingest:${event.externalId}:${event.eventKey}` },
    );
  }

  private assertMoldcellToken(token: string | undefined): void {
    this.assertSharedSecret(
      token,
      MOLDCELL_CRM_TOKEN,
      'Moldcell CRM token is not configured',
      'Invalid Moldcell CRM token',
    );
  }

  private assertRoistatSecret(secret: string | undefined): void {
    this.assertSharedSecret(
      secret,
      ROISTAT_WEBHOOK_SECRET,
      'Roistat webhook secret is not configured',
      'Invalid Roistat webhook secret',
    );
  }

  private assertSharedSecret(
    provided: string | undefined,
    expected: string | undefined,
    missingMessage: string,
    invalidMessage: string,
  ): void {
    // Refuse rather than silently accept unauthenticated writes when the secret
    // isn't configured.
    if (!isNonEmptyString(expected)) {
      throw new UnauthorizedException(missingMessage);
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided ?? '');

    // timingSafeEqual throws on length mismatch, so compare lengths first.
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException(invalidMessage);
    }
  }
}
