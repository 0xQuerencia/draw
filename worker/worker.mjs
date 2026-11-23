
const MAX=900000;
const allowed=new Set(["https://draw.querencia.art","https://draw-querencia-art.vercel.app","http://localhost:5173"]);
const newer=(a,b)=>!a||b.version>a.version||(b.version===a.version&&(b.versionNonce||0)>(a.versionNonce||0));
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.doc = { elements: [], files: {}, revision: 0 };
    this.stickers = [];
    this.comments = [];
    this.meta = { title: 'Untitled board', updatedAt: 0 };
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.doc = await ctx.storage.get('board') || this.doc;
      this.stickers = await ctx.storage.get('stickers') || [];
      this.comments = await ctx.storage.get('comments') || [];
      this.meta = await ctx.storage.get('meta') || this.meta;
    });
  }
  members() {
    return this.ctx.getWebSockets().map(s => {
      const a = s.deserializeAttachment() || {};
      return { id: a.id, name: a.name || 'Guest', pointer: a.pointer || null, viewport: a.viewport || null };
    }).filter(x => x.id);
  }
  emit(data, exclude) {
    const raw = JSON.stringify(data);
    for (const s of this.ctx.getWebSockets()) if (s !== exclude) try { s.send(raw); } catch {}
  }
  async fetch(request) {
    await this.ready;
    const path = new URL(request.url).pathname;
    // Preserve the live Draw MCP plugin's existing scene / patch integration.
    if (path === '/_agent/scene') return Response.json({
      elements: this.doc.elements, revision: this.doc.revision, members: this.members()
    });
    if (path === '/_agent/patch' && request.method === 'POST') {
      const data = await request.json();
      await this.webSocketMessage({ deserializeAttachment: () => ({ id: 'chatgpt-agent' }) },
        JSON.stringify({ type: 'patch', elements: data.elements || [], files: data.files || {} }));
      return Response.json({ revision: this.doc.revision, element_count: this.doc.elements.length });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.ctx.getWebSockets().length >= 24) return new Response('Room full', { status: 429 });
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || 'Guest').slice(0, 32).replace(/[<>]/g, '');
    const id = (url.searchParams.get('client') || crypto.randomUUID()).slice(0, 80);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name, pointer: null });
    server.send(JSON.stringify({ type: 'snapshot', elements: this.doc.elements, files: this.doc.files, revision: this.doc.revision, members: this.members(), stickers: this.stickers, comments: this.comments, meta: this.meta }));
    this.emit({ type: 'members', members: this.members() });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX) return;
    let data; try { data = JSON.parse(raw); } catch { return; }
    const author = (ws.deserializeAttachment() || {}).id;
    if (data.type === 'pointer') {
      if (!data.pointer || !Number.isFinite(data.pointer.x) || !Number.isFinite(data.pointer.y)) return;
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, pointer: { x: data.pointer.x, y: data.pointer.y } });
      this.emit({ type: 'pointer', id: author, pointer: data.pointer }, ws);
      return;
    }
    if (data.type === 'room_meta') {
      if (typeof data.title !== 'string') return;
      const title = data.title.trim().slice(0, 80);
      if (!title) return;
      this.meta = { title, updatedAt: Date.now() };
      await this.ctx.storage.put('meta', this.meta);
      this.emit({ type: 'room_meta', meta: this.meta });
      return;
    }
    if (data.type === 'comment_event') {
      const attachment = ws.deserializeAttachment() || {};
      const authorName = (attachment.name || 'Guest').slice(0, 32).replace(/[<>]/g, '');
      const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
      if (data.op === 'add') {
        const c = data.comment;
        if (!c || typeof c.id !== 'string' || c.id.length > 64 || this.comments.some(old => old.id === c.id)) return;
        if (!['comment', 'note'].includes(c.kind) || ![c.x,c.y].every(Number.isFinite) || Math.abs(c.x) > 100000 || Math.abs(c.y) > 100000) return;
        const body = text(c.body);
        if (!body || this.comments.length >= 250) return;
        this.comments = [...this.comments, { id: c.id, x: c.x, y: c.y, kind: c.kind, body,
          author: authorName, at: Date.now(), resolved: false, replies: [] }];
      } else if (data.op === 'reply') {
        const c = this.comments.find(x => x.id === data.id);
        const r = data.reply;
        if (!c || !r || typeof r.id !== 'string' || r.id.length > 64 || c.replies.length >= 100) return;
        const body = text(r.body);
        if (!body || c.replies.some(x => x.id === r.id)) return;
        c.replies.push({ id: r.id, body, author: authorName, at: Date.now() });
      } else if (data.op === 'resolve') {
        const c = this.comments.find(x => x.id === data.id);
        if (!c || typeof data.resolved !== 'boolean') return;
        c.resolved = data.resolved;
      } else return;
      await this.ctx.storage.put('comments', this.comments);
      this.meta.updatedAt = Date.now(); await this.ctx.storage.put('meta', this.meta);
      this.emit({ type: 'comments', comments: this.comments });
      return;
    }
    if (data.type === 'reaction') {
      const r = data.reaction;
      if (!r || !['❤️', '✨', '🎉', '👍', '😂', '🥹', '🔥', '💜'].includes(r.emoji)) return;
      if (typeof r.id !== 'string' || r.id.length > 64) return;
      const reaction = { id: r.id, emoji: r.emoji,
        x: Number.isFinite(r.x) ? Math.min(1, Math.max(0, r.x)) : .5,
        y: Number.isFinite(r.y) ? Math.min(1, Math.max(0, r.y)) : .6 };
      this.emit({ type: 'reaction', reaction }, ws);
      return;
    }
    if (data.type === 'sticker') {
      const s = data.sticker;
      if (!s || typeof s.id !== 'string' || s.id.length > 64) return;
      if (data.op !== 'delete' && data.op !== 'upsert') return;
      if (data.op === 'delete') {
        this.stickers = this.stickers.filter(item => item.id !== s.id);
      } else {
        if (!['❤️', '✨', '🎉', '👍', '😂', '🥹', '🔥', '💜'].includes(s.emoji)) return;
        if (![s.x,s.y,s.size].every(Number.isFinite) || Math.abs(s.x) > 100000 || Math.abs(s.y) > 100000 || s.size < 16 || s.size > 160) return;
        if (this.stickers.length >= 400 && !this.stickers.some(item => item.id === s.id)) return;
        this.stickers = [...this.stickers.filter(item => item.id !== s.id), { id: s.id, emoji: s.emoji, x: s.x, y: s.y, size: s.size }];
      }
      await this.ctx.storage.put('stickers', this.stickers);
      this.meta.updatedAt = Date.now(); await this.ctx.storage.put('meta', this.meta);
      this.emit({ type: 'sticker', op: data.op, sticker: s }, ws);
      return;
    }
    if (data.type === 'view') {
      const v = data.viewport;
      if (!v || !Number.isFinite(v.scrollX) || !Number.isFinite(v.scrollY) || !Number.isFinite(v.zoom) || v.zoom < 0.05 || v.zoom > 30) return;
      const viewport = { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom };
      ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), viewport });
      this.emit({ type: 'view', id: author, viewport }, ws);
      return;
    }
    if (data.type !== 'patch' || !Array.isArray(data.elements) || data.elements.length > 2000 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) return;
    const current = [...this.doc.elements];
    const index = new Map(current.map((e, i) => [e.id, i]));
    const accepted = [];
    for (const e of data.elements) {
      if (!e || typeof e.id !== 'string' || e.id.length > 128 || !Number.isInteger(e.version) || e.version < 1) continue;
      const at = index.get(e.id), old = at === undefined ? null : current[at];
      if (newer(old, e)) { if (at === undefined) { index.set(e.id, current.length); current.push(e); } else current[at] = e; accepted.push(e); }
    }
    const fresh = {};
    for (const [k, f] of Object.entries(data.files)) {
      if (k.length > 128 || !f || typeof f !== 'object' || typeof f.dataURL !== 'string' || f.dataURL.length > 550000) continue;
      if (!this.doc.files[k]) fresh[k] = f;
    }
    if (!accepted.length && !Object.keys(fresh).length) return;
    if (current.length > 5000) return;
    this.doc.elements = current;
    Object.assign(this.doc.files, fresh);
    this.doc.revision += 1;
    await this.ctx.storage.put('board', this.doc);
    this.meta.updatedAt = Date.now(); await this.ctx.storage.put('meta', this.meta);
    this.emit({ type: 'patch', elements: accepted, files: fresh, revision: this.doc.revision, author });
  }
  webSocketClose(ws, code, reason) {
    this.emit({ type: 'members', members: this.members().filter(x => x.id !== (ws.deserializeAttachment() || {}).id) });
    try { ws.close(code >= 1000 && code < 5000 && ![1004,1005,1006,1015].includes(code) ? code : 1000, reason); } catch {}
  }
  webSocketError(ws) { this.webSocketClose(ws, 1000, ''); }
}


