import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('website recovery commands never inherit destructive cleanup/keychain options', async () => {
  const element = () => ({ dataset: {}, disabled: false, checked: false, textContent: '', events: {}, addEventListener(name, fn) { this.events[name] = fn; }, classList: { toggle() {} }, setAttribute() {} });
  const nodes = Object.fromEntries(['#keychain', '#mode-command', '#copy-mode', '#mode-description', '#status'].map(k => [k, element()]));
  const modes = ['audit', 'reset', 'traces', 'recover-audit', 'recover'].map(mode => ({ ...element(), dataset: { mode } }));
  const document = { querySelector: s => nodes[s], querySelectorAll: s => s === '[data-mode]' ? modes : [] };
  vm.runInNewContext(await fs.readFile(new URL('../site/app.js', import.meta.url), 'utf8'), { document, setTimeout, clearTimeout });
  modes[1].events.click(); nodes['#keychain'].checked = true; nodes['#keychain'].events.change();
  assert.match(nodes['#mode-command'].textContent, /--include-keychain/);
  modes[3].events.click(); assert.equal(nodes['#keychain'].disabled, true); assert.equal(nodes['#keychain'].checked, false);
  assert.equal(nodes['#mode-command'].textContent, 'node bin/recover.mjs');
  modes[4].events.click(); assert.equal(nodes['#mode-command'].textContent, 'node bin/recover.mjs --apply --yes');
  assert.equal(nodes['#copy-mode'].dataset.copy, nodes['#mode-command'].textContent);
  assert.ok(!nodes['#mode-command'].textContent.includes('reset.mjs'));
});
