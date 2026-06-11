import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

type CaptureInput = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
};

// Minimal, dependency-free PostHog capture for enso product analytics. Sends a
// single event to PostHog's ingestion endpoint (`POST <host>/i/v0/e/`). It is
// fire-and-forget by design: failures and a missing API key are swallowed so a
// flaky/disabled analytics pipeline can NEVER block or break a user's action
// (e.g. flipping their lead-routing presence toggle).
@Injectable()
export class EnsoPostHogService {
  private readonly logger = new Logger(EnsoPostHogService.name);

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  // Kicks off the capture without awaiting the network round-trip. Errors are
  // logged at debug and never propagate to the caller.
  capture({ event, distinctId, properties = {} }: CaptureInput): void {
    const apiKey = this.twentyConfigService.get('ENSO_POSTHOG_API_KEY');

    // No key configured (dev/test/local) → analytics disabled, silent no-op.
    if (!isNonEmptyString(apiKey)) {
      return;
    }

    const host = this.twentyConfigService.get('ENSO_POSTHOG_HOST');
    const url = `${host.replace(/\/$/, '')}/i/v0/e/`;

    const body = JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties,
      timestamp: new Date().toISOString(),
    });

    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch((error) => {
      this.logger.debug(`PostHog capture "${event}" failed: ${error}`);
    });
  }
}
