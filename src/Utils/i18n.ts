export const languages = ['ar', 'en'] as const;
export type Language = (typeof languages)[number];

const english = {
  retrieved: 'Data retrieved successfully',
  bannerCreated: 'Banner created successfully',
  bannerUpdated: 'Banner updated successfully',
  bannerDeleted: 'Banner deleted successfully',
};
type MessageKey = keyof typeof english;
const arabic: Partial<Record<MessageKey, string>> = {
  retrieved: 'تم استرجاع البيانات بنجاح',
  bannerCreated: 'تم إنشاء البانر بنجاح',
  bannerUpdated: 'تم تحديث البانر بنجاح',
  bannerDeleted: 'تم حذف البانر بنجاح',
};

export function translate(language: Language, key: MessageKey): string {
  return (language === 'ar' ? arabic[key] : undefined) ?? english[key];
}

export function resolveLanguage(header?: string): Language {
  const preferences = (header ?? '').split(',').map((part, index) => {
    const [raw = '', ...parameters] = part.trim().toLowerCase().split(';');
    const quality = parameters.find((value) => value.trim().startsWith('q='))?.trim().slice(2);
    const q = quality === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality) ? Number(quality) : 0;
    return { language: raw.trim().split('-')[0], q, index };
  });
  const excluded = new Set(preferences.filter((item) => item.q === 0).map((item) => item.language));
  for (const item of preferences.sort((a, b) => b.q - a.q || a.index - b.index)) {
    if (item.q <= 0) continue;
    if (item.language === 'ar' || item.language === 'en') return item.language;
    if (item.language === '*') {
      const available = (['en', 'ar'] as const).find((language) => !excluded.has(language));
      if (available) return available;
    }
  }
  return 'en';
}
