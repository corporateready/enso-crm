import { isNonEmptyString } from '@sniptt/guards';

// The lookup confirms identity without handing over the means to contact
// someone else's lead. A manager who already holds the number recognises it;
// one who does not still cannot dial it.
export const maskPhone = (
  callingCode: string | null | undefined,
  number: string | null | undefined,
): string | null => {
  if (!isNonEmptyString(number)) {
    return null;
  }

  const digits = number.replace(/\D/g, '');
  const prefix = isNonEmptyString(callingCode) ? `${callingCode} ` : '';

  if (digits.length <= 3) {
    return `${prefix}•••`;
  }

  return `${prefix}••• ••${digits.slice(-3)}`;
};

export const maskEmail = (email: string | null | undefined): string | null => {
  if (!isNonEmptyString(email)) {
    return null;
  }

  const atIndex = email.lastIndexOf('@');

  if (atIndex <= 0) {
    return '•••';
  }

  // The domain stays readable: it is rarely identifying on its own and it helps
  // a manager tell a personal address apart from a company one.
  return `${email.slice(0, 1)}•••${email.slice(atIndex)}`;
};
