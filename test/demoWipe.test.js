const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEMO_WIPE_CATEGORIES,
    OPERATIONAL_CATEGORY_IDS,
    normalizeCategoryIds,
    expandCategoryDependencies,
} = require('../src/utils/demoWipe');

test('normalizeCategoryIds filters unknown and dedupes', () => {
    const ids = normalizeCategoryIds(['reservations', 'bogus', 'reservations', 'slots']);
    assert.deepEqual(ids, ['reservations', 'slots']);
});

test('expandCategoryDependencies adds slot prerequisites', () => {
    const expanded = expandCategoryDependencies(['slots']);
    assert.ok(expanded.includes('slots'));
    assert.ok(expanded.includes('reservations'));
});

test('operational category ids are a subset of catalog', () => {
    const catalogIds = new Set(DEMO_WIPE_CATEGORIES.map((c) => c.id));
    for (const id of OPERATIONAL_CATEGORY_IDS) {
        assert.ok(catalogIds.has(id));
    }
});
