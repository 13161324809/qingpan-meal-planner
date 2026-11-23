const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {Store}=require("../local-file.js");
const validate=data=>{if(data?.version!==1)throw Error("bad schema");};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"qingpan-json-test-")),file=path.join(directory,"data.json");
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(file,"");
  const handle={name:"data.json",getFile:async()=>({text:()=>fs.readFile(file,"utf8")}),createWritable:async()=>{
    let pending;return{write:async text=>{pending=text;},close:async()=>fs.writeFile(file,pending),abort:async()=>{}};
  }};
  return {file,handle};
}
test("实际JSON文件写入、排队更新和重新打开，不依赖浏览器缓存",async t=>{
  const {file,handle}=await fixture(t),store=new Store(handle,validate);
  await store.create({version:1,weight:138,notes:"中文"});
  await Promise.all([store.save({version:1,weight:137}),store.save({version:1,weight:136})]);
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).weight,136);
  assert.equal((await new Store(handle,validate).load()).weight,136);
});
test("文件被外部修改时停止覆盖，已有文件禁止通过新建流程覆盖",async t=>{
  const {file,handle}=await fixture(t),store=new Store(handle,validate);
  await store.create({version:1,weight:138});
  await fs.writeFile(file,JSON.stringify({version:1,weight:130}));
  await assert.rejects(store.save({version:1,weight:137}),/其他窗口/);
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).weight,130);
  await assert.rejects(new Store(handle,validate).create({version:1}),/已有内容/);
});
test("写入失败保留原文件，权限恢复后可重试；坏JSON和坏数据不写入",async t=>{
  const {file,handle}=await fixture(t),store=new Store(handle,validate);
  await store.create({version:1,weight:138});
  const writer=handle.createWritable;handle.createWritable=async()=>{throw Error("permission denied");};
  await assert.rejects(store.save({version:1,weight:137}),/permission/);
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).weight,138);
  handle.createWritable=writer;await store.save({version:1,weight:137});
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).weight,137);
  assert.throws(()=>store.save({version:2}),/schema/);
  await fs.writeFile(file,"not json");
  await assert.rejects(new Store(handle,validate).load(),/有效JSON/);
});
