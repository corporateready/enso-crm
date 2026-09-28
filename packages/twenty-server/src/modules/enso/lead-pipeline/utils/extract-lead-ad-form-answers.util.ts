import { isNonEmptyString } from '@sniptt/guards';

export type LeadAdFormAnswer = {
  label: string;
  value: string;
};

// Shown elsewhere in the message (identity lines) or in the utm_* block, so
// never repeated among the form's own questions.
const IDENTITY_FIELD_NAMES = new Set([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'phone',
]);

// Meta slugifies both question names and multiple-choice answers
// ("ce_suprafețe_vă_interesează,_în_ce_interval?" / "98_m²"). Diacritics are
// stripped only for matching: the legacy n8n matcher looked for "supraf" and
// missed "suprafețe", which is why the area never reached m2Requested.
const matchable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const humanize = (value: string): string => value.replace(/_/g, ' ').trim();

// Keyword-based so it survives wording tweaks between forms; a question we do
// not recognise is still shown, under its own (de-slugified) wording.
const labelFor = (questionName: string): string => {
  const name = matchable(questionName);

  if (name.includes('supraf') || name.includes('area')) {
    return 'Area';
  }

  if (
    name.includes('activ') ||
    (name.includes('tip') && name.includes('unit'))
  ) {
    return 'Unit Type';
  }

  return humanize(questionName);
};

// The answers a lead gave on the Meta form itself, read from the raw lead the
// intake stores verbatim in submittedPayload. These are what the marketing
// rooms used to see from the n8n alert (Unit Type, Area, ...), and nothing
// else in the CRM carries them.
export const extractLeadAdFormAnswers = (
  submittedPayload: unknown,
): LeadAdFormAnswer[] => {
  if (typeof submittedPayload !== 'object' || submittedPayload === null) {
    return [];
  }

  const fieldData = (submittedPayload as { field_data?: unknown }).field_data;

  if (!Array.isArray(fieldData)) {
    return [];
  }

  const answers: LeadAdFormAnswer[] = [];

  for (const field of fieldData) {
    const name = String(field?.name ?? '').trim();
    const lowerName = name.toLowerCase();

    if (
      !isNonEmptyString(name) ||
      IDENTITY_FIELD_NAMES.has(lowerName) ||
      lowerName.startsWith('utm_')
    ) {
      continue;
    }

    const rawValues: unknown[] = Array.isArray(field?.values)
      ? field.values
      : [field?.values];

    const value = rawValues
      .filter((rawValue) => rawValue !== null && rawValue !== undefined)
      .map((rawValue) => humanize(String(rawValue)))
      .filter(isNonEmptyString)
      .join(', ');

    if (isNonEmptyString(value)) {
      answers.push({ label: labelFor(name), value });
    }
  }

  return answers;
};
