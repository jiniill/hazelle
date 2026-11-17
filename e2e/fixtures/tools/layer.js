//@name hazelle-layer-probe
//@display-name 레이어 시험
//@api 3.0
//@version 1.0.0

/* global Risuai, document */

const root = await Risuai.getRootDocument();
const body = await root.querySelector('body');
const box = async (style) => {
  const made = await root.createElement('div');
  await made.setStyleAttribute(style);
  await body.appendChild(made);
  return made;
};
// A box that takes input and scrolls nothing, with a button.
const panel = await box('position:fixed;right:24px;top:160px;width:180px;height:120px;background:#1d3557');
const button = await root.createElement('button');
await button.setStyleAttribute('display:block;width:100%;height:48px');
await button.setTextContent('layer button');
let pressed = 0;
await button.addEventListener('click', () => { void Risuai.alert(`layer pressed ${++pressed}`); });
await panel.appendChild(button);
// A box that only shows, over the composer.
await box('position:fixed;left:0;right:0;bottom:0;height:140px;background:rgba(230,57,70,0.25);pointer-events:none');
await Risuai.registerButton({ name: '레이어 시험 열기' }, async () => {
  document.body.innerHTML = '<h1>layer probe page</h1><button id="shut">닫기</button>';
  document.getElementById('shut').onclick = () => { void Risuai.hideContainer(); };
  await Risuai.showContainer('fullscreen');
});
