import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const seed = JSON.parse(readFileSync(new URL('../seed/seed.json', import.meta.url), 'utf8'));
const home = seed.content.pages.find((page) => page.slug === 'home');
const faq = home?.data.layout.find((block) => block._type === 'faq');

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
  assert.match(home.data.layout[0].heading, /Hemp-Derived THCa/i);
  assert.match(home.data.layout[0].lead, /not at the Cherokee dispensary|Great Smoky Cannabis Company/i);
  assert.equal(home.data.layout[1]._type, 'notice');
  assert.match(home.data.layout[1].body, /separate business/i);
  assert.match(home.data.layout[1].body, /Cherokee/i);
});

test('meta targets intercept + brand-own positioning', () => {
  assert.match(home.data.title, /Not GSCC|GSCC/i);
  assert.match(home.data.title, /THCa/i);
  assert.match(home.data.description, /Great Smoky Cannabis Company/i);
  assert.match(home.data.description, /Cherokee/i);
  assert.match(home.data.description, /hemp-derived THCa/i);
  assert.match(home.data.og_image_alt, /not Great Smoky Cannabis Company/i);
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

test('FAQ covers AEO THCa questions and GSCC disambiguation', () => {
  assert.ok(faq);
  const questions = faq.items.map((item) => item.question.toLowerCase());
  assert.ok(questions.some((q) => q.includes('great smoky cannabis company')));
  assert.ok(questions.some((q) => q.includes('does thca get you high')));
  assert.ok(questions.some((q) => q.includes('is thca legal in north carolina')));
  assert.ok(questions.some((q) => q.includes('cherokee')));
  const answers = JSON.stringify(faq.items);
  assert.match(answers, /hemp-derived THCa/i);
  assert.match(answers, /not medical advice|educational information only/i);
});

test('copy does not claim to be GSCC', () => {
  const json = JSON.stringify(home.data);
  assert.ok(/separate business/i.test(json));
  assert.ok(/we are not GSCC|not the Cherokee dispensary|is not Great Smoky Cannabis Company/i.test(json));
  assert.ok(!/\bwe are the Great Smoky Cannabis Company\b/i.test(json));
});
