// Unified Add replaces the old personal-only create form. Exercise its actual
// route/provider lifecycle, account isolation and navigation guards.
require('./unified-add.cjs').run('draft').catch(error => { console.error(error); process.exitCode = 1; });
