import { describe, expect, it } from 'vitest';
import fishing from './fixtures/risu-fishing.js.txt?raw';
import sidePhone from './fixtures/risu-side-phone.js.txt?raw';
import { readToolFile, RISU_AUTHOR, scanRisu } from './risu-plugin';

const read = (source: string) => readToolFile(new TextEncoder().encode(source));

describe('a .js file', () => {
  it('goes to the Risu reader on //@api 3.x, is refused as an older Risu plugin on 2.x or a Risu header without api, and stays a Hazelle tool otherwise', () => {
    expect(read('//@name notes\n//@api 3.0\nrisuai.log("x")')).toMatchObject({ ok: true, tool: { manifest: { name: 'notes', author: RISU_AUTHOR, risu: { verdict: 'all' } } } });
    expect(read('//@name notes\n//@api 3.0 2.1 2.0')).toMatchObject({ ok: true, tool: { manifest: { name: 'notes' } } });
    for (const old of ['//@name notes\n//@api 2.1', '﻿//@name notes\r\n//@display-name Notes\r\n//@arg key string\r\n', '//@name notes\n//@display-name Notes']) {
      expect(read(old)).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'risu-old' } });
    }
    const hazelle = read('//@api 1\n//@name notes\n//@author jin');
    expect(hazelle).toMatchObject({ ok: true, tool: { manifest: { author: 'jin' } } });
    expect(hazelle.ok && hazelle.tool.manifest.risu).toBeUndefined();
  });

  it('reads //@arg lines as settings fields and refuses a malformed one by its line', () => {
    expect(read('//@name notes\n//@api 3.0\n//@arg base string Where pictures come from\n//@arg turns int\n//@arg ask int {{name::Ask first}} {{checkbox::Ask}} Asks before opening')).toMatchObject({
      ok: true, tool: { manifest: { settings: [{ key: 'base', type: 'text', label: 'Where pictures come from' }, { key: 'turns', type: 'number', label: 'turns' }, { key: 'ask', type: 'number', label: 'Ask first' }] } },
    });
    expect(read('//@name notes\n//@api 3.0\n//@arg turns float Turns')).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'tool-setting', line: '//@arg turns float Turns' } });
    expect(read('//@api 3.0\n//@display-name Notes')).toMatchObject({ ok: false, failure: { detail: 'risu-name' } });
    expect(read('//@name Asset Maid\n//@api 3.0')).toMatchObject({ ok: true, tool: { manifest: { name: 'Asset Maid' } } });
  });

  it('reads Side Phone 0.1.0 and Fishing 1.2.3 as working in full', () => {
    expect(read(sidePhone)).toMatchObject({ ok: true, tool: { manifest: {
      name: 'Webso_Phone_v0.1.0', displayName: '사이드폰 플러그인', version: '0.1.0', description: '', uses: ['model', 'network'],
      risu: { verdict: 'all', missing: [], hosts: ['cdn.jsdelivr.net'] },
    } } });
    expect(read(fishing)).toMatchObject({ ok: true, tool: { manifest: {
      name: 'risu_fishing', version: '1.2.3', uses: ['model', 'network'], settings: [{ key: 'image_base', type: 'text' }],
      description: '사용법과 업데이트 https://github.com/bampibubu-blip/risu-fishing\n버그 제보 https://github.com/bampibubu-blip/risu-fishing/issues',
      risu: { verdict: 'all', missing: [], hosts: ['cdn.jsdelivr.net', 'raw.githubusercontent.com'] },
    } } });
  });

  it('declares the network for a fetch, also through an alias, or for a literal host, and not without either', () => {
    const uses = (body: string) => { const result = read(`//@name notes\n//@api 3.0\n${body}`); return result.ok && result.tool.manifest.uses; };
    expect(uses('const api = risuai; await api.nativeFetch(url);')).toEqual(['network']);
    expect(uses('img.src = "https://cdn.example.org/a.png";')).toEqual(['network']);
    expect(uses('await risuai.runLLMModel({ messages, mode: "model" });')).toEqual(['model']);
  });
});

describe('the Risu scan', () => {
  it('lists nothing missing when every name is mapped, reading a quoted risuai as a string and Risu\'s site as a URL', () => {
    expect(scanRisu("await Risuai.showContainer('fullscreen'); risuai['getArgument']('x'); risuai?.addRisuReplacer('afterRequest', f); const p = 'risuai'; const u = 'https://sv.risuai.xyz/a';")).toEqual({ verdict: 'all', missing: [], hosts: ['sv.risuai.xyz'] });
  });

  it('lists unmapped and declined names and replacer kinds once each', () => {
    expect(scanRisu("risuai.loadPlugins(); risuai.loadPlugins(); Risuai.addProvider(); risuai.addRisuReplacer('beforeTranslate', f); risuai.addRisuReplacer('beforeRequest', f);")).toEqual({
      verdict: 'partial', missing: ['loadPlugins', 'addProvider', 'addRisuReplacer:beforeTranslate'], hosts: [],
    });
  });

  it.each([
    ['an alias', 'const R = risuai; R.getDatabase();'],
    ['a destructuring', 'const { getDatabase } = Risuai;'],
    ['an argument', 'start(risuai);'],
    ['a global property', 'globalThis.risuai.getCharacter();'],
    ['a computed name', 'risuai[name]();'],
    ['a replacer kind not written out', 'risuai.addRisuReplacer(kind, f);'],
  ])('cannot read %s', (_, code) => {
    expect(scanRisu(code).verdict).toBe('unread');
  });

  it('still lists the unmapped Risu names an aliased plugin reaches as properties', () => {
    expect(scanRisu("const api = globalThis.risuai; api.getChatFromIndex(0, 0); api?.loadPlugins(); api.addRisuReplacer('beforeTranslate', f); storage.getItem('x');")).toEqual({
      verdict: 'unread', missing: ['loadPlugins', 'addRisuReplacer:beforeTranslate'], hosts: [],
    });
  });

  it('lists each literal host once, leaving out a host a template finishes', () => {
    expect(scanRisu("fetch('https://API.example.com/v1'); fetch(`http://api.example.com/${path}`); load('https://cdn.example.org/a.png'); fetch(`https://bedrock.${region}.aws.com`);").hosts).toEqual(['api.example.com', 'cdn.example.org']);
    expect(scanRisu('const icon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>`; load("https://www.w3.org/Icons/w3c_home.png");').hosts).toEqual(['www.w3.org']);
    expect(scanRisu('const icon = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;').hosts).toEqual([]);
  });
});
