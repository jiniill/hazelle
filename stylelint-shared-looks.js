import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import stylelint from 'stylelint';

// Read shared looks from their source classes so composes enforcement follows style changes automatically.
const ruleName = 'hazelle/shared-looks';
const messages = stylelint.utils.ruleMessages(ruleName, {
  look: (look, file) => `This rule redeclares the ${look} look: take it with \`composes: ${look} from '…/foundation/${file}'\`.`,
});

const FOUNDATION = new URL('./src/app/ui/foundation/', import.meta.url);
const TEXT = ['font-size', 'color', 'font-weight'];

// postcss is stylelint's dependency, not this repo's; the looks are rules of one plain class each, which a pattern reads.
function looksIn(file, names) {
  const looks = new Map();
  for (const [, name, body] of readFileSync(new URL(file, FOUNDATION), 'utf8').matchAll(/^\s*\.(\w+) \{([^}]*)\}/gm)) {
    if (!names.includes(name)) continue;
    const found = {};
    for (const [, prop, value] of body.matchAll(/([a-z-]+): ([^;]+);/g)) if (prop !== 'composes') found[prop] = value;
    looks.set(name, found);
  }
  return looks;
}

function declarations(rule) {
  const found = {};
  rule.each((node) => {
    if (node.type === 'decl' && node.prop !== 'composes') found[node.prop] = node.value;
  });
  return found;
}

// error composes note, so its font-size is note's.
const textLooks = looksIn('type.module.css', ['note', 'detail', 'title', 'fieldLabel', 'error']);
textLooks.set('error', { ...textLooks.get('note'), ...textLooks.get('error') });
const track = looksIn('surface.module.css', ['track']).get('track');
const grounds = looksIn('surface.module.css', ['glass', 'floating']);

// Report matching text looks only when no text property differs; e.g. an independent weight makes a distinct look.
const redeclaresText = (own, look) =>
  ['font-size', look['font-weight'] ? 'font-weight' : 'color'].every((prop) => own[prop] === look[prop]) && TEXT.every((prop) => own[prop] === undefined || own[prop] === look[prop]);

// A fraction bar's track is its height and radius; each bar fills it in its own colour.
const redeclaresTrack = (own) => own.height === track.height && own['border-radius'] === track['border-radius'] && (own.background ?? own['background-color']) !== undefined;

// Only standalone classes can compose; do not flag repeated surfaces in :global or at-rules that cannot use composes.
const redeclaresGround = (node, own, look) =>
  node.parent.type === 'root' && /^\.[\w-]+$/.test(node.selector) && Object.entries(look).every(([prop, value]) => own[prop] === value);

const rule = (enabled) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: enabled, possible: [true] })) return;
  root.walkRules((node) => {
    const own = declarations(node);
    for (const [look, values] of textLooks) {
      if (redeclaresText(own, values)) stylelint.utils.report({ ruleName, result, node, message: messages.look(look, 'type.module.css') });
    }
    if (redeclaresTrack(own)) stylelint.utils.report({ ruleName, result, node, message: messages.look('track', 'surface.module.css') });
    for (const [look, values] of grounds) {
      if (redeclaresGround(node, own, values)) stylelint.utils.report({ ruleName, result, node, message: messages.look(look, 'surface.module.css') });
    }
  });
};
rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
