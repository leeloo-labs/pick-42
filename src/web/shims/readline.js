'use strict';

// Line splitting in the browser happens in src/web/file-lines.js; the node
// path through the dataset extractor is never taken here.
module.exports = {
  createInterface: () => {
    throw new Error('readline is not available in the web shell');
  }
};
