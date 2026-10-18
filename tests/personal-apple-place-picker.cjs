// The restaurant-first picker replaces the creation-only ID picker.
require('./unified-add.cjs').run('search').catch(error => { console.error(error); process.exitCode = 1; });
