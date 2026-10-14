/**
 * Defaults by country for a new company: reporting currency and time zone (both can be changed later —
 * Currencies & price index, Integrations). Countries not listed: USD and UTC.
 */
const L: Record<string, [string, string]> = {
  US: ['USD', 'America/New_York'], CA: ['CAD', 'America/Toronto'], MX: ['MXN', 'America/Mexico_City'], BR: ['BRL', 'America/Sao_Paulo'], AR: ['ARS', 'America/Argentina/Buenos_Aires'],
  CL: ['CLP', 'America/Santiago'], CO: ['COP', 'America/Bogota'], PE: ['PEN', 'America/Lima'],
  GB: ['GBP', 'Europe/London'], IE: ['EUR', 'Europe/Dublin'], FR: ['EUR', 'Europe/Paris'], DE: ['EUR', 'Europe/Berlin'], NL: ['EUR', 'Europe/Amsterdam'], BE: ['EUR', 'Europe/Brussels'],
  LU: ['EUR', 'Europe/Luxembourg'], ES: ['EUR', 'Europe/Madrid'], PT: ['EUR', 'Europe/Lisbon'], IT: ['EUR', 'Europe/Rome'], AT: ['EUR', 'Europe/Vienna'], FI: ['EUR', 'Europe/Helsinki'],
  GR: ['EUR', 'Europe/Athens'], SK: ['EUR', 'Europe/Bratislava'], SI: ['EUR', 'Europe/Ljubljana'], EE: ['EUR', 'Europe/Tallinn'], LV: ['EUR', 'Europe/Riga'], LT: ['EUR', 'Europe/Vilnius'],
  HR: ['EUR', 'Europe/Zagreb'], MT: ['EUR', 'Europe/Malta'], CY: ['EUR', 'Asia/Nicosia'], CH: ['CHF', 'Europe/Zurich'], NO: ['NOK', 'Europe/Oslo'], SE: ['SEK', 'Europe/Stockholm'],
  DK: ['DKK', 'Europe/Copenhagen'], PL: ['PLN', 'Europe/Warsaw'], CZ: ['CZK', 'Europe/Prague'], HU: ['HUF', 'Europe/Budapest'], RO: ['RON', 'Europe/Bucharest'], BG: ['BGN', 'Europe/Sofia'],
  TR: ['TRY', 'Europe/Istanbul'], IL: ['ILS', 'Asia/Jerusalem'],
  AE: ['AED', 'Asia/Dubai'], SA: ['SAR', 'Asia/Riyadh'], QA: ['QAR', 'Asia/Qatar'], KW: ['KWD', 'Asia/Kuwait'], BH: ['BHD', 'Asia/Bahrain'], OM: ['OMR', 'Asia/Muscat'], JO: ['JOD', 'Asia/Amman'],
  EG: ['EGP', 'Africa/Cairo'], MA: ['MAD', 'Africa/Casablanca'], ZA: ['ZAR', 'Africa/Johannesburg'], NG: ['NGN', 'Africa/Lagos'], KE: ['KES', 'Africa/Nairobi'], GH: ['GHS', 'Africa/Accra'],
  IN: ['INR', 'Asia/Kolkata'], PK: ['PKR', 'Asia/Karachi'], BD: ['BDT', 'Asia/Dhaka'], LK: ['LKR', 'Asia/Colombo'], SG: ['SGD', 'Asia/Singapore'], MY: ['MYR', 'Asia/Kuala_Lumpur'],
  ID: ['IDR', 'Asia/Jakarta'], TH: ['THB', 'Asia/Bangkok'], VN: ['VND', 'Asia/Ho_Chi_Minh'], PH: ['PHP', 'Asia/Manila'], CN: ['CNY', 'Asia/Shanghai'], HK: ['HKD', 'Asia/Hong_Kong'],
  TW: ['TWD', 'Asia/Taipei'], KR: ['KRW', 'Asia/Seoul'], JP: ['JPY', 'Asia/Tokyo'], AU: ['AUD', 'Australia/Sydney'], NZ: ['NZD', 'Pacific/Auckland'],
};
export const localeOf = (country: string) => { const x = L[country.toUpperCase()]; return { currency: x?.[0] ?? 'USD', timezone: x?.[1] ?? 'UTC' }; };
