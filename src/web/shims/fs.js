'use strict';

// The browser bundle never touches the filesystem; every store receives a
// browser io adapter instead. Loading is allowed, calling is a bug.
const unavailable = (name) => () => {
  throw new Error(`fs.${name} is not available in the web shell`);
};

module.exports = {
  readFileSync: unavailable('readFileSync'),
  writeFileSync: unavailable('writeFileSync'),
  mkdirSync: unavailable('mkdirSync'),
  renameSync: unavailable('renameSync'),
  existsSync: () => false,
  promises: {
    stat: unavailable('promises.stat'),
    open: unavailable('promises.open')
  }
};
