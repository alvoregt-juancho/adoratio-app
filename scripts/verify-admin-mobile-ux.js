#!/usr/bin/env node
/**
 * Verify Cristiano — Admin Mobile UX
 * Uso: node scripts/verify-admin-mobile-ux.js
 */
const fs = require('fs');

let passed = 0;
let failed = 0;

function ok(label) {
    passed += 1;
    console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const html = fs.readFileSync('public/admin.html', 'utf8');
const css = fs.readFileSync('public/admin.css', 'utf8');
const js = fs.readFileSync('public/admin.js', 'utf8');

console.log('\n=== Verify Cristiano — Admin Mobile UX ===\n');

console.log('1. Estructura HTML');
[
    ['adminMenuBtn', 'Botón hamburguesa ☰'],
    ['adminNavDrawer', 'Drawer de navegación'],
    ['adminNavBackdrop', 'Backdrop del drawer'],
    ['adminNavList', 'Lista de secciones del drawer'],
    ['adminNavHelpBtn', 'Botón guía en drawer'],
    ['adminNavLogoutBtn', 'Salir en drawer'],
    ['sectionHelpBtn', 'Botón ayuda ?'],
    ['mobileSectionTitle', 'Título de sección móvil'],
    ['helpSheet', 'Sheet de ayuda contextual'],
    ['helpSheetGotoGuide', 'Ir a guía completa'],
    ['helpSheetToggleHints', 'Toggle guía rápida en help'],
    ['admin-tabs--desktop', 'Tabs desktop marcados'],
].forEach(([needle, label]) => {
    if (html.includes(needle)) ok(label);
    else fail(label, `falta ${needle}`);
});

if (html.includes('admin.css?v=2026072001') && html.includes('admin.js?v=2026072001')) {
    ok('Cache-bust CSS/JS actualizado');
} else {
    fail('Cache-bust', 'versión antigua o distinta');
}

console.log('\n2. CSS mobile-first');
[
    ['admin-nav-drawer', 'Estilos drawer'],
    ['admin-menu-btn', 'Estilos hamburguesa'],
    ['admin-section-title', 'Título sección'],
    ['admin-help-btn', 'Botón ?'],
    ['@media (max-width: 900px)', 'Breakpoint 900px'],
    ['admin-tabs--desktop', 'Ocultar tabs en móvil'],
    ['body.admin.nav-open', 'Lock scroll con nav abierta'],
    ['help-sheet-window', 'Estilos help sheet'],
].forEach(([needle, label]) => {
    if (css.includes(needle)) ok(label);
    else fail(label);
});

const hoverNoneBlocks = [...css.matchAll(/@media\s*\(\s*hover\s*:\s*none\s*\)\s*\{([\s\S]*?)(?=@media|\z)/g)];
const hidesTooltip = hoverNoneBlocks.some((m) =>
    /\.onboard-hint-tooltip\s*\{[^}]*display\s*:\s*none/i.test(m[1])
);
if (!hidesTooltip) ok('Tooltips NO ocultos en touch (hover: none)');
else fail('Tooltips siguen ocultos en touch');

if (/@media\s*\(\s*max-width:\s*900px\s*\)[\s\S]*?\.admin-tabs--desktop\s*\{[^}]*display:\s*none/i.test(css)) {
    ok('Tabs desktop ocultos ≤900px');
} else fail('Tabs desktop no se ocultan en móvil');

if (/@media\s*\(\s*max-width:\s*900px\s*\)[\s\S]*?\.admin-menu-btn\s*\{[^}]*display:\s*inline-flex/i.test(css)) {
    ok('Hamburguesa visible ≤900px');
} else fail('Hamburguesa no visible en móvil');

console.log('\n3. JavaScript');
[
    ['function activateTab', 'activateTab()'],
    ['function setupMobileNav', 'setupMobileNav()'],
    ['function openAdminNav', 'openAdminNav()'],
    ['function closeAdminNav', 'closeAdminNav()'],
    ['function openSectionHelp', 'openSectionHelp()'],
    ['function rebuildAdminNavList', 'rebuildAdminNavList()'],
    ['function isTouchLike', 'isTouchLike()'],
    ['TAB_TITLES', 'Mapa de títulos'],
    ['setupMobileNav()', 'setupMobileNav invocado al boot'],
].forEach(([needle, label]) => {
    if (js.includes(needle)) ok(label);
    else fail(label);
});

if (js.includes('activateTab("cuenta")')) ok('openAccountTab usa activateTab');
else fail('openAccountTab no migrado');

if (js.includes('activateTab(btn.getAttribute')) ok('Guía Mi cuenta navega con activateTab');
else fail('Guía Mi cuenta aún usa tab.click viejo');

if (js.includes('isTouchLike()') && js.includes('mouseover') && /click[\s\S]*isTouchLike/.test(js)) {
    ok('Hints: hover desktop + click/tap touch');
} else fail('Hints no cubren touch');

console.log('\n4. TAB_TITLES');
const titlesMatch = js.match(/const TAB_TITLES = \{([\s\S]*?)\};/);
if (titlesMatch) {
    ['capitan', 'resumen', 'reservas', 'muro', 'turnos', 'whatsapp', 'cuenta'].forEach((k) => {
        if (titlesMatch[1].includes(k + ':')) ok(`TAB_TITLES.${k}`);
        else fail(`TAB_TITLES.${k} ausente`);
    });
} else fail('TAB_TITLES no parseable');

console.log('\n5. Coherencia HTML ↔ JS IDs');
[
    'adminMenuBtn',
    'adminNavDrawer',
    'adminNavClose',
    'adminNavBackdrop',
    'sectionHelpBtn',
    'helpSheet',
    'mobileSectionTitle',
    'adminNavList',
].forEach((id) => {
    const inHtml = new RegExp(`id=["']${id}["']`).test(html);
    const inJs = js.includes(id);
    if (inHtml && inJs) ok(`#${id} en HTML y JS`);
    else fail(`#${id}`, `html=${inHtml} js=${inJs}`);
});

console.log('\n' + '─'.repeat(48));
console.log(`RESULTADO: ${passed} OK, ${failed} fallo(s)`);
console.log(failed ? 'ESTADO: ❌ REQUIERE CORRECCIÓN' : 'ESTADO: ✅ UX MÓVIL ADMIN VERIFICADO');
console.log('');
process.exit(failed ? 1 : 0);
