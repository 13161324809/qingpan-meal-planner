const test = require("node:test"), assert = require("node:assert/strict");
const {Store,encode,decode,config} = require("../github-sync.js");
const settings = {owner:"example",repo:"private-data",branch:"main",path:"personal-data.json"};
const validate = value => { if (typeof value?.text !== "string") throw Error("Invalid data"); };
function server(initial) {
  let value = initial, sha = "version-1", writes = 0;
  const fetch = async (url, options) => {
    assert.ok(url.startsWith("https://api.github.com/repos/example/private-data/contents/"));
    assert.equal(options.headers.Authorization,"Bearer test-token");
    const response = (status,data) => ({ok:status < 400,status,json:async()=>data});
    if (options.method === "GET") return value === null ? response(404,{}) : response(200,{sha,encoding:"base64",content:encode(JSON.stringify(value))});
    const body = JSON.parse(options.body);
    if (value !== null && body.sha !== sha) return response(409,{});
    value = JSON.parse(decode(body.content)); sha += "-next"; writes++;
    return response(200,{content:{sha}});
  };
  return {fetch, value:()=>value, writes:()=>writes};
}
test("中文JSON完整往返，创建后读取和保存使用文件SHA", async () => {
  const backend = server(null), store = new Store(settings,"test-token",validate,backend.fetch);
  await store.create({text:"吃鱼料汁 🍚"});
  assert.deepEqual(await store.load(),{text:"吃鱼料汁 🍚"});
  await store.save({text:"体重69kg"});
  assert.equal(backend.value().text,"体重69kg");
  assert.equal(backend.writes(),2);
});
test("两端并发修改检测冲突，不覆盖先保存的数据，首次上传不覆盖已有文件", async () => {
  const backend = server({text:"原始"});
  const a = new Store(settings,"test-token",validate,backend.fetch), b = new Store(settings,"test-token",validate,backend.fetch);
  await a.load(); await b.load();
  await a.save({text:"电脑修改"});
  await assert.rejects(b.save({text:"手机旧修改"}),error => error.status === 409);
  assert.equal(backend.value().text,"电脑修改");
  await assert.rejects(b.create({text:"覆盖"}),/已有数据文件/);
  assert.equal(backend.writes(),1);
});
test("坏JSON、权限失败、网络失败和未加载写入均不改变文件版本", async () => {
  const bad = new Store(settings,"test-token",validate,async()=>({ok:true,json:async()=>({sha:"bad",encoding:"base64",content:encode("{bad")})}));
  await assert.rejects(bad.load(),/JSON格式/); assert.equal(bad.sha,null);
  const denied = new Store(settings,"test-token",validate,async()=>({ok:false,status:403}));
  await assert.rejects(denied.load(),error => error.status === 403);
  const offline = new Store(settings,"test-token",validate,async()=>{throw Error("offline");});
  await assert.rejects(offline.load(),/offline/);
  await assert.rejects(offline.save({text:"x"}),/先加载/);
  assert.throws(()=>config({...settings,path:"../personal-data.json"}));
  assert.throws(()=>new Store(settings,"",validate));
});
test("较大JSON使用元数据指定的blob版本读取，避免读取到不匹配的分支新内容", async () => {
  const sha="a".repeat(40); let calls=0;
  const store=new Store(settings,"test-token",validate,async(url,options)=>{
    calls++;
    if(calls===1)return{ok:true,json:async()=>({sha,encoding:"none",content:"",size:1100000})};
    assert.ok(url.endsWith('/git/blobs/'+sha));
    assert.equal(options.headers.Accept,"application/vnd.github.raw+json");
    return{ok:true,text:async()=>JSON.stringify({text:"大文件"})};
  });
  assert.deepEqual(await store.load(),{text:"大文件"});
  assert.equal(store.sha,sha);
});
