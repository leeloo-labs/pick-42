'use strict';

// The web shell inflates .gz files with DecompressionStream; the node path
// through the dataset extractor is never taken in the browser.
module.exports = {
  createGunzip: () => {
    throw new Error('zlib is not available in the web shell');
  }
};
