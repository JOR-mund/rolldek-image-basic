function exifOrientation(bytes,start,end) {
  try {
    if (bytes.toString('ascii',start,start+6)!=='Exif\0\0') return 1;
    const base=start+6, order=bytes.toString('ascii',base,base+2);
    if (!['II','MM'].includes(order) || base+8>end) return 1;
    const u16=p=>order==='II'?bytes.readUInt16LE(p):bytes.readUInt16BE(p);
    const u32=p=>order==='II'?bytes.readUInt32LE(p):bytes.readUInt32BE(p);
    if (u16(base+2)!==42) return 1;
    const directory=base+u32(base+4);
    if (directory<base || directory+2>end) return 1;
    const count=u16(directory);
    for(let i=0;i<count;i++) {
      const at=directory+2+i*12;
      if(at+12>end)break;
      if(u16(at)===0x112 && u16(at+2)===3 && u32(at+4)===1) {
        const value=u16(at+8);
        return value>=1 && value<=8 ? value : 1;
      }
    }
  } catch { }
  return 1;
}

export function imageDimensions(bytes) {
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8){
    let offset=2,orientation=1;
    while(offset<bytes.length){
      if(bytes[offset++]!==0xff)throw new Error('参考图 JPEG 标记无效');
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||marker>=0xd0&&marker<=0xd8)continue;
      if(offset+2>bytes.length)break;
      const size=bytes.readUInt16BE(offset);
      if(size<2||offset+size>bytes.length)throw new Error('参考图 JPEG 数据不完整');
      if(marker===0xe1)orientation=exifOrientation(bytes,offset+2,offset+size);
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(size<8)throw new Error('参考图 JPEG 尺寸无效');
        const width=bytes.readUInt16BE(offset+5),height=bytes.readUInt16BE(offset+3);
        return orientation>=5 ? {width:height,height:width} : {width,height};
      }
      offset+=size;
    }
  }
  if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    let offset=12;
    while(offset+8<=bytes.length){
      const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8;
      if(start+size>bytes.length)throw new Error('参考图 WebP 数据不完整');
      if(tag==='VP8X'&&size>=10)return {width:bytes.readUIntLE(start+4,3)+1,height:bytes.readUIntLE(start+7,3)+1};
      if(tag==='VP8L'&&size>=5&&bytes[start]===0x2f){
        const bits=bytes.readUInt32LE(start+1);
        return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
      }
      if(tag==='VP8 '&&size>=10&&bytes.subarray(start+3,start+6).equals(Buffer.from([0x9d,0x01,0x2a])))return {width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};
      offset=start+size+(size&1);
    }
  }
  throw new Error('无法读取参考图尺寸，请在本次请求中指定比例或像素尺寸');
}
