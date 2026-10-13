import * as nastaveni from './nastaveni.js';
import * as lfg from './lfg.js';

export const commands = new Map([
  [nastaveni.data.name, nastaveni],
  [lfg.data.name, lfg],
]);
