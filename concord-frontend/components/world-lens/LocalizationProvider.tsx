'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type LanguageCode = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'ko' | 'zh' | 'pt' | 'ru' | 'ar' | 'hi';

interface LocalizationContextValue {
  locale: LanguageCode;
  setLocale: (l: LanguageCode) => void;
  t: (key: string) => string;
  formatNumber: (n: number) => string;
  formatDate: (d: Date | string) => string;
  isRTL: boolean;
  measurementUnit: 'metric' | 'imperial';
  setMeasurementUnit: (u: 'metric' | 'imperial') => void;
}

const SUPPORTED_LANGUAGES: { code: LanguageCode; name: string; nativeName: string; rtl?: boolean }[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
];

const TRANSLATIONS: Record<string, Record<LanguageCode, string>> = {
  'nav.home': { en: 'Home', es: 'Inicio', fr: 'Accueil', de: 'Startseite', ja: 'ホーム', ko: '홈', zh: '首页', pt: 'Início', ru: 'Главная', ar: 'الرئيسية', hi: 'होम' },
  'nav.build': { en: 'Build', es: 'Construir', fr: 'Construire', de: 'Bauen', ja: '建設', ko: '건설', zh: '建造', pt: 'Construir', ru: 'Строить', ar: 'بناء', hi: 'निर्माण' },
  'nav.explore': { en: 'Explore', es: 'Explorar', fr: 'Explorer', de: 'Erkunden', ja: '探索', ko: '탐험', zh: '探索', pt: 'Explorar', ru: 'Исследовать', ar: 'استكشف', hi: 'अन्वेषण' },
  'nav.marketplace': { en: 'Marketplace', es: 'Mercado', fr: 'Marché', de: 'Marktplatz', ja: 'マーケット', ko: '마켓플레이스', zh: '市场', pt: 'Mercado', ru: 'Маркетплейс', ar: 'السوق', hi: 'बाज़ार' },
  'nav.inventory': { en: 'Inventory', es: 'Inventario', fr: 'Inventaire', de: 'Inventar', ja: 'インベントリ', ko: '인벤토리', zh: '库存', pt: 'Inventário', ru: 'Инвентарь', ar: 'المخزون', hi: 'सूची' },
  'nav.quests': { en: 'Quests', es: 'Misiones', fr: 'Quêtes', de: 'Aufgaben', ja: 'クエスト', ko: '퀘스트', zh: '任务', pt: 'Missões', ru: 'Задания', ar: 'المهام', hi: 'क्वेस्ट' },
  'nav.settings': { en: 'Settings', es: 'Configuración', fr: 'Paramètres', de: 'Einstellungen', ja: '設定', ko: '설정', zh: '设置', pt: 'Configurações', ru: 'Настройки', ar: 'الإعدادات', hi: 'सेटिंग्स' },
  'action.place': { en: 'Place', es: 'Colocar', fr: 'Placer', de: 'Platzieren', ja: '配置', ko: '배치', zh: '放置', pt: 'Colocar', ru: 'Разместить', ar: 'وضع', hi: 'रखें' },
  'action.validate': { en: 'Validate', es: 'Validar', fr: 'Valider', de: 'Validieren', ja: '検証', ko: '검증', zh: '验证', pt: 'Validar', ru: 'Проверить', ar: 'تحقق', hi: 'मान्य करें' },
  'action.publish': { en: 'Publish', es: 'Publicar', fr: 'Publier', de: 'Veröffentlichen', ja: '公開', ko: '게시', zh: '发布', pt: 'Publicar', ru: 'Опубликовать', ar: 'نشر', hi: 'प्रकाशित करें' },
  'action.save': { en: 'Save', es: 'Guardar', fr: 'Enregistrer', de: 'Speichern', ja: '保存', ko: '저장', zh: '保存', pt: 'Salvar', ru: 'Сохранить', ar: 'حفظ', hi: 'सहेजें' },
  'action.cancel': { en: 'Cancel', es: 'Cancelar', fr: 'Annuler', de: 'Abbrechen', ja: 'キャンセル', ko: '취소', zh: '取消', pt: 'Cancelar', ru: 'Отмена', ar: 'إلغاء', hi: 'रद्द करें' },
  'action.search': { en: 'Search', es: 'Buscar', fr: 'Rechercher', de: 'Suchen', ja: '検索', ko: '검색', zh: '搜索', pt: 'Pesquisar', ru: 'Поиск', ar: 'بحث', hi: 'खोजें' },
  'action.craft': { en: 'Craft', es: 'Fabricar', fr: 'Fabriquer', de: 'Herstellen', ja: 'クラフト', ko: '제작', zh: '制作', pt: 'Fabricar', ru: 'Создать', ar: 'صناعة', hi: 'शिल्प' },
  'status.validated': { en: 'Validated', es: 'Validado', fr: 'Validé', de: 'Validiert', ja: '検証済み', ko: '검증됨', zh: '已验证', pt: 'Validado', ru: 'Проверено', ar: 'تم التحقق', hi: 'मान्य' },
  'status.experimental': { en: 'Experimental', es: 'Experimental', fr: 'Expérimental', de: 'Experimentell', ja: '実験的', ko: '실험적', zh: '实验性', pt: 'Experimental', ru: 'Экспериментальный', ar: 'تجريبي', hi: 'प्रयोगात्मक' },
  'status.online': { en: 'Online', es: 'En línea', fr: 'En ligne', de: 'Online', ja: 'オンライン', ko: '온라인', zh: '在线', pt: 'Online', ru: 'Онлайн', ar: 'متصل', hi: 'ऑनलाइन' },
  'status.offline': { en: 'Offline', es: 'Desconectado', fr: 'Hors ligne', de: 'Offline', ja: 'オフライン', ko: '오프라인', zh: '离线', pt: 'Offline', ru: 'Оффлайн', ar: 'غير متصل', hi: 'ऑफलाइन' },
  'validation.pass': { en: 'Validation Passed', es: 'Validación aprobada', fr: 'Validation réussie', de: 'Validierung bestanden', ja: '検証合格', ko: '검증 통과', zh: '验证通过', pt: 'Validação aprovada', ru: 'Проверка пройдена', ar: 'نجح التحقق', hi: 'मान्यता पास' },
  'validation.fail': { en: 'Validation Failed', es: 'Validación fallida', fr: 'Validation échouée', de: 'Validierung fehlgeschlagen', ja: '検証不合格', ko: '검증 실패', zh: '验证失败', pt: 'Validação falhou', ru: 'Проверка не пройдена', ar: 'فشل التحقق', hi: 'मान्यता विफल' },
  'district.docks': { en: 'The Docks', es: 'Los Muelles', fr: 'Les Quais', de: 'Die Docks', ja: 'ドック', ko: '부두', zh: '码头', pt: 'As Docas', ru: 'Доки', ar: 'الأرصفة', hi: 'डॉक्स' },
  'district.exchange': { en: 'The Exchange', es: 'El Mercado', fr: "L'Échange", de: 'Die Börse', ja: '取引所', ko: '거래소', zh: '交易所', pt: 'A Bolsa', ru: 'Биржа', ar: 'البورصة', hi: 'एक्सचेंज' },
  'district.forge': { en: 'The Forge', es: 'La Forja', fr: 'La Forge', de: 'Die Schmiede', ja: '鍛冶場', ko: '대장간', zh: '锻造厂', pt: 'A Forja', ru: 'Кузница', ar: 'المسبك', hi: 'फोर्ज' },
  'district.academy': { en: 'The Academy', es: 'La Academia', fr: "L'Académie", de: 'Die Akademie', ja: 'アカデミー', ko: '아카데미', zh: '学院', pt: 'A Academia', ru: 'Академия', ar: 'الأكاديمية', hi: 'अकादमी' },
  'district.commons': { en: 'The Commons', es: 'Los Comunes', fr: 'Les Communs', de: 'Der Gemeinplatz', ja: 'コモンズ', ko: '커먼즈', zh: '公地', pt: 'Os Comuns', ru: 'Площадь', ar: 'المشاعات', hi: 'कॉमन्स' },
  'currency.concordCoin': { en: 'Concord Coin', es: 'Moneda Concord', fr: 'Pièce Concord', de: 'Concord-Münze', ja: 'コンコードコイン', ko: '콩코드 코인', zh: '协和币', pt: 'Moeda Concord', ru: 'Конкорд Коин', ar: 'عملة كونكورد', hi: 'कॉनकॉर्ड कॉइन' },
  'label.citations': { en: 'Citations', es: 'Citaciones', fr: 'Citations', de: 'Zitierungen', ja: '引用', ko: '인용', zh: '引用', pt: 'Citações', ru: 'Цитирования', ar: 'الاستشهادات', hi: 'उद्धरण' },
  'label.royalties': { en: 'Royalties', es: 'Regalías', fr: 'Redevances', de: 'Tantiemen', ja: 'ロイヤリティ', ko: '로열티', zh: '版税', pt: 'Royalties', ru: 'Роялти', ar: 'حقوق الملكية', hi: 'रॉयल्टी' },
  'label.reputation': { en: 'Reputation', es: 'Reputación', fr: 'Réputation', de: 'Reputation', ja: '評判', ko: '평판', zh: '声望', pt: 'Reputação', ru: 'Репутация', ar: 'السمعة', hi: 'प्रतिष्ठा' },
  'label.population': { en: 'Population', es: 'Población', fr: 'Population', de: 'Bevölkerung', ja: '人口', ko: '인구', zh: '人口', pt: 'População', ru: 'Население', ar: 'السكان', hi: 'जनसंख्या' },
  'label.buildings': { en: 'Buildings', es: 'Edificios', fr: 'Bâtiments', de: 'Gebäude', ja: '建物', ko: '건물', zh: '建筑', pt: 'Edifícios', ru: 'Здания', ar: 'المباني', hi: 'भवन' },
  'label.materials': { en: 'Materials', es: 'Materiales', fr: 'Matériaux', de: 'Materialien', ja: '材料', ko: '재료', zh: '材料', pt: 'Materiais', ru: 'Материалы', ar: 'المواد', hi: 'सामग्री' },
  'npc.dialogue_note': { en: 'NPC dialogue is generated in your language automatically via LLM', es: 'Los diálogos NPC se generan automáticamente en tu idioma', fr: 'Les dialogues PNJ sont générés automatiquement dans votre langue', de: 'NPC-Dialoge werden automatisch in Ihrer Sprache generiert', ja: 'NPCの対話はLLMにより自動的にあなたの言語で生成されます', ko: 'NPC 대화는 LLM을 통해 자동으로 사용자 언어로 생성됩니다', zh: 'NPC对话通过LLM自动以您的语言生成', pt: 'Os diálogos NPC são gerados automaticamente no seu idioma', ru: 'Диалоги NPC автоматически генерируются на вашем языке', ar: 'يتم إنشاء حوارات NPC تلقائيًا بلغتك', hi: 'NPC संवाद LLM के माध्यम से स्वचालित रूप से आपकी भाषा में उत्पन्न होते हैं' },
  'empty.inventory': { en: 'Your inventory is empty. Visit The Exchange to get started.', es: 'Tu inventario está vacío. Visita El Mercado para empezar.', fr: 'Votre inventaire est vide. Visitez l\'Échange pour commencer.', de: 'Ihr Inventar ist leer. Besuchen Sie die Börse, um loszulegen.', ja: 'インベントリは空です。取引所を訪れて始めましょう。', ko: '인벤토리가 비어있습니다. 거래소를 방문하여 시작하세요.', zh: '您的库存为空。请访问交易所开始。', pt: 'Seu inventário está vazio. Visite a Bolsa para começar.', ru: 'Ваш инвентарь пуст. Посетите Биржу, чтобы начать.', ar: 'مخزونك فارغ. قم بزيارة البورصة للبدء.', hi: 'आपकी सूची खाली है। शुरू करने के लिए एक्सचेंज पर जाएं।' },
  'tier.novice': { en: 'Novice', es: 'Novato', fr: 'Novice', de: 'Neuling', ja: '初心者', ko: '초보', zh: '新手', pt: 'Novato', ru: 'Новичок', ar: 'مبتدئ', hi: 'नौसिखिया' },
  'tier.apprentice': { en: 'Apprentice', es: 'Aprendiz', fr: 'Apprenti', de: 'Lehrling', ja: '見習い', ko: '견습생', zh: '学徒', pt: 'Aprendiz', ru: 'Ученик', ar: 'متدرب', hi: 'शिक्षु' },
  'tier.journeyman': { en: 'Journeyman', es: 'Oficial', fr: 'Compagnon', de: 'Geselle', ja: '職人', ko: '숙련공', zh: '熟练工', pt: 'Oficial', ru: 'Подмастерье', ar: 'صانع', hi: 'कुशल कारीगर' },
  'tier.expert': { en: 'Expert', es: 'Experto', fr: 'Expert', de: 'Experte', ja: 'エキスパート', ko: '전문가', zh: '专家', pt: 'Especialista', ru: 'Эксперт', ar: 'خبير', hi: 'विशेषज्ञ' },
  'tier.master': { en: 'Master', es: 'Maestro', fr: 'Maître', de: 'Meister', ja: 'マスター', ko: '마스터', zh: '大师', pt: 'Mestre', ru: 'Мастер', ar: 'ماستر', hi: 'मास्टर' },
  'tier.grandmaster': { en: 'Grandmaster', es: 'Gran Maestro', fr: 'Grand Maître', de: 'Großmeister', ja: 'グランドマスター', ko: '그랜드마스터', zh: '宗师', pt: 'Grão-Mestre', ru: 'Гроссмейстер', ar: 'غراند ماستر', hi: 'ग्रैंडमास्टर' },
  'weather.clear': { en: 'Clear', es: 'Despejado', fr: 'Dégagé', de: 'Klar', ja: '晴れ', ko: '맑음', zh: '晴', pt: 'Limpo', ru: 'Ясно', ar: 'صافي', hi: 'साफ' },
  'weather.rain': { en: 'Rain', es: 'Lluvia', fr: 'Pluie', de: 'Regen', ja: '雨', ko: '비', zh: '雨', pt: 'Chuva', ru: 'Дождь', ar: 'مطر', hi: 'बारिश' },
  'weather.snow': { en: 'Snow', es: 'Nieve', fr: 'Neige', de: 'Schnee', ja: '雪', ko: '눈', zh: '雪', pt: 'Neve', ru: 'Снег', ar: 'ثلج', hi: 'बर्फ' },
};

