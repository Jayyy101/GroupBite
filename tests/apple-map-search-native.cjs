// Compile the production Swift engine with Foundation-only test doubles.
// No MapKit framework is linked or executed, so no native provider request occurs.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const native = fs.readFileSync(path.join(root, 'modules/groupbite-mapkit-search/ios/GroupBiteMapKitSearchModule.swift'), 'utf8');
const marker = 'private final class MapKitSearchSession:';
assert(native.includes(marker));
assert(native.includes('DispatchQueue.main.asyncAfter(deadline: .now() + 8'));
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/apple-mapkit-fakes.swift'), 'utf8');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'groupbite-mapkit-offline-'));
try {
    const source = path.join(directory, 'main.swift'), binary = path.join(directory, 'checks');
    fs.writeFileSync(source, fixture.replace('// ENGINE_INSERTION_POINT', native.slice(native.indexOf(marker))));
    const compiled = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', path.join(directory, 'cache'), source, '-o', binary], { encoding: 'utf8' });
    if (compiled.error) throw compiled.error;
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const checked = spawnSync(binary, [], { encoding: 'utf8' });
    if (checked.error) throw checked.error;
    process.stdout.write(checked.stdout);
    assert.equal(checked.status, 0, checked.stderr);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
