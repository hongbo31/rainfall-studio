// Development-unit guard. Loaded before any application modules in the child.
const deny = () => { throw Error('OFFLINE_UNIT_NETWORK_FORBIDDEN'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = deny;
  module.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:dgram').createSocket = deny;
const cp = require('node:child_process');
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) cp[method] = deny;
