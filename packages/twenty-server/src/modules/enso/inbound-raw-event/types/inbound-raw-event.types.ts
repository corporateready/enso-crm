export type InboundRawEventChannel =
  | 'PBX'
  | 'ROISTAT'
  | 'CHATWOOT'
  | 'META_LEADGEN'
  | 'FORM'
  | 'OTHER';

// RECEIVED means "written down, outcome still to come" — so a row that sits at
// RECEIVED is an anomaly worth looking at: the handler died, or the stamp did.
// That only reads as an anomaly while every row is genuinely expected to move
// on. NOT_TRACKED is the exception made explicit: a payload logged on a path
// that never stamps an outcome by design. Without it those rows pile up as
// RECEIVED and drown the real failures.
export type InboundRawEventStatus =
  | 'RECEIVED'
  | 'NOT_TRACKED'
  | 'ENQUEUED'
  | 'IGNORED'
  | 'FAILED';