const AGENT_PROTOCOL="2026-07-28";
const BOARD_PATTERN=/^[a-f0-9]{32}$/;
const MAX_SCENE=200;
const PALETTE=["#b5a5e8","#9bc8d5","#efb7a0","#d9c891","#aad6b1","#e2afcf","#c9b8ed","#f1c7a5"];
const D62="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function nextKey(last){
 if(!last)return "a0";
 const h=last[0],body=last.slice(1),length=h.charCodeAt(0)-97+1;
 if(!/^[a-z]$/.test(h)||length<2||length>6||body.length!==length-1||![...body].every(c=>D62.includes(c)))return "b00";
 let pos=body.length-1,a=[...body];
 while(pos>=0&&a[pos]==="z"){a[pos]="0";pos--}
 if(pos>=0){a[pos]=D62[D62.indexOf(a[pos])+1];return h+a.join("")}
 return String.fromCharCode(h.charCodeAt(0)+1)+("0".repeat(body.length+1));
}
function nextIndexes(scene,count){
 let highest=scene.elements.map(e=>e.index).filter(x=>typeof x==="string").sort().at(-1);
 const output=[];
 for(let i=0;i<count;i++){highest=nextKey(highest);output.push(highest)}
 return output;
}
function boardId(input){
 const raw=String(input||"").trim();
 let id=raw;
 if(raw.includes("://")||raw.startsWith("draw.")){
  let url;try{url=new URL(raw.startsWith("http")?raw:"https://"+raw)}catch{throw Error("Invalid board URL")}
  if(url.hostname!=="draw.querencia.art")throw Error("Board must be hosted on draw.querencia.art");
  id=new URLSearchParams(url.hash.slice(1)).get("room")||"";
 }
 if(!BOARD_PATTERN.test(id))throw Error("Provide a shared board URL containing a 32-character #room ID");
 return id;
}
function linkFor(id){return "https://draw.querencia.art/#room="+id}
function rndId(){return crypto.randomUUID().replace(/-/g,"")}
function color(value,fallback){return typeof value==="string"&&(/^#[0-9a-fA-F]{6}$/.test(value)||value==="transparent")?value:fallback}
function num(n,min,max,fallback){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function element(type,x,y,w,h,options={}){
 const r=crypto.getRandomValues(new Uint32Array(2)),id=rndId();
 return {
  id,type,x,y,width:w,height:h,angle:0,strokeColor:options.stroke||"#534969",
  backgroundColor:options.fill||"transparent",fillStyle:"solid",strokeWidth:options.weight||2,
  strokeStyle:"solid",roughness:options.roughness??1,opacity:100,groupIds:options.group?[options.group]:[],
  frameId:null,roundness:(type==="rectangle"?{type:3}:null),seed:r[0]||1,version:1,versionNonce:r[1]||1,
  isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false
 };
}
function wrapLabel(label,chars=20){
 const words=String(label||"").trim().split(/\s+/),rows=[],max=chars;
 let line="";
 for(const word of words){
  if((line+" "+word).trim().length>max&&line){rows.push(line);line=word}else line=(line+" "+word).trim();
 }
 if(line)rows.push(line);
 return rows.join("\n").slice(0,400);
}
function textEl(str,cx,cy,w,h,options={}){
 const size=options.size||20;
 const lines=wrapLabel(str,options.wrap||22);
 const e=element("text",cx-w/2,cy-h/2,w,h,{stroke:options.stroke||"#302b3b",group:options.group,roughness:0,weight:1});
 return {...e,text:lines,originalText:String(str),fontSize:size,fontFamily:options.fontFamily||1,
   textAlign:"center",verticalAlign:"middle",containerId:null,autoResize:false,lineHeight:1.25};
}
function nodeEl(str,cx,cy,w,h,options={}){
 const group=rndId(),bg=element(options.shape||"rectangle",cx-w/2,cy-h/2,w,h,{
   stroke:options.stroke||"#625779",fill:options.fill||"#f1eafa",group,weight:2,roughness:options.roughness??1
 });
 const txt=textEl(str,cx,cy,w-26,h-12,{group,size:options.size||19,wrap:options.wrap||22,fontFamily:options.fontFamily||1});
 return [bg,txt];
}
function route(x1,y1,x2,y2,stroke="#9d8dc0",weight=2){
 const minx=Math.min(x1,x2),miny=Math.min(y1,y2);
 const pts=[[x1-minx,y1-miny],[(x1+x2)/2-minx,y1-miny],[x2-minx,y2-miny]];
 const e=element("line",minx,miny,Math.abs(x2-x1),Math.abs(y2-y1),{stroke,weight,roughness:1});
 return {...e,points:pts,lastCommittedPoint:null,startBinding:null,endBinding:null};
}
function makeMindmap(topic,branches,layout){
 if(!topic||topic.length>140)throw Error("central_topic is required (maximum 140 characters)");
 if(!Array.isArray(branches)||branches.length===0||branches.length>12)throw Error("Provide 1 to 12 main branches");
 const total=branches.reduce((acc,b)=>acc+1+(b.children?.length||0),1);
 if(total>60)throw Error("Maximum 60 nodes per mind map");
 const w=280,h=84,leaves=240;
 const lines=[],nodes=[];
 nodes.push(...nodeEl(topic,0,0,330,104,{fill:"#e4d5fb",size:27,wrap:23,stroke:"#614488"}));
 const sides=layout==="right"?[branches,[]]:layout==="left"?[[],branches]:[branches.filter((_,i)=>i%2===0),branches.filter((_,i)=>i%2===1)];
 for(let side=0;side<2;side++){
  const sign=side===0?1:-1,arr=sides[side],units=arr.map(b=>Math.max(1,(b.children||[]).length));
  const span=units.reduce((x,y)=>x+y*130+85,0);
  let offset=-span/2;
  arr.forEach((b,i)=>{
   const count=Math.max(1,(b.children||[]).length),groupHeight=count*130;
   const yy=offset+groupHeight/2,xx=sign*570;
   const fill=color(b.color,PALETTE[branches.indexOf(b)%PALETTE.length]);
   lines.push(route(sign*165,0,xx-sign*140,yy,fill,3));
   nodes.push(...nodeEl(b.label,xx,yy,w,h,{fill,wrap:22,size:22,stroke:"#665b76"}));
   if(Array.isArray(b.children))b.children.forEach((child,j)=>{
    const text=typeof child==="string"?child:child.label;
    const cy=offset+(j+.5)*130,cx=sign*1030;
    lines.push(route(xx+sign*140,yy,cx-sign*130,cy,fill,2));
    nodes.push(...nodeEl(text,cx,cy,260,88,{fill:"#fff9ef",size:17,wrap:24,stroke:fill}));
   });
   offset+=groupHeight+85;
  });
 }
 return [...lines,...nodes];
}
function makeDiagram(nodes,edges=[]){
 if(!Array.isArray(nodes)||nodes.length===0||nodes.length>45)throw Error("Supply 1 to 45 nodes");
 if(!Array.isArray(edges)||edges.length>90)throw Error("Maximum 90 links");
 const pos=new Map(),lines=[],shapes=[];
 for(const n of nodes){
  if(!n.id||pos.has(n.id))throw Error("Unique node IDs required");
  const x=num(n.x,-10000,10000,0),y=num(n.y,-10000,10000,0),w=num(n.width,80,600,240),h=num(n.height,40,400,85);
  pos.set(n.id,{x,y,w,h});
  shapes.push(...nodeEl(String(n.label||n.id).slice(0,300),x,y,w,h,{
   shape:["rectangle","ellipse","diamond"].includes(n.shape)?n.shape:"rectangle",
   fill:color(n.color,"#f3edfc"),size:num(n.font_size,12,48,20),stroke:color(n.stroke,"#625779")
  }));
 }
 for(const edge of edges){
  const from=pos.get(edge.from),to=pos.get(edge.to);
  if(!from||!to)throw Error("Connection references unknown node");
  const sign=to.x>from.x?1:-1;
  lines.push(route(from.x+sign*from.w/2,from.y,to.x-sign*to.w/2,to.y,color(edge.color,"#9584ae"),2));
 }
 return [...lines,...shapes];
}
function makeNotes(title,sections){
 if(!Array.isArray(sections)||!sections.length||sections.length>16)throw Error("Provide 1 to 16 sections");
 const all=[];
 all.push(textEl(title,0,0,940,90,{size:36,wrap:42,stroke:"#6f539b"}));
 let y=130;
 for(let i=0;i<sections.length;i++){
  const s=sections[i],heading=String(s.heading||"").slice(0,120),lines=(Array.isArray(s.lines)?s.lines:[]).slice(0,14).map(v=>String(v).slice(0,190));
  if(!heading&&!lines.length)continue;
  const hh=lines.length*54+85;
  const fill=i%2===0?"#fff7e7":"#f1ecfc";
  all.push(element("rectangle",-490,y,980,hh,{fill,stroke:"#c9bbd7",weight:1}));
  all.push(textEl(heading,0,y+36,900,50,{size:24,wrap:48,stroke:"#543f74"}));
  for(let j=0;j<lines.length;j++)all.push(textEl("• "+lines[j],0,y+90+j*54,895,52,{size:20,wrap:64,stroke:"#302c3b"}));
  y+=hh+25;
 }
 if(all.length>130)throw Error("Notes too long; split into multiple requests");
 return all;
}
function ordered(scene,items){
 let key=scene.elements.map(e=>e.index).filter(x=>typeof x==="string").sort().at(-1);
 for(const item of items){key=nextKey(key);item.index=key}
 return items;
}
async function readRoom(env,id){
 const r=await env.ROOMS.getByName(id).fetch("https://internal/_agent/scene");
 if(!r.ok)throw Error("Unable to load room");
 return r.json();
}
async function writeRoom(env,id,items){
 const scene=await readRoom(env,id);
 if(scene.elements.length+items.length>800)throw Error("Board has reached the 800-element agent limit");
 ordered(scene,items);
 const r=await env.ROOMS.getByName(id).fetch("https://internal/_agent/patch",{
   method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({elements:items,files:{}})
 });
 if(!r.ok)throw Error("Unable to update room");
 return {board_url:linkFor(id),added:items.length,...await r.json()};
}
const STR={type:"string"};
const boardField={type:"string",description:"Share URL from draw.querencia.art containing #room=..., or 32-character room ID"};
const TOOLS=[
 {name:"create_shared_board",description:"Create a new live collaboration room on draw.querencia.art. Returns a share URL for the same website. Does not alter local/private tabs.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"get_shared_board",description:"Read the current editable scene of a shared board by its share link. Only rooms identified by unguessable share links are accessible; private local tabs are not accessible.",inputSchema:{type:"object",properties:{board_url:boardField,include_elements:{type:"boolean",default:true,description:"Whether to include editable Excalidraw element JSON"}},required:["board_url"],additionalProperties:false}},
 {name:"draw_mind_map",description:"Generate and draw an editable, hand-drawn-styled mind map on a new or existing shared Excalidraw board. Include complete factual content in the branch labels. Optional board_url appends to that room; without it, creates a new shared room.",inputSchema:{type:"object",properties:{board_url:boardField,central_topic:{type:"string",maxLength:140},branches:{type:"array",minItems:1,maxItems:12,items:{type:"object",properties:{label:{type:"string",maxLength:140},color:{type:"string",description:"Optional pastel hex color"},children:{type:"array",maxItems:12,items:{type:"string",maxLength:250}}},required:["label"],additionalProperties:false}},layout:{type:"string",enum:["balanced","right","left"],default:"balanced"}},required:["central_topic","branches"],additionalProperties:false}},
 {name:"draw_diagram",description:"Add an editable diagram, flowchart, concept map, or structured illustration to a shared Excalidraw room using labeled nodes and connecting lines.",inputSchema:{type:"object",properties:{board_url:boardField,nodes:{type:"array",minItems:1,maxItems:45,items:{type:"object",properties:{id:STR,label:STR,x:{type:"number"},y:{type:"number"},width:{type:"number"},height:{type:"number"},shape:{type:"string",enum:["rectangle","ellipse","diamond"]},color:STR,stroke:STR,font_size:{type:"number"}},required:["id","label","x","y"],additionalProperties:false}},edges:{type:"array",maxItems:90,items:{type:"object",properties:{from:STR,to:STR,color:STR},required:["from","to"],additionalProperties:false}}},required:["board_url","nodes"],additionalProperties:false}},
 {name:"write_handdrawn_notes",description:"Add neat, editable hand-drawn-style study notes in an Excalidraw shared room. The font approximates handwriting; it is not the user's exact personal handwriting.",inputSchema:{type:"object",properties:{board_url:boardField,title:{type:"string",maxLength:140},sections:{type:"array",minItems:1,maxItems:16,items:{type:"object",properties:{heading:{type:"string"},lines:{type:"array",maxItems:14,items:{type:"string",maxLength:190}}},required:["heading","lines"],additionalProperties:false}}},required:["title","sections"],additionalProperties:false}},
 {name:"edit_shared_element",description:"Modify one existing Excalidraw element by ID on a shared board (text, position, foreground color or background color). Keeps other elements and private tabs intact.",inputSchema:{type:"object",properties:{board_url:boardField,element_id:STR,text:STR,x:{type:"number"},y:{type:"number"},stroke_color:STR,background_color:STR},required:["board_url","element_id"],additionalProperties:false}}
];
async function action(name,args,env){
 if(name==="create_shared_board"){const id=rndId();return {board_url:linkFor(id),room_id:id,access:"Anyone with the unguessable link can edit; treat it as a secret"}}
 if(name==="get_shared_board"){
  const id=boardId(args.board_url),board=await readRoom(env,id);
  const result={board_url:linkFor(id),revision:board.revision,element_count:board.elements.length,participants:board.members||[]};
  if(args.include_elements!==false)result.elements=board.elements.slice(0,MAX_SCENE);
  return result;
 }
 if(name==="draw_mind_map"){
  const id=args.board_url?boardId(args.board_url):rndId();
  const items=makeMindmap(String(args.central_topic||""),args.branches,args.layout||"balanced");
  return {kind:"mind_map",central_topic:args.central_topic,...await writeRoom(env,id,items)};
 }
 if(name==="draw_diagram"){
  const id=boardId(args.board_url),items=makeDiagram(args.nodes,args.edges||[]);
  return {kind:"diagram",...await writeRoom(env,id,items)};
 }
 if(name==="write_handdrawn_notes"){
  const id=args.board_url?boardId(args.board_url):rndId();
  const items=makeNotes(String(args.title||"Notes"),args.sections);
  return {kind:"handdrawn_notes",font:"Excalidraw hand-drawn (not a personal handwriting clone)",...await writeRoom(env,id,items)};
 }
 if(name==="edit_shared_element"){
  const id=boardId(args.board_url),s=await readRoom(env,id);
  const old=s.elements.find(e=>e.id===args.element_id&&!e.isDeleted);
  if(!old)throw Error("Element not found");
  const allowed=["text","x","y","stroke_color","background_color"];
  if(!allowed.some(k=>Object.prototype.hasOwnProperty.call(args,k)))throw Error("No edits requested");
  const next={...old,version:old.version+1,versionNonce:crypto.getRandomValues(new Uint32Array(1))[0],updated:Date.now()};
  if(args.text!==undefined){
   if(old.type!=="text")throw Error("Only a text element can be renamed");
   next.originalText=String(args.text).slice(0,350);
   next.text=wrapLabel(next.originalText,28);
  }
  if(args.x!==undefined)next.x=num(args.x,-10000,10000,next.x);
  if(args.y!==undefined)next.y=num(args.y,-10000,10000,next.y);
  if(args.stroke_color!==undefined)next.strokeColor=color(args.stroke_color,next.strokeColor);
  if(args.background_color!==undefined)next.backgroundColor=color(args.background_color,next.backgroundColor);
  const r=await env.ROOMS.getByName(id).fetch("https://internal/_agent/patch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({elements:[next],files:{}})});
  if(!r.ok)throw Error("Edit failed");
  return {board_url:linkFor(id),updated_element_id:next.id,revision:(await r.json()).revision};
 }
 throw Error("Unknown tool: "+name);
}
function jrpc(id,obj,status=200){
 return Response.json({jsonrpc:"2.0",id,...obj},{status,headers:{"Cache-Control":"no-store"}});
}
async function handleMcp(request,env){
 if(request.method!=="POST")return new Response("POST JSON-RPC only",{status:405,headers:{Allow:"POST"}});
 if(Number(request.headers.get("Content-Length"))>850000)return new Response("Request too large",{status:413});
 let body;try{body=await request.json()}catch{return jrpc(null,{error:{code:-32700,message:"Parse error"}},400)}
 if(!body||body.jsonrpc!=="2.0"||typeof body.method!=="string")return jrpc(body?.id??null,{error:{code:-32600,message:"Invalid JSON-RPC request"}},400);
 const {id,method,params={}}=body;
 if(id===undefined||id===null)return new Response(null,{status:202});
 const newEra=request.headers.get("MCP-Protocol-Version")==="2026-07-28";
 const info={"io.modelcontextprotocol/serverInfo":{name:"draw-querencia-shared",version:"0.1.0"}};
 const full=part=>newEra?{resultType:"complete",_meta:info,...part}:part;
 if(newEra){
  if(method!==request.headers.get("Mcp-Method")||(method==="tools/call"&&String(params.name||"")!==request.headers.get("Mcp-Name")))return jrpc(id,{error:{code:-32020,message:"HeaderMismatch"}},400);
  if(params?._meta?.["io.modelcontextprotocol/protocolVersion"]!=="2026-07-28")return jrpc(id,{error:{code:-32020,message:"HeaderMismatch protocol version"}},400);
 }
 try{
  if(method==="server/discover")return jrpc(id,{result:{resultType:"complete",supportedProtocolVersions:["2026-07-28","2025-11-25"],serverInfo:info["io.modelcontextprotocol/serverInfo"],capabilities:{tools:{}},_meta:info}});
  if(method==="initialize")return jrpc(id,{result:{protocolVersion:params.protocolVersion||"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"draw-querencia-shared",version:"0.1.0"}}});
  if(method==="ping")return jrpc(id,{result:{}});
  if(method==="tools/list")return jrpc(id,{result:full({tools:TOOLS})});
  if(method==="tools/call"){
   const tool=TOOLS.find(t=>t.name===params.name);
   if(!tool)return jrpc(id,{error:{code:-32602,message:"Unknown tool"}},404);
   const output=await action(params.name,params.arguments||{},env);
   return jrpc(id,{result:full({content:[{type:"text",text:JSON.stringify(output)}],structuredContent:output})});
  }
  return jrpc(id,{error:{code:-32601,message:"Method not found"}},404);
 }catch(e){
  return jrpc(id,{result:full({isError:true,content:[{type:"text",text:String(e?.message||e)}]})});
 }
}

export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(url.pathname==='/health')return Response.json({ok:true,service:'draw-collaboration',mode:'durable-objects'});
  if(url.pathname==='/mcp')return handleMcp(request,env);
  const match=url.pathname.match(/^\/room\/([a-f0-9]{32})$/);
  if(!match)return new Response('Not found',{status:404});
  if(origin&&!allowed.has(origin))return new Response('Origin not allowed',{status:403});
  if(request.headers.get('Upgrade')!=='websocket')return new Response('Upgrade required',{status:426});
  return env.ROOMS.getByName(match[1]).fetch(request);
 }
};
