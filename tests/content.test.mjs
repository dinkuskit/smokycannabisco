import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const seed = JSON.parse(readFileSync(new URL('../seed/seed.json', import.meta.url), 'utf8'));
const home = seed.content.pages.find((page) => page.slug === 'home');

test('seed declares block types and the pages collection', () => {
  const slugs = seed.blockTypes.map((type) => type.slug);
  for (const needed of ['hero', 'notice', 'text_section', 'category_grid', 'cta', 'faq']) {
    assert.ok(slugs.includes(needed), needed);
  }
  const pages = seed.collections.find((collection) => collection.slug === 'pages');
  assert.ok(pages);
  assert.deepEqual(pages.fields.find((field) => field.slug === 'layout')?.validation?.allowedTypes, slugs);
});

test('home page carries chrome fields and a disclaimer-first layout', () => {
  assert.ok(home);
  assert.match(home.data.brand_name, /Smoky Cannabis Company/);
  assert.match(home.data.footer_text, /not Great Smoky Cannabis Company/i);
  assert.equal(home.data.layout[0]._type, 'hero');
  assert.match(home.data.layout[0].heading, /Smoky Cannabis Company/);
  assert.match(home.data.layout[0].lead, /not the Great Smoky Cannabis Company/i);
  assert.equal(home.data.layout[1]._type, 'notice');
});

test('store links use live categories, www host, and UTM pattern', () => {
  const json = JSON.stringify(home.data);
  assert.ok(json.includes('https://www.smokymountaincbd.com/'));
  assert.ok(json.includes('/product-category/edibles/'));
  assert.ok(json.includes('/product-category/thca-flower/'));
  assert.ok(json.includes('/product-category/cannabis-concentrates/'));
  assert.ok(!json.includes('/product-category/concentrates/'));
  assert.ok(json.includes('utm_source=smokycannabisco'));
  assert.ok(json.includes('utm_medium=referral'));
  assert.ok(json.includes('utm_campaign=gscc_intercept'));
});

test('copy does not claim to be GSCC', () => {
  const json = JSON.stringify(home.data);
  assert.ok(/we are not the Great Smoky Cannabis Company/i.test(json) || /We're not the Great Smoky Cannabis Company/i.test(json));
  assert.ok(!/we are the Great Smoky Cannabis Company/i.test(json));
});
