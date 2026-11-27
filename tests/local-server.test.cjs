const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../server.cjs'),C=require('../core.js');
test('固定JSON：持久保存、重启读取、冲突保护、旧文件备份和跨站拒绝',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qingpan-server-')),dataFile=path.join(dir,'data.json');
  let server;
  const start=async()=>{server=createServer({dataFile});await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};
  try {
    let base=await start();
    const put=(data,version,origin=base)=>fetch(base+'/api/local-data',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({data,version})});
    assert.equal((await fetch(base+'/api/local-data')).status,404);
    let data=C.initialState();data.templates=[];
    let response=await put(data,null);assert.equal(response.status,200);let saved=await response.json();
    const first=fs.readFileSync(dataFile,'utf8');data.profiles[0].name='中文目标测试';
    response=await put(data,saved.version);assert.equal(response.status,200);
    assert.equal(fs.readFileSync(path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0]),'utf8'),first);
    assert.equal((await put(data,saved.version)).status,409);
    assert.equal((await put(data,null,'https://evil.example')).status,403);
    const before=fs.readFileSync(dataFile,'utf8');
    assert.equal((await put({},null)).status,500);assert.equal(fs.readFileSync(dataFile,'utf8'),before);
    assert.equal((await fetch(base+'/personal-data/data.json')).status,404);
    assert.match(await(await fetch(base)).text(),/QingpanLocalServer = true/);
    await new Promise(r=>server.close(r));base=await start();
    const reopened=await(await fetch(base+'/api/local-data')).json();
    assert.equal(reopened.data.profiles[0].name,'中文目标测试');
    assert.equal(fs.readFileSync(dataFile,'utf8'),before);
  } finally {if(server?.listening)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
