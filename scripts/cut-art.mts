// Cuts an illustration for the first page (ui/landing/art) out of its background and grades it for the night forest.
// Run: tsx scripts/cut-art.mts <arin.png> <cabin.png> [out dir], then npm run brand: the link preview shows 아린.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const [arin, cabin, out = 'src/app/ui/landing/art'] = process.argv.slice(2);
const parts = [
  { name: 'arin', file: arin!, size: { height: 1100 }, grade: 0.82, quality: 0.86 },
  { name: 'cabin', file: cabin!, size: { width: 1400 }, grade: 0.66, quality: 0.84 },
];
const b = await chromium.launch(); const p = await b.newPage(); // tsx wraps named functions in __name, which a page does not have.
await p.evaluate('globalThis.__name = (fn) => fn');
for (const part of parts) {
  const data = (await readFile(part.file)).toString('base64');
  const r = await p.evaluate(async ({ src, part }) => {
    const i = new Image(); i.src = src; await i.decode();
    const W = i.width, H = i.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(i, 0, 0);
    const im = x.getImageData(0, 0, W, H); const d = im.data;
    // solid: confidently the subject. Keep only the largest connected piece, so loose flakes of the old background go.
    const solid = new Uint8Array(W * H);
    for (let n = 0; n < W * H; n++) solid[n] = d[n * 4 + 3]! > 200 ? 1 : 0;
    const mark = new Int32Array(W * H); let best = 0, bestId = 0, id = 0;
    const stack: number[] = [];
    for (let n = 0; n < W * H; n++) {
      if (!solid[n] || mark[n]) continue;
      id++; let size = 0; stack.push(n); mark[n] = id;
      while (stack.length) { const m = stack.pop()!; size++; const y = (m / W) | 0, xx = m % W;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) { const nx = xx + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const k = ny * W + nx; if (solid[k] && !mark[k]) { mark[k] = id; stack.push(k); } } }
      if (size > best) { best = size; bestId = id; }
    }
    const keep = new Uint8Array(W * H);
    for (let n = 0; n < W * H; n++) keep[n] = mark[n] === bestId ? 1 : 0;
    // Pull the edge in by a pixel: the fringe of the old background lives there.
    const core = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) { const n = y * W + xx; core[n] = keep[n] && keep[n-1] && keep[n+1] && keep[n-W] && keep[n+W] ? 1 : 0; }
    // Edge pixels take the color of the subject beside them, with a soft alpha.
    const rgb = new Uint8ClampedArray(d);
    for (let y = 2; y < H - 2; y++) for (let xx = 2; xx < W - 2; xx++) { const n = y * W + xx; if (core[n]) continue;
      let r=0,g=0,bb=0,cnt=0; for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++){ const k=(y+dy)*W+xx+dx; if(core[k]){const o=k*4; r+=d[o]!;g+=d[o+1]!;bb+=d[o+2]!;cnt++;} }
      const o=n*4; if(cnt){rgb[o]=r/cnt;rgb[o+1]=g/cnt;rgb[o+2]=bb/cnt;rgb[o+3]=Math.min(255,cnt*30);} else rgb[o+3]=0; }
    for (let n = 0; n < W * H; n++) if (core[n]) rgb[n*4+3]=255;
    // Night grade: the lit parts stay, the rest falls into the forest's blue dusk.
    let minx=W,miny=H,maxx=0,maxy=0;
    for (let y=0;y<H;y++) for (let xx=0;xx<W;xx++){ const o=(y*W+xx)*4; if(rgb[o+3]!<8) continue; minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
      const R=rgb[o]!/255,G=rgb[o+1]!/255,B=rgb[o+2]!/255; const lum=.3*R+.59*G+.11*B; const warm=Math.max(0,Math.min(1,(R-B)*2.4));
      const t=Math.max(0,Math.min(1,(lum-.34)/.36)); const hot=Math.max(0,Math.min(1,(lum-.68)/.14)); const lit=t*t*(3-2*t)*Math.max(warm,hot);
      const g=part.grade; const nr=R*g*.8, ng=G*g*.8, nb=B*g*1.0+.03;
      rgb[o]=(nr+(R-nr)*lit)*255; rgb[o+1]=(ng+(G-ng)*lit)*255; rgb[o+2]=(nb+(B-nb)*lit)*255; }
    x.putImageData(new ImageData(rgb, W, H), 0, 0);
    const bw=maxx-minx+1, bh=maxy-miny+1;
    const scale = 'height' in part.size ? part.size.height!/bh : part.size.width!/bw;
    const t=document.createElement('canvas'); t.width=Math.round(bw*scale); t.height=Math.round(bh*scale);
    const tx=t.getContext('2d')!; tx.imageSmoothingQuality='high'; tx.drawImage(c,minx,miny,bw,bh,0,0,t.width,t.height);
    return { webp: t.toDataURL('image/webp', part.quality), w:t.width,h:t.height,box:[minx,miny,maxx,maxy],W,H };
  }, { src: `data:image/png;base64,${data}`, part });
  const b64 = (s: string) => Buffer.from(s.split(',')[1]!, 'base64');
  const web = b64(r.webp); await writeFile(`${out}/${part.name}.webp`, web);
  console.log(part.name, r.w, r.h, 'source', r.W, r.H, 'box', r.box.join(','), Math.round(web.length/1024)+'K');
}
await b.close();
