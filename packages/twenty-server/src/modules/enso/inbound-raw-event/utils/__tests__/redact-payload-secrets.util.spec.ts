import {
  REDACTED_PLACEHOLDER,
  TRUNCATED_PLACEHOLDER,
  redactPayloadSecrets,
} from 'src/modules/enso/inbound-raw-event/utils/redact-payload-secrets.util';

describe('redactPayloadSecrets', () => {
  // The payload that actually leaked: the Moldcell PBX authenticates every
  // push with `crm_token` in the body, so writing it verbatim stored the live
  // credential in a CRM record. This case fails without the redaction.
  it('should redact the PBX crm_token while keeping every other value verbatim', () => {
    const received = {
      cmd: 'enso_synthetic_probe',
      note: 'raw intake log verification',
      callid: 'enso-synthetic-20260908T151243Z',
      crm_token: '4e68ffd7fde6bc9cf7824b48bf5491d132b4936828e0045f',
    };

    expect(redactPayloadSecrets(received)).toEqual({
      cmd: 'enso_synthetic_probe',
      note: 'raw intake log verification',
      callid: 'enso-synthetic-20260908T151243Z',
      crm_token: REDACTED_PLACEHOLDER,
    });
  });

  it('should redact credential-shaped keys whatever their casing or separator', () => {
    const received = {
      apiKey: 'a',
      'api-key': 'b',
      API_KEY: 'c',
      Authorization: 'd',
      webhook_secret: 'e',
      password: 'f',
      signature: 'g',
    };

    expect(Object.values(redactPayloadSecrets(received) as object)).toEqual(
      Array(7).fill(REDACTED_PLACEHOLDER),
    );
  });

  // The log's value is that it is faithful, so redaction must not creep.
  it('should leave ordinary call fields untouched, including lookalikes', () => {
    const received = {
      callid: '123',
      // Not credentials: these are call metadata whose names merely contain a
      // fragment of a secret-ish word.
      tokenization: 'keep',
      diversion: '37376011996',
      duration: 42,
      answered: true,
      recording: null,
    };

    expect(redactPayloadSecrets(received)).toEqual(received);
  });

  it('should redact inside nested objects and arrays', () => {
    const received = {
      calls: [{ callid: '1', auth: 'zzz' }],
      meta: { nested: { crm_token: 'zzz', keep: 'yes' } },
    };

    expect(redactPayloadSecrets(received)).toEqual({
      calls: [{ callid: '1', auth: REDACTED_PLACEHOLDER }],
      meta: { nested: { crm_token: REDACTED_PLACEHOLDER, keep: 'yes' } },
    });
  });

  it('should pass through non-object payloads unchanged', () => {
    expect(redactPayloadSecrets('raw-string')).toBe('raw-string');
    expect(redactPayloadSecrets(null)).toBeNull();
    expect(redactPayloadSecrets(undefined)).toBeUndefined();
  });

  // A webhook body is attacker-adjacent: logging must not become a stack
  // overflow on a live-call path.
  it('should not blow the stack on a deeply nested payload', () => {
    let deep: Record<string, unknown> = { crm_token: 'zzz' };

    for (let index = 0; index < 5000; index++) {
      deep = { nested: deep };
    }

    expect(() => redactPayloadSecrets(deep)).not.toThrow();
  });

  // The depth bound must fail SAFE: handing back an unscanned subtree would
  // store a secret nested past the limit.
  it('should truncate rather than pass through an unscanned subtree', () => {
    let deep: Record<string, unknown> = { crm_token: 'leaked' };

    for (let index = 0; index < 40; index++) {
      deep = { nested: deep };
    }

    expect(JSON.stringify(redactPayloadSecrets(deep))).not.toContain('leaked');
    expect(JSON.stringify(redactPayloadSecrets(deep))).toContain(
      TRUNCATED_PLACEHOLDER,
    );
  });
});