// ── Context ────────────────────────────────────────────────────────

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export function useLocalization(): LocalizationContextValue {
  const ctx = useContext(LocalizationContext);
  if (!ctx) throw new Error('useLocalization must be used within LocalizationProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────

interface LocalizationProviderProps {
  children: React.ReactNode;
  defaultLocale?: LanguageCode;
}

export default function LocalizationProvider({ children, defaultLocale = 'en' }: LocalizationProviderProps) {
  const [locale, setLocale] = useState<LanguageCode>(defaultLocale);
  const [measurementUnit, setMeasurementUnit] = useState<'metric' | 'imperial'>('metric');

  const isRTL = useMemo(() => {
    return SUPPORTED_LANGUAGES.find(l => l.code === locale)?.rtl ?? false;
  }, [locale]);

  const t = useCallback((key: string): string => {
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    return entry[locale] || entry['en'] || key;
  }, [locale]);

  const formatNumber = useCallback((n: number): string => {
    try {
      return new Intl.NumberFormat(locale).format(n);
    } catch {
      return n.toString();
    }
  }, [locale]);

  const formatDate = useCallback((d: Date | string): string => {
    try {
      const date = typeof d === 'string' ? new Date(d) : d;
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
    } catch {
      return String(d);
    }
  }, [locale]);

  const value = useMemo<LocalizationContextValue>(() => ({
    locale, setLocale, t, formatNumber, formatDate, isRTL, measurementUnit, setMeasurementUnit,
  }), [locale, t, formatNumber, formatDate, isRTL, measurementUnit]);

  return (
    <LocalizationContext.Provider value={value}>
      <div dir={isRTL ? 'rtl' : 'ltr'}>{children}</div>
    </LocalizationContext.Provider>
  );
}

export { SUPPORTED_LANGUAGES, TRANSLATIONS };
