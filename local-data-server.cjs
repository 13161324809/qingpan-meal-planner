const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('./core.js');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function localDataHandler(dataFile) {
  dataFile = path.resolve(dataFile);
  let queue = Promise.resolve();
  const reply = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); };
  return async (req,res) => {
    const origins = [`http://127.0.0.1:${req.socket.localPort}`,`http://localhost:${req.socket.localPort}`];
    if (!origins.includes(`http://${req.headers.host}`) || (req.headers.origin && !origins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') return reply(res,403,{error:'仅允许本机网页访问'});
    try {
      if (req.method === 'GET') {
        await queue.catch(()=>{});
        if (!fs.existsSync(dataFile)) return reply(res,404,{error:'固定数据文件尚未创建',path:dataFile});
        const text = fs.readFileSync(dataFile,'utf8'), data = C.validateState(JSON.parse(text.replace(/^\uFEFF/,'')));
        return reply(res,200,{data,version:hash(text),path:dataFile});
      }
      if (req.method !== 'PUT') return reply(res,405,{error:'不支持的方法'});
      if (!origins.includes(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return reply(res,403,{error:'仅允许本机网页以JSON保存'});
      const chunks=[];let size=0;
      for await (const chunk of req) {size+=chunk.length;if(size>20*1024*1024)return reply(res,413,{error:'数据超过20MB'});chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));C.validateState(input.data);
      const task=queue.catch(()=>{}).then(()=>{
        const existing=fs.existsSync(dataFile)?fs.readFileSync(dataFile,'utf8'):null;
        if(input.version!==(existing===null?null:hash(existing))) {const e=Error('文件已被其他页面更新，请先导出本页备份，再刷新读取最新文件');e.status=409;throw e;}
        const text=JSON.stringify(input.data,null,2);
        if(text!==existing) {
          fs.mkdirSync(path.dirname(dataFile),{recursive:true});
          if(existing!==null) {const dir=path.join(path.dirname(dataFile),'backups');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`data-${Date.now()}-${crypto.randomUUID()}.json`),existing);}
          const temp=dataFile+'.'+crypto.randomUUID()+'.tmp';
          try {fs.writeFileSync(temp,text,{flag:'wx'});fs.renameSync(temp,dataFile);} finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
        }
        return {version:hash(text),path:dataFile};
      });
      queue=task;return reply(res,200,await task);
    } catch(e) {return reply(res,e.status||500,{error:e.message});}
  };
}
module.exports={localDataHandler};
