import {createHash} from 'node:crypto';
import sharp from 'sharp';

const palettes = {
  love: {night:[32,24,65], mid:[110,49,96], light:[255,171,144], ink:[51,30,78]},
  healing: {night:[15,54,60], mid:[58,122,110], light:[230,224,166], ink:[19,69,69]},
  life: {night:[38,36,56], mid:[127,74,65], light:[248,198,131], ink:[46,43,64]},
};

/** Create a distinct text-free square when the generation provider cannot deliver its image. */
export function renderPlanArtwork(theme:string, identity:string) {
  const palette=palettes[theme.includes('恋爱')?'love':theme.includes('治愈')?'healing':'life'];
  const seed=createHash('sha256').update(identity).digest();
  const size=720, pixels=Buffer.alloc(size*size*3);
  const centerX=.3+.39*seed[0]/255,centerY=.28+.25*seed[1]/255;
  const radius=.13+.06*seed[2]/255, tilt=(seed[3]/255-.5)*.38;
  const horizon=.62+.13*seed[4]/255, ripple=8+seed[5]%9;
  let grain=seed.readUInt32LE(6);
  for(let y=0;y<size;y++){
    const v=y/(size-1);
    for(let x=0;x<size;x++){
      const u=x/(size-1),dx=u-centerX,dy=v-centerY;
      const distance=Math.hypot(dx,dy);
      const glow=Math.exp(-distance*3.4)*.78;
      const disc=Math.min(1,Math.max(0,(radius-distance)*size));
      const ridge=v-horizon-tilt*(u-.5)-.045*Math.sin(u*5+seed[10]);
      const shadow=Math.min(1,Math.max(0,ridge*size))*.86;
      const trace=Math.exp(-Math.abs(ridge-.07-.025*Math.sin(u*8+seed[11]))*82)*.25;
      const bands=.04*Math.sin((v+dx*dx)*ripple);
      grain=(Math.imul(grain,1664525)+1013904223)>>>0;
      const texture=(grain>>>24)/255*6-3;
      for(let channel=0;channel<3;channel++){
        const sky=palette.night[channel]+(palette.mid[channel]-palette.night[channel])*(v*.75+bands);
        const lit=sky+(palette.light[channel]-sky)*Math.min(1,glow+disc*.82+trace);
        const value=lit+(palette.ink[channel]-lit)*shadow;
        pixels[(y*size+x)*3+channel]=Math.max(0,Math.min(255,Math.round(value+texture)));
      }
    }
  }
  return sharp(pixels,{raw:{width:size,height:size,channels:3}}).resize(1440,1440).jpeg({quality:94}).toBuffer();
}
