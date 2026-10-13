import * as nastaveni from './nastaveni.js';
import * as lfg from './lfg.js';
import * as custom from './custom.js';

export const commands = new Map([
  [nastaveni.data.name, nastaveni],
  [lfg.data.name, lfg],
  [custom.data.name, custom],
]);
