const encoder=new TextEncoder();
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
function equal(a,b){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
function reply(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',...extra}})}
function sessionCookie(token,age=1800){return `__Host-vault=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`}
function cookie(req){return(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-vault='))?.slice(13)||''}
async function body(req){if(!req.headers.get('Content-Type')?.startsWith('application/json'))throw Error('json');if(Number(req.headers.get('Content-Length'))>200000)throw Error('large');let stream=req.body?.getReader(),parts=[],size=0;if(!stream)throw Error('json');while(true){let {done,value}=await stream.read();if(done)break;size+=value.length;if(size>200000){await stream.cancel();throw Error('large')}parts.push(value)}let bytes=new Uint8Array(size),off=0;for(let p of parts){bytes.set(p,off);off+=p.length}return JSON.parse(new TextDecoder().decode(bytes))}
function validVault(v){if(!v||v.version!==1)return false;for(let[k,n]of[['salt',24],['iv',16]]){if(typeof v[k]!=='string'||v[k].length!==n||!/^[A-Za-z0-9+/]+=*$/.test(v[k]))return false}return typeof v.data==='string'&&v.data.length>=24&&v.data.length<=180000&&/^[A-Za-z0-9+/]+=*$/.test(v.data)}
export async function onRequest({request:req,env}){try{
 if(!env.DB||typeof env.SITE_PASSWORD!=='string'||env.SITE_PASSWORD.length<12)return reply({error:'网站尚未配置完成：请绑定 DB，并设置至少 12 个字符的 SITE_PASSWORD。'},503);
 const url=new URL(req.url),path=url.pathname.replace(/\/$/,''),now=Math.floor(Date.now()/1000);
 if(!['GET','POST','PUT'].includes(req.method))return reply({error:'不支持此请求'},405);
 if(req.method!=='GET'&&req.headers.get('Origin')!==url.origin)return reply({error:'来源校验失败'},403);
 const authTag=await hash(env.SITE_PASSWORD);
 if(path==='/api/login'&&req.method==='POST'){
  let ip=req.headers.get('CF-Connecting-IP')||'local',ipKey=await hash(ip);
  let attempt=await env.DB.prepare('INSERT INTO attempts (id, count, expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires <= ? THEN 1 ELSE count+1 END, expires=CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count,expires').bind(ipKey,now+900,now,now).first();
  if(attempt.count>10)return reply({error:'尝试次数过多，请稍后再试。'},429,{'Retry-After':String(Math.max(1,attempt.expires-now))});
  let input;try{input=await body(req)}catch{return reply({error:'请求格式错误'},400)}
  if(typeof input.password!=='string'||input.password.length>1024||!equal(await hash(input.password),authTag))return reply({error:'密码不正确'},401);
  let token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.batch([env.DB.prepare('DELETE FROM attempts WHERE id=? OR expires<=?').bind(ipKey,now),env.DB.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),env.DB.prepare('INSERT INTO sessions (id,expires) VALUES (?,?)').bind(await hash(token+authTag),now+1800)]);
  return reply({ok:true},200,{'Set-Cookie':sessionCookie(token)});
 }
 const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'请先输入密码'},401);
 const tokenHash=await hash(token+authTag),session=await env.DB.prepare('SELECT expires FROM sessions WHERE id=?').bind(tokenHash).first();
 if(!session||session.expires<=now)return reply({error:'登录已过期，请重新输入密码'},401);
 if(path==='/api/logout'&&req.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(tokenHash).run();return reply({ok:true},200,{'Set-Cookie':sessionCookie('',0)})}
 if(path==='/api/vault'&&req.method==='GET'){let row=await env.DB.prepare('SELECT revision,payload FROM vault WHERE id=1').first();return reply({revision:row.revision,vault:row.payload?JSON.parse(row.payload):null})}
 if(path==='/api/vault'&&req.method==='PUT'){
  let data;try{data=await body(req)}catch{return reply({error:'数据格式错误或内容过大'},400)}
  if(!Number.isSafeInteger(data.revision)||data.revision<0||!validVault(data.vault))return reply({error:'保险箱数据格式错误'},400);
  let changed=await env.DB.prepare('UPDATE vault SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING revision').bind(JSON.stringify(data.vault),now,data.revision).first();
  if(!changed)return reply({error:'另一台设备已更新数据，请刷新后重试。'},409);
  return reply({revision:changed.revision});
 }
 return reply({error:'找不到接口'},404);
 }catch{return reply({error:'服务暂时不可用，请检查数据库绑定和初始化是否完成。'},500)}
}
