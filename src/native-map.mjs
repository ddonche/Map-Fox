/**
 * Native map tiles — foundation for Map Fox 0.7.4.
 * Pure browser/Node module: no DOM, Fext, canvas or working-grid dependency.
 *
 * Land mask bits: 1 = land, 0 = water; missing tile = all water.
 * Owner values: dense indices into regionIds, 65535 = unclaimed land.
 * Stable external IDs (for example 1602) are never used as tile codes.
 *
 * This module is deliberately NOT wired into 0.7.3's editor yet.
 */
export const NATIVE_TILE_SIZE = 256;
export const UNCLAIMED = 65535;
const MAX_NATIVE_PIXELS = 1_000_000_000;
const checkInteger = (n, name) => {
  if (!Number.isSafeInteger(n)) throw new Error('Invalid ' + name);
  return n;
};
const identical = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(binary);
}
function fromBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid base64 tile');
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function writeOwners(owners) {
  let runs = 0;
  for (let i = 0; i < owners.length;) {
    const value = owners[i]; i++;
    while (i < owners.length && owners[i] === value) i++;
    runs++;
  }
  if (runs * 6 < owners.length * 2) {
    const bytes = new Uint8Array(runs * 6), view = new DataView(bytes.buffer);
    let at = 0;
    for (let i = 0; i < owners.length;) {
      const value = owners[i], start = i++;
      while (i < owners.length && owners[i] === value) i++;
      view.setUint16(at, value, true);
      view.setUint32(at + 2, i - start, true);
      at += 6;
    }
    return {encoding:'rle-u16',data:toBase64(bytes)};
  }
  const bytes = new Uint8Array(owners.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < owners.length; i++) view.setUint16(i * 2, owners[i], true);
  return {encoding:'raw-u16',data:toBase64(bytes)};
}
function readOwners(record, length) {
  const bytes = fromBase64(record.data), view = new DataView(bytes.buffer);
  const result = new Uint16Array(length);
  if (record.encoding === 'raw-u16') {
    if (bytes.length !== length * 2) throw new Error('Owner tile length mismatch');
    for (let i = 0; i < length; i++) result[i] = view.getUint16(i * 2, true);
  } else if (record.encoding === 'rle-u16') {
    if (!bytes.length || bytes.length % 6) throw new Error('Invalid owner RLE');
    let i = 0;
    for (let p = 0; p < bytes.length; p += 6) {
      const owner = view.getUint16(p, true), count = view.getUint32(p + 2, true);
      if (!count || i + count > length) throw new Error('Invalid owner RLE run');
      result.fill(owner, i, i + count);
      i += count;
    }
    if (i !== length) throw new Error('Incomplete owner RLE');
  } else throw new Error('Unsupported owner tile encoding');
  return result;
}

