'use strict';

/*
 * Some hosts run `node index.js` from the container root and ignore the panel's
 * start command. This makes that work: the real entrypoint lives in src/.
 */

require('./src/index.js');
