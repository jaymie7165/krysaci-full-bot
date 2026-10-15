// Kategorie ticketů a otázky formuláře. Discord povoluje max. 5 polí a popisek do 45 znaků.
// Popisek pole s odkazem se používá i při schvalování streamera, proto je v konstantě.
export const STREAMER_LINK_LABEL = 'Odkaz na tvůj kanál';

export const CATEGORIES = [
  {
    id: 'general', emoji: '💬', label: 'Obecná pomoc',
    description: 'Dotazy, problémy se serverem, role, bot, technické potíže.',
    badge: 'Pro všechny členy',
    fields: [
      { id: 'subject', label: 'S čím potřebuješ pomoct?', style: 'short', placeholder: 'Stručně, jednou větou' },
      { id: 'detail', label: 'Co se stalo?', style: 'long', placeholder: 'Popiš situaci podrobněji' },
    ],
  },
  {
    id: 'report', emoji: '🛡️', label: 'Nahlásit hráče',
    description: 'Toxicita, obtěžování, porušování pravidel nebo podezřelé chování.',
    badge: 'Soukromé',
    fields: [
      { id: 'who', label: 'Koho nahlašuješ?', style: 'short', placeholder: 'Nick nebo @uživatel' },
      { id: 'what', label: 'Co se stalo?', style: 'long' },
      { id: 'when', label: 'Kdy se to stalo?', style: 'short' },
      { id: 'proof', label: 'Máš důkazy?', style: 'long', required: false, placeholder: 'Odkazy nebo popis. Screenshoty můžeš nahrát přímo do ticketu.' },
    ],
  },
  {
    id: 'appeal', emoji: '⚖️', label: 'Odvolání proti trestu',
    description: 'Odvolání proti timeoutu, kicku, banu nebo jinému postihu.',
    fields: [
      { id: 'penalty', label: 'Jaký trest jsi dostal?', style: 'short', placeholder: 'Např. ban, timeout, kick' },
      { id: 'reason', label: 'Proč žádáš o přezkoumání?', style: 'long' },
    ],
  },
  {
    id: 'recruit', emoji: '🙋', label: 'Nábor do týmu',
    description: 'Žádost o pozici moderátora, event organizátora nebo jinou roli v týmu.',
    fields: [
      { id: 'position', label: 'O jakou pozici žádáš?', style: 'short' },
      { id: 'experience', label: 'Jaké máš zkušenosti?', style: 'long' },
      { id: 'time', label: 'Kolik času můžeš věnovat?', style: 'short', placeholder: 'Např. večery během týdne' },
    ],
  },
  {
    id: 'partner', emoji: '🤝', label: 'Partnerství a spolupráce',
    description: 'Spolupráce s jinými komunitami, společné turnaje a partnerské servery.',
    fields: [
      { id: 'name', label: 'Název komunity', style: 'short' },
      { id: 'members', label: 'Počet členů', style: 'short' },
      { id: 'proposal', label: 'Návrh spolupráce', style: 'long' },
      { id: 'contact', label: 'Kontaktní osoba', style: 'short' },
    ],
  },
  {
    id: 'suggestion', emoji: '💡', label: 'Návrh nebo nápad',
    description: 'Nové funkce, hry, eventy nebo zlepšení serveru.',
    fields: [
      { id: 'idea', label: 'Co navrhuješ?', style: 'long' },
      { id: 'benefit', label: 'Jak by to komunitě pomohlo?', style: 'long' },
    ],
  },
  {
    id: 'streamer', emoji: '🎥', label: 'Role streamera',
    description: 'Žádost o roli streamera. Bot pak bude oznamovat tvoje streamy.',
    fields: [
      { id: 'platform', label: 'Platforma', style: 'short', placeholder: 'Twitch nebo Kick' },
      { id: 'link', label: STREAMER_LINK_LABEL, style: 'short', placeholder: 'Např. https://twitch.tv/tvojekanal' },
      { id: 'content', label: 'Co streamuješ?', style: 'long', placeholder: 'Hry nebo obsah, který se na kanálu objevuje' },
      { id: 'schedule', label: 'Jak často streamuješ?', style: 'short', required: false, placeholder: 'Např. 3× týdně večer' },
    ],
  },
  {
    id: 'leadership', emoji: '🔒', label: 'Kontaktovat vedení',
    description: 'Citlivé záležitosti, stížnosti na moderátory nebo problém, který nechceš řešit s běžnou podporou.',
    badge: 'Omezený přístup',
    fields: [
      { id: 'topic', label: 'Čeho se záležitost týká?', style: 'short' },
      { id: 'detail', label: 'Popis situace', style: 'long' },
    ],
  },
];

export const getCategory = (id) => CATEGORIES.find((c) => c.id === id);
