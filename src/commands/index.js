import * as nastaveni from './nastaveni.js';
import * as lfg from './lfg.js';
import * as custom from './custom.js';
import * as turnaj from './turnaj.js';
import * as event from './event.js';
import * as pulse from './pulse.js';
import * as stream from './stream.js';

export const commands = new Map([
  [nastaveni.data.name, nastaveni],
  [lfg.data.name, lfg],
  [custom.data.name, custom],
  [turnaj.data.name, turnaj],
  [event.data.name, event],
  [pulse.data.name, pulse],
  [stream.data.name, stream],
]);
