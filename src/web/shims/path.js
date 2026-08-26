'use strict';

// Just enough of node:path for storage keys and display labels in the browser.
const basename = (value) => String(value || '').split('/').pop().split('\\').pop();

module.exports = {
  basename,
  dirname: (value) => {
    const normalized = String(value || '').replaceAll('\\', '/');
    const index = normalized.lastIndexOf('/');
    return index > 0 ? normalized.slice(0, index) : '/';
  },
  join: (...parts) => parts.filter(Boolean).join('/').replaceAll('//', '/'),
  resolve: (...parts) => parts.filter(Boolean).join('/').replaceAll('//', '/')
};
