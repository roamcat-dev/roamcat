/**
 * @file tools/unit/css-color.test.mjs
 * 文件职责：src/content-ui/css-color.mjs 的单元测试——颜色计算值换算成 sRGB 后亮度要对。
 * 主要内容：回归「亮色 oklch 网页被判成深色」：getComputedStyle 对 oklch()/lab()/color() 保持原写法，
 *   按数字硬读会把 oklch(1 0 0) 白底算成亮度 0.2。断言各写法换算后的明暗、透明度与认不出时返回 null。
 * 模块边界：node:test，纯函数，不启动浏览器。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCssColor} from '../../src/content-ui/css-color.mjs';

// 与 content-ui 的明暗判断同一条亮度公式；阈值也照它：<110 深色，>145 亮色。
const lightness = value => { const {r, g, b} = parseCssColor(value); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} 应接近 ${expected}`);

test('rgb()/rgba() 的两种写法照原值读出，透明度单独给出', () => {
  assert.deepEqual(parseCssColor('rgb(250, 250, 250)'), {r: 250, g: 250, b: 250, a: 1});
  assert.deepEqual(parseCssColor('rgba(12, 34, 56, 0.5)'), {r: 12, g: 34, b: 56, a: 0.5});
  assert.deepEqual(parseCssColor('rgb(12 34 56 / 25%)'), {r: 12, g: 34, b: 56, a: 0.25});
  assert.equal(parseCssColor('rgba(0, 0, 0, 0)').a, 0);
});

test('亮色 oklch 背景（shadcn、Tailwind v4 默认调色板）换算后是亮色', () => {
  near(lightness('oklch(1 0 0)'), 255, 1, 'shadcn 白底');
  assert.ok(lightness('oklch(0.985 0.002 247.8)') > 145, 'Tailwind gray-50');
  assert.ok(lightness('oklch(0.967 0.003 264.5)') > 145, 'Tailwind gray-100');
  assert.ok(lightness('oklab(0.97 0 0)') > 145, 'oklab 浅灰');
});

test('深色 oklch 背景换算后是深色', () => {
  assert.ok(lightness('oklch(0.145 0 0)') < 110, 'shadcn 深色底');
  assert.ok(lightness('oklch(0.21 0.034 264.7)') < 110, 'Tailwind gray-900');
  near(lightness('oklch(0 0 0)'), 0, 0.5, '纯黑');
});

test('oklch 的色相与彩度按色彩空间换算，不是把数字当 RGB', () => {
  // Tailwind red-500：oklch(0.637 0.237 25.331) ≈ #fb2c36。
  const red = parseCssColor('oklch(0.637 0.237 25.331)');
  near(red.r, 251, 6, 'red-500 R');
  near(red.g, 44, 12, 'red-500 G');
  near(red.b, 54, 12, 'red-500 B');
});

test('lab()/lch() 与 color() 各色彩空间', () => {
  near(lightness('lab(100 0 0)'), 255, 1.5, 'lab 白');
  assert.ok(lightness('lab(98 0 0)') > 145);
  assert.ok(lightness('lab(10 0 0)') < 110);
  assert.ok(lightness('lch(95 5 120)') > 145);
  // color-mix(in srgb, white 90%, black) 的计算值。
  near(lightness('color(srgb 0.9 0.9 0.9)'), 229.5, 0.01, 'color(srgb)');
  near(lightness('color(display-p3 1 1 1)'), 255, 0.01, 'display-p3 白');
  near(lightness('color(srgb-linear 1 1 1)'), 255, 0.01, 'srgb-linear 白');
  assert.ok(lightness('color(srgb-linear 0.01 0.01 0.01)') < 110);
  near(lightness('color(xyz-d65 0.95047 1 1.08883)'), 255, 1, 'xyz-d65 白点');
  near(lightness('color(xyz-d50 0.96422 1 0.82521)'), 255, 1, 'xyz-d50 白点');
  assert.equal(parseCssColor('color(srgb 0.2 0.2 0.2 / 0.4)').a, 0.4);
});

test('none 分量按 0 算，百分比按各自的满值算', () => {
  near(lightness('oklch(1 none none)'), 255, 1, 'none 彩度与色相');
  near(lightness('oklch(100% 0 0)'), 255, 1, '百分比明度');
  assert.deepEqual(parseCssColor('rgb(100% 0% 0%)'), {r: 255, g: 0, b: 0, a: 1});
});

test('认不出的写法返回 null，不猜', () => {
  for (const value of ['', null, undefined, 'transparent', 'red', '#fafafa', 'oklch(1 0)', 'color(unknown-space 1 1 1)', 'rgb(a, b, c)', 'linear-gradient(red, blue)'])
    assert.equal(parseCssColor(value), null, String(value));
});