export class NativeMap {
  constructor(width, height, {tileSize=NATIVE_TILE_SIZE, regionIds=[]}={}) {
    checkInteger(width,'native width'); checkInteger(height,'native height');
    checkInteger(tileSize,'tile size');
    if (width < 1 || height < 1 || !Number.isSafeInteger(width*height) || width*height > MAX_NATIVE_PIXELS)
      throw new Error('Unsupported native map dimensions');
    if (tileSize < 16 || tileSize > 1024 || (tileSize & (tileSize-1)))
      throw new Error('Native tile size must be a power of two from 16 to 1024');
    this.width=width; this.height=height; this.tileSize=tileSize;
    this.columns=Math.ceil(width/tileSize); this.rows=Math.ceil(height/tileSize);
    this.regionIds=[]; this._regionIndex=new Map(); this.tiles=new Map();
    for (const id of regionIds) this.registerRegion(id);
  }
  registerRegion(id) {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error('Region IDs must be nonnegative safe integers');
    if (this._regionIndex.has(id)) return this._regionIndex.get(id);
    if (this.regionIds.length >= UNCLAIMED) throw new Error('Native region table is full');
    const index=this.regionIds.length;
    this.regionIds.push(id); this._regionIndex.set(id,index);
    return index;
  }
  _where(x,y) {
    checkInteger(x,'native x');checkInteger(y,'native y');
    if (x<0 || y<0 || x>=this.width || y>=this.height) throw new RangeError('Pixel outside native map');
    const tx=Math.floor(x/this.tileSize),ty=Math.floor(y/this.tileSize);
    const tw=Math.min(this.tileSize,this.width-tx*this.tileSize);
    const th=Math.min(this.tileSize,this.height-ty*this.tileSize);
    const offset=(y-ty*this.tileSize)*tw+(x-tx*this.tileSize);
    return {key:ty*this.columns+tx,tx,ty,tw,th,offset};
  }
  _tile(where, create=false) {
    let tile=this.tiles.get(where.key);
    if (!tile && create) {
      const length=where.tw*where.th;
      tile={landBits:new Uint8Array(Math.ceil(length/8)),owners:new Uint16Array(length)};
      tile.owners.fill(UNCLAIMED);this.tiles.set(where.key,tile);
    }
    return tile;
  }
  isLand(x,y) {
    const w=this._where(x,y),t=this._tile(w);
    return !!t && !!(t.landBits[w.offset>>>3] & (1<<(w.offset&7)));
  }
  getRegion(x,y) {
    const w=this._where(x,y),t=this._tile(w);
    if (!t || !(t.landBits[w.offset>>>3] & (1<<(w.offset&7)))) return null;
    const code=t.owners[w.offset];
    return code===UNCLAIMED?-1:this.regionIds[code];
  }
  // Geography edits must be explicit: politics methods may never alter land.
  setLand(x,y,land) {
    if(this._sourceImmutable)throw new Error('Source geography is immutable');
    if (typeof land!=='boolean') throw new Error('Land must be boolean');
    const w=this._where(x,y),t=this._tile(w,land);
    if (!t) return;
    const byte=w.offset>>>3,bit=1<<(w.offset&7);
    if (land)t.landBits[byte]|=bit;
    else {t.landBits[byte]&=~bit;t.owners[w.offset]=UNCLAIMED;}
  }
  setRegion(x,y,id) {
    if(this._sourceImmutable)throw new Error('Source geography is immutable');
    const w=this._where(x,y),t=this._tile(w);
    if (!t || !(t.landBits[w.offset>>>3] & (1<<(w.offset&7))))
      throw new Error('Cannot assign a political region to water');
    if (id === -1) t.owners[w.offset]=UNCLAIMED;
    else t.owners[w.offset]=this.registerRegion(id);
  }
  // For native flat-color imports: exact water test and explicit color mapping.
  // Unknown nonwater colors remain unclaimed instead of inventing regions.
  static fromRGBA({rgba,width,height,background=[0,0,0],waterTolerance=0,colorToRegion=null,tileSize=NATIVE_TILE_SIZE}={}) {
    if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length!==width*height*4)
      throw new Error('Expected exact native RGBA pixel buffer');
    if (!Array.isArray(background) || background.length!==3 || background.some(v=>!Number.isInteger(v)||v<0||v>255))
      throw new Error('Invalid native water color');
    if (!Number.isFinite(waterTolerance)||waterTolerance<0||waterTolerance>255)throw new Error('Invalid water tolerance');
    const result=new NativeMap(width,height,{tileSize});
    const lookup=colorToRegion instanceof Map?colorToRegion:new Map(Object.entries(colorToRegion||{}));
    const allowed=new Map();
    for (const [color,id] of lookup) {
      if (!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Color mapping must use #RRGGBB');
      allowed.set(color.toLowerCase(),id);
      result.registerRegion(id);
    }
    const tol2=waterTolerance*waterTolerance;
    for (let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
      const water=rgba[p+3]<128 || (r-background[0])**2+(g-background[1])**2+(b-background[2])**2<=tol2;
      if (water)continue;
      result.setLand(x,y,true);
      const id=allowed.get('#'+[r,g,b].map(c=>c.toString(16).padStart(2,'0')).join(''));
      if (id!==undefined)result.setRegion(x,y,id);
    }
    return result;
  }
  static fromGrid(map) {
    if (!map || !Number.isInteger(map.width)||!Number.isInteger(map.height) ||
        map.valid?.length!==map.width*map.height||map.layers?.regions?.length!==map.width*map.height)
      throw new Error('Invalid grid-to-native map input');
    const native=new NativeMap(map.width,map.height,{regionIds:(map.palette||[]).map(p=>p.id)});
    for (let i=0;i<map.width*map.height;i++) {
      if (!map.valid[i])continue;
      const x=i%map.width,y=Math.floor(i/map.width),id=map.layers.regions[i];
      native.setLand(x,y,true);
      if (id>=0)native.setRegion(x,y,id);
    }
    return native;
  }
  geometryEquals(other) {
    if (!(other instanceof NativeMap) || other.width!==this.width||other.height!==this.height||other.tileSize!==this.tileSize)return false;
    const keys=new Set([...this.tiles.keys(),...other.tiles.keys()]);
    for (const key of keys) {
      const a=this.tiles.get(key)?.landBits,b=other.tiles.get(key)?.landBits;
      if (!a && !b)continue;
      if (!a && b.some(v=>v))return false;
      if (!b && a.some(v=>v))return false;
      if (a && b && !identical(a,b))return false;
    }
    return true;
  }
  clone() {
    const result=new NativeMap(this.width,this.height,{tileSize:this.tileSize,regionIds:this.regionIds});
    for(const [key,t] of this.tiles)result.tiles.set(key,{landBits:t.landBits.slice(),owners:t.owners.slice()});
    return result;
  }
  // Atomic political replacement: never overwrite the current coastline.
  replacePolitics(other) {
    if(this._sourceImmutable)throw new Error('Source geography is immutable');
    if (!(other instanceof NativeMap)||!this.geometryEquals(other))
      throw new Error('Political variation would change native geography');
    this.regionIds=[...other.regionIds];
    this._regionIndex=new Map(this.regionIds.map((id,i)=>[id,i]));
    for(const [key,t] of this.tiles) {
      const source=other.tiles.get(key);
      // Equivalent all-water tiles may be allocated in only one representation.
      // In that case the other map has no owners here, and the mask is already
      // verified identical by geometryEquals().
      if (source) t.owners.set(source.owners);
      else t.owners.fill(UNCLAIMED);
    }
  }
  serialize() {
    const tiles=[];
    for(const [key,t] of [...this.tiles].sort((a,b)=>a[0]-b[0])) {
      const tx=key%this.columns,ty=Math.floor(key/this.columns);
      const packed=writeOwners(t.owners);
      tiles.push({tx,ty,land:toBase64(t.landBits),owners:packed});
    }
    return {format:'map-fox-native-tiles',version:1,width:this.width,height:this.height,
      tileSize:this.tileSize,regionIds:[...this.regionIds],tiles};
  }
  static deserialize(data) {
    if (!data||data.format!=='map-fox-native-tiles'||data.version!==1)
      throw new Error('Unsupported native tile format');
    const result=new NativeMap(data.width,data.height,{tileSize:data.tileSize,regionIds:data.regionIds});
    if (!Array.isArray(data.tiles)||data.tiles.length>result.columns*result.rows)
      throw new Error('Invalid native tile collection');
    for(const record of data.tiles) {
      if(!record||!Number.isInteger(record.tx)||!Number.isInteger(record.ty)||
         record.tx<0||record.ty<0||record.tx>=result.columns||record.ty>=result.rows)
        throw new Error('Invalid tile coordinate');
      const key=record.ty*result.columns+record.tx;
      if(result.tiles.has(key))throw new Error('Duplicate native tile');
      const tw=Math.min(result.tileSize,result.width-record.tx*result.tileSize);
      const th=Math.min(result.tileSize,result.height-record.ty*result.tileSize);
      const length=tw*th,landBits=fromBase64(record.land);
      if(landBits.length!==Math.ceil(length/8))throw new Error('Native land mask length mismatch');
      const owners=readOwners(record.owners,length);
      for(let i=0;i<length;i++){
        const isLand=!!(landBits[i>>>3]&(1<<(i&7))),owner=owners[i];
        if(owner!==UNCLAIMED && owner>=result.regionIds.length)throw new Error('Owner index outside region table');
        if(!isLand && owner!==UNCLAIMED)throw new Error('Water cannot have an owner');
      }
      if(length%8 && (landBits[landBits.length-1] & ~((1<<(length%8))-1)))
        throw new Error('Nonzero native mask padding');
      result.tiles.set(key,{landBits,owners});
    }
    return result;
  }
}
