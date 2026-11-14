/**
 * NIGHTFLIX GitHub bridge — deploy as a Cloudflare Worker.
 * Configure secrets: ADMIN_PASSWORD, GITHUB_TOKEN.
 * Configure vars: GITHUB_OWNER=gith3620-commits, GITHUB_REPO=update-night-flix,
 * GITHUB_BRANCH=main, ALLOWED_ORIGIN=https://YOUR-GITHUB-PAGES-DOMAIN
 */
const GH="https://api.github.com";
const headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"NIGHTFLIX-admin"};
const cors=(origin,env)=>({
 "Access-Control-Allow-Origin":env.ALLOWED_ORIGIN||origin||"*",
 "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type,Authorization",
 "Vary":"Origin"
});
function response(data,status,origin,env){return new Response(JSON.stringify(data),{status,headers:{...cors(origin,env),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});}
async function ghFetch(path,env,options={}){
 const r=await fetch(GH+path,{...options,headers:{...headers,"Authorization":"Bearer "+env.GITHUB_TOKEN,...options.headers}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.message||"GitHub API error "+r.status);
 return d;
}
async function readFile(path,env){
 try{
  const d=await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,env);
  const binary=atob(d.content.replace(/\\n/g,""));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return {sha:d.sha,content:JSON.parse(new TextDecoder().decode(bytes))};
 }catch(e){if(String(e.message).includes("Not Found"))return {sha:null,content:[]};throw e;}
}
async function writeFile(path,content,sha,env,message){
 const body={message,branch:env.GITHUB_BRANCH||"main",content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)+"\n")))};
 if(sha)body.sha=sha;
 return ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,env,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}
export default {
 async fetch(request,env){
  const origin=request.headers.get("Origin")||"";
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin,env)});
  const url=new URL(request.url);
  try{
   if(!env.ADMIN_PASSWORD||!env.GITHUB_TOKEN||!env.GITHUB_OWNER||!env.GITHUB_REPO)return response({error:"Worker is not configured yet."},503,origin,env);
   if(url.pathname==="/api/catalog"&&request.method==="GET"){
    if(request.headers.get("Authorization")!=="Bearer "+env.ADMIN_PASSWORD)return response({error:"Unauthorized"},401,origin,env);
    const [m,s]=await Promise.all([readFile("movies.json",env),readFile("shorts.json",env)]);
    return response({movies:m.content,shorts:s.content},200,origin,env);
   }
   if(url.pathname==="/api/movies"&&request.method==="POST"){
    if(request.headers.get("Authorization")!=="Bearer "+env.ADMIN_PASSWORD)return response({error:"Unauthorized"},401,origin,env);
    const input=await request.json();
    if(!input.title||!validUrl(input.poster)||!validUrl(input.watch))return response({error:"Enter a title and valid poster/video URLs."},400,origin,env);
    const file=await readFile("movies.json",env),items=Array.isArray(file.content)?file.content:[];
    const id=Math.max(0,...items.map(x=>Number(x.id)||0))+1;
    items.unshift({id,title:String(input.title).slice(0,160),year:new Date().getFullYear(),genre:"",poster:input.poster,description:"",contentType:"",watch:input.watch,download:"",photos:[],addedAt:new Date().toISOString(),universe:""});
    const commit=await writeFile("movies.json",items,file.sha,env,`Admin: add movie ${input.title}`);
    return response({ok:true,id,commit:commit.commit?.sha},200,origin,env);
   }
   if(url.pathname==="/api/shorts"&&request.method==="POST"){
    if(request.headers.get("Authorization")!=="Bearer "+env.ADMIN_PASSWORD)return response({error:"Unauthorized"},401,origin,env);
    const input=await request.json();
    if(!input.title||!validUrl(input.video))return response({error:"Enter a title and valid MP4 URL."},400,origin,env);
    const file=await readFile("shorts.json",env),items=Array.isArray(file.content)?file.content:[];
    const related=input.movieId||null;
    items.push({movieId:related,title:String(input.title).slice(0,160),video:input.video,caption:String(input.caption||"").slice(0,500),poster:input.poster||""});
    const commit=await writeFile("shorts.json",items,file.sha,env,`Admin: add short ${input.title}`);
    return response({ok:true,commit:commit.commit?.sha},200,origin,env);
   }
   if((url.pathname==="/api/movies"||url.pathname==="/api/shorts")&&(request.method==="PATCH"||request.method==="DELETE")){
    if(request.headers.get("Authorization")!=="Bearer "+env.ADMIN_PASSWORD)return response({error:"Unauthorized"},401,origin,env);
    const kind=url.pathname.endsWith("movies")?"movies":"shorts";
    const file=await readFile(kind==="movies"?"movies.json":"shorts.json",env);
    const items=Array.isArray(file.content)?file.content:[];
    const input=await request.json().catch(()=>({}));
    const key=kind==="movies"?Number(input.id):Number(input.index);
    const at=kind==="movies"?items.findIndex(x=>Number(x.id)===key):key;
    if(!Number.isInteger(at)||at<0||at>=items.length)return response({error:"Entry not found"},404,origin,env);
    if(request.method==="DELETE"){items.splice(at,1);}
    else{
      const old=items[at];
      if(kind==="movies"){
       const title=String(input.title||old.title||"").trim();
       if(!title||!validUrl(input.poster)||!validUrl(input.watch))return response({error:"Title, valid poster URL and MP4 URL are required."},400,origin,env);
       items[at]={...old,title,poster:input.poster,watch:input.watch};
      }else{
       const title=String(input.title||old.title||"").trim();
       if(!title||!validUrl(input.video))return response({error:"Title and valid MP4 URL are required."},400,origin,env);
       items[at]={...old,title,video:input.video,poster:input.poster||"",caption:input.caption||"",movieId:input.movieId||old.movieId||null};
      }
    }
    const commit=await writeFile(kind==="movies"?"movies.json":"shorts.json",items,file.sha,env,`Admin: ${request.method.toLowerCase()} ${kind} entry`);
    return response({ok:true,commit:commit.commit?.sha},200,origin,env);
   }
   return response({error:"Not found"},404,origin,env);
  }catch(e){return response({error:e.message||"Server error"},500,origin,env);}
 }
};
function validUrl(value){try{const u=new URL(value);return u.protocol==="https:";}catch{return false;}}
