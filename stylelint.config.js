// Every raw design value lives in src/app/ui/foundation/tokens.css. Elsewhere, these properties must use its
// custom properties, so a style change is made once (src/app/ui/README.md).
const TOKEN_PROPERTIES = [
  '/color$/',
  'fill',
  'stroke',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  '/radius$/',
  'box-shadow',
  'gap',
  'row-gap',
  'column-gap',
  '/^padding/',
  '/^margin/',
  '/^border(-(top|right|bottom|left))?-width$/',
  'outline-width',
  'z-index',
  '/^(min-|max-)?(width|height)$/',
];

const KEYWORDS = ['0', 'auto', 'inherit', 'transparent', 'currentColor', 'none'];

export default {
  plugins: ['stylelint-declaration-strict-value', './stylelint-shared-looks.js'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    // Timings are matched as text, not in TOKEN_PROPERTIES: the plugin's shorthand expansion misses a time written
    // first (`1s spin`) or listed after a var (`opacity 120ms, color var(--duration-fast)`).
    // A transition names a role (--motion-*), which holds its time and curve together: no --duration-* paired with a
    // curve by hand or left to the browser's curve. One stays before step-* or linear, and as a delay.
    'declaration-property-value-disallowed-list': {
      '/^(transition|animation)/': ['/(^|[\\s,(])-?[\\d.]+m?s\\b/'],
      '/^transition$/': ['/(^|,)\\s*[a-z-]+\\s+var\\(--duration-(?!instant)[a-z]+\\)(?!\\s+(step-|linear))/'],
      '/^transition-(duration|timing-function)$/': ['/var\\(--(duration|ease)-(?!instant)/'],
    },
    'scale-unlimited/declaration-strict-value': [
      TOKEN_PROPERTIES,
      {
        expandShorthand: true,
        ignoreValues: {
          '': KEYWORDS,
          // A share of the parent, the whole screen or the content's own size is layout, not a size from the design.
          '/^(min-|max-)?(width|height)$/': [...KEYWORDS, '/%$/', '100dvh', 'max-content', 'fit-content'],
        },
      },
    ],
  },
  overrides: [
    {
      files: ['src/**/*.module.css'],
      rules: { 'hazelle/shared-looks': true },
    },
    {
      files: ['src/app/ui/foundation/**'],
      rules: { 'hazelle/shared-looks': null },
    },
    {
      files: ['src/app/ui/foundation/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'scale-unlimited/declaration-strict-value': null,
      },
    },
  ],
};
