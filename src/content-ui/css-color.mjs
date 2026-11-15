/**
 * @file src/content-ui/css-color.mjs
 * 文件职责：把浏览器给出的颜色计算值换算成 sRGB（0–255），供网页明暗判断取亮度。
 * 主要内容：parseCssColor——rgb()/rgba() 之外，oklch()/oklab()/lab()/lch()/color() 的计算值保持原写法
 *   （Tailwind v4、shadcn 的默认调色板都是 oklch），直接按数字读会把白底算成近黑；这里按各自的色彩空间换算。
 *   认不出的写法返回 null（当作「判断不出」），不猜。
 * 模块边界：纯函数，不碰 DOM；随 content-ui 打包进网页侧脚本，单测直接 import。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const clamp = (value, max = 1) => Math.min(max, Math.max(0, value));
// 分量可以是数字、百分比或 none（缺省分量按 0 算）；scale 是 100% 对应的数值。
const component = (token, scale) => token === 'none' ? 0 : token.endsWith('%') ? parseFloat(token) / 100 * scale : parseFloat(token);
// 线性光 → sRGB 编码后的 0–255；色域外的值收进色域（只用来估亮度，不求精确映射）。
const encode = linear => {
  const value = clamp(linear);
  return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
};
const fromLinear = (r, g, b) => [encode(r), encode(g), encode(b)];
const polar = (chroma, hue) => [chroma * Math.cos(hue * Math.PI / 180), chroma * Math.sin(hue * Math.PI / 180)];

function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return fromLinear(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
}

const fromXyzD65 = (x, y, z) => fromLinear(
  3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
  -0.969266 * x + 1.8760108 * y + 0.041556 * z,
  0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
);
const fromXyzD50 = (x, y, z) => fromLinear(
  3.1338561 * x - 1.6168667 * y - 0.4906146 * z,
  -0.9787684 * x + 1.9161415 * y + 0.033454 * z,
  0.0719453 * x - 0.2289914 * y + 1.4052427 * z,
);

function fromLab(L, a, b) {
  const expand = t => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const fy = (L + 16) / 116;
  return fromXyzD50(0.96422 * expand(fy + a / 500), expand(fy), 0.82521 * expand(fy - b / 200));
}

/**
 * 解析 getComputedStyle 给出的颜色。返回 {r, g, b, a}（r/g/b 为 sRGB 0–255，a 为 0–1），认不出时返回 null。
 */
export function parseCssColor(value) {
  const match = /^\s*([a-z-]+)\(([^()]*)\)\s*$/iu.exec(String(value ?? ''));
  if (!match) return null;
  const fn = match[1].toLowerCase();
  const [body, slashAlpha, extra] = match[2].split('/');
  if (extra !== undefined) return null;
  const parts = body.trim().split(/[\s,]+/u).filter(Boolean);
  const space = fn === 'color' ? (parts.shift() || '').toLowerCase() : '';
  // 旧写法 rgba(r, g, b, a) 的透明度在第四个分量上。
  let alphaToken = slashAlpha?.trim();
  if (alphaToken === undefined && (fn === 'rgb' || fn === 'rgba') && parts.length === 4) alphaToken = parts.pop();
  if (parts.length !== 3) return null;
  const read = scales => parts.map((token, index) => component(token, scales[index]));
  let rgb;
  if (fn === 'rgb' || fn === 'rgba') rgb = read([255, 255, 255]).map(channel => clamp(channel, 255));
  else if (fn === 'oklab') rgb = fromOklab(...read([1, 0.4, 0.4]));
  else if (fn === 'oklch') { const [L, C, H] = read([1, 0.4, 360]); rgb = fromOklab(L, ...polar(C, H)); }
  else if (fn === 'lab') rgb = fromLab(...read([100, 125, 125]));
  else if (fn === 'lch') { const [L, C, H] = read([100, 150, 360]); rgb = fromLab(L, ...polar(C, H)); }
  else if (fn === 'color') {
    const channels = read([1, 1, 1]);
    if (space === 'srgb-linear') rgb = fromLinear(...channels);
    else if (space === 'xyz' || space === 'xyz-d65') rgb = fromXyzD65(...channels);
    else if (space === 'xyz-d50') rgb = fromXyzD50(...channels);
    // 广色域 RGB（display-p3 等）与 sRGB 的明暗接近，分量直接当 sRGB 用。
    else if (['srgb', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020'].includes(space)) rgb = channels.map(channel => 255 * clamp(channel));
  }
  const a = alphaToken === undefined ? 1 : clamp(component(alphaToken, 1));
  if (!rgb || [...rgb, a].some(channel => !Number.isFinite(channel))) return null;
  return {r: rgb[0], g: rgb[1], b: rgb[2], a};
}
