import { ButtonStyle } from 'discord.js';
import { addFooter, addHeader, addRow, asMessage, button, divider, newPanel } from '../../ui.js';

export function buildRolesPanel({ iconUrl } = {}) {
  const container = newPanel();
  addHeader(
    container,
    '## 🧩 Vyber si role\nŘekni nám, co hraješ a jak na tom jsi, ať tě ostatní snadno najdou. Role si můžeš kdykoli změnit.',
    iconUrl,
  );
  container.addSeparatorComponents(divider());
  addRow(container, { emoji: '🎮', label: 'Hry', description: 'Vyber hry, které hraješ.', button: button('roles:games', 'Vybrat', ButtonStyle.Primary) });
  addRow(container, { emoji: '🎂', label: 'Věk', description: 'Tvoje věková kategorie.', button: button('roles:age', 'Vybrat') });
  addRow(container, { emoji: '🏅', label: 'Ranky', description: 'Rank v LoL, Valorantu a CS2.', button: button('roles:ranks', 'Vybrat') });
  addRow(container, { emoji: '✨', label: 'Jiná hra', description: 'Hraješ nebo děláš něco, co v seznamu není? Napiš to sem.', button: button('roles:other', 'Napsat') });
  addFooter(container, 'Rank si můžeš zvolit, až když máš vybranou hru, ke které patří.');
  return asMessage(container);
}
