import { BadRequestException } from './response/error.response';
export function storeMoney() {
  const currency = process.env.STORE_CURRENCY ?? 'EGP';
  const currencyExponent = Number(process.env.STORE_CURRENCY_EXPONENT ?? '2');
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !Number.isInteger(currencyExponent) ||
    currencyExponent < 0 ||
    currencyExponent > 6
  )
    throw new Error('Invalid store currency configuration');
  return { currency, currencyExponent };
}
export function safeMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new BadRequestException('Invalid or unsafe monetary amount');
  return value;
}
export function toMinor(value: number, exponent = storeMoney().currencyExponent): number {
  if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Invalid catalog price');
  const [coefficient = '', power = '0'] = value.toString().toLowerCase().split('e');
  const [whole = '0', fraction = ''] = coefficient.split('.');
  const shift = exponent + Number(power) - fraction.length;
  let digits = BigInt(whole + fraction);
  if (shift >= 0) digits *= 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n)
      throw new BadRequestException('Catalog price exceeds currency precision');
    digits /= divisor;
  }
  return safeMoney(Number(digits));
}
