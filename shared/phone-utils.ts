export function cleanPhoneNumberForStorage(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) {
    return `1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return digits;
  }
  return digits;
}

export function formatPhoneNumberForDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7);
    return `(${area}) ${prefix} ${line}`;
  }
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6);
    return `(${area}) ${prefix} ${line}`;
  }
  return phone;
}

export function getTruePeopleSearchUrl(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const searchNumber = digits.startsWith("1") ? digits.slice(1) : digits;
  return `https://www.truepeoplesearch.com/results?name=${searchNumber}`;
}
