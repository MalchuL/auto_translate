'use strict';

// Never pass clipboard contents or translator URLs to these functions.
function stamp() {
  return new Date().toISOString().slice(11, 23);
}

module.exports = {
  info: (message) => console.log(`[cto ${stamp()}] ${message}`),
  warn: (message) => console.warn(`[cto ${stamp()}] WARN ${message}`),
};
