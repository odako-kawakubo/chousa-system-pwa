/** Stable integration contract: main compatibility + configured OneDrive + version consistency. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const modalSource=read('../src/js/ui/modal.js');
const rootSource=read('../src/js/onedrive/onedrive-root.js');
const configSource=read('../src/config/microsoft-config.js');
const mainWorkflow=read('../.github/workflows/firebase-hosting-deploy.yml');
const appConfig=read('../src/config/app-config.js');
const version=JSON.parse(read('../src/version.json'));
const worker=read('../src/service-worker.js');

const fakeBody={style:{position:'relative',top:'5px',width:'90%',overflow:'auto'}};
const fakeRoot={style:{overflow:'scroll'}};
const elements=new Map();
for(const name of ['sharedProjectModal','photoPreviewModal','newProjectModal']){
  const values=new Set();
  elements.set(name,{classList:{
    add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)
  }});
}
const fakeDocument={
  body:fakeBody,documentElement:fakeRoot,
  getElementById:id=>elements.get(id)||null
};
const calls=[];
const fakeWindow={scrollY:247,scrollTo:(x,y)=>calls.push([x,y])};
const modal=new Function('document','window',modalSource.replace(/^export /gm,'')+';return {openModal,closeModal};')(fakeDocument,fakeWindow);
modal.openModal('sharedProjectModal');
assert.equal(fakeBody.style.position,'fixed');
assert.equal(fakeBody.style.top,'-247px');
assert.equal(fakeRoot.style.overflow,'hidden');
assert.equal(elements.get('sharedProjectModal').classList.contains('open'),true);
modal.openModal('sharedProjectModal');
modal.closeModal('sharedProjectModal');
assert.deepEqual(calls,[[0,247]]);
assert.equal(fakeBody.style.position,'relative');
assert.equal(fakeBody.style.top,'5px');
assert.equal(fakeBody.style.width,'90%');
assert.equal(fakeBody.style.overflow,'auto');
assert.equal(fakeRoot.style.overflow,'scroll');
assert.equal(elements.get('sharedProjectModal').classList.contains('open'),false);
modal.openModal('photoPreviewModal');
assert.equal(fakeBody.style.position,'relative');
modal.closeModal('photoPreviewModal');
modal.openModal('newProjectModal');
assert.equal(fakeBody.style.position,'relative');
modal.closeModal('newProjectModal');

const config=new Function(configSource.replace(/^export /gm,'')+';return microsoftConfig;')();
assert.ok(config.surveyRootDriveId);
assert.ok(config.surveyRootItemId);
assert.equal('surveyRootUrl' in config,false);
const root=new Function('microsoftConfig',rootSource.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'')+';return {getSurveyRoot,clearSurveyRoot,getCachedSurveyRoot};')(config);
const first=await root.getSurveyRoot();
assert.deepEqual({driveId:first.driveId,itemId:first.itemId,rootSource:first.rootSource},
  {driveId:config.surveyRootDriveId,itemId:config.surveyRootItemId,rootSource:'configured-id'});
first.name='tampered';
assert.notEqual((await root.getSurveyRoot()).name,'tampered');
root.clearSurveyRoot();
assert.equal(root.getCachedSurveyRoot(),null);
assert.ok(!/resolveSharedUrl|searchDriveFolders/.test(rootSource));

assert.ok(mainWorkflow.includes("branches:\n      - main"));
assert.ok(mainWorkflow.includes("surveyRootDriveId"));
assert.ok(mainWorkflow.includes("surveyRootItemId"));
assert.ok(mainWorkflow.includes("getDriveItem(candidate)"));
assert.ok(mainWorkflow.includes("listDriveChildren(verified)"));
assert.ok(mainWorkflow.includes("deploy --only hosting --project odako-chousa-system-pwa"));
assert.match(version.version,/^0(?:\.\d+){2,4}[A-Z]?$/);
assert.ok(appConfig.includes("version: '" + version.version + "'"));
assert.ok(worker.includes('chousa-app-v' + version.version));
console.log('Shared integration: modal, OneDrive root and version consistency PASS');

// Actual queue module regression tests, with injected storage failures.
{
  let raw = null, failRead = false, failWrite = false;
  const storage = {
    getItem() { if (failRead) throw Error('read'); return raw; },
    setItem(_key, value) { if (failWrite) throw Error('quota'); raw = value; }
  };
  const source = read('../src/js/sync/unsent-queue.js');
  const q = new Function('localStorage', source.replace(/^export /gm, '') +
    ';return {putUnsent,listUnsent,removeUnsentIfMatching,acknowledgeUnsentEntries,replaceUnsentIfMatching,clearUnsentForProject};')(storage);
  const base = {projectId:'P',recordType:'material',recordId:'M'};
  assert.equal(q.listUnsent().length,0);
  const a = q.putUnsent({...base,record:{sampleCount:1}});
  const b = q.putUnsent({...base,record:{sampleCount:3}});
  assert.equal(q.listUnsent().length,1);
  assert.equal(q.removeUnsentIfMatching(a),false);
  assert.equal(q.listUnsent()[0].record.sampleCount,3);
  failWrite = true;
  assert.throws(()=>q.putUnsent({...base,record:{sampleCount:4}}),{name:'UnsentStorageError'});
  assert.throws(()=>q.removeUnsentIfMatching(b),{name:'UnsentStorageError'});
  assert.throws(()=>q.clearUnsentForProject('P'),{name:'UnsentStorageError'});
  assert.equal(q.listUnsent()[0].record.sampleCount,3);
  failWrite = false;
  assert.equal(q.removeUnsentIfMatching(b),true);
  const deleted=q.putUnsent({...base,operation:'delete'});
  const recreated=q.putUnsent({...base,record:{sampleCount:5}});
  assert.equal(q.removeUnsentIfMatching(deleted),false);
  assert.equal(q.removeUnsentIfMatching(recreated),true);
  const project={projectId:'P',recordType:'project',recordId:'P'};
  const initial=q.putUnsent({...project,record:{createdAt:'t',boardSettings:{a:1}},meta:{initializeChangeLog:true}});
  const changed=q.putUnsent({...project,record:{boardSettings:{b:2}},meta:{partialProjectMetadata:true}});
  assert.deepEqual(changed.record.boardSettings,{a:1,b:2});
  assert.equal(q.replaceUnsentIfMatching(initial,null),false);
  failWrite=true;
  assert.throws(()=>q.replaceUnsentIfMatching(changed,{record:changed.meta.subsequentPatch,meta:{partialProjectMetadata:true}}));
  assert.deepEqual(q.listUnsent()[0],changed);
  failWrite=false;
  assert.equal(q.replaceUnsentIfMatching(changed,{record:changed.meta.subsequentPatch,meta:{partialProjectMetadata:true}}),true);
  assert.deepEqual(q.listUnsent()[0].record,{boardSettings:{b:2}});
  const saved=raw;
  failRead=true;
  assert.throws(()=>q.listUnsent(),{name:'UnsentStorageError'});
  assert.throws(()=>q.putUnsent({...base,record:{}}),{name:'UnsentStorageError'});
  assert.equal(raw,saved);
  failRead=false;
  raw='{broken';
  assert.throws(()=>q.putUnsent({...base,record:{}}),{name:'UnsentStorageError'});
  assert.equal(raw,'{broken');
  raw='{}';
  assert.throws(()=>q.listUnsent(),{name:'UnsentStorageError'});
  raw=saved;
  const item=q.listUnsent()[0];
  assert.equal(q.acknowledgeUnsentEntries([{...item,environment:'test'}]),0);
  assert.equal(q.acknowledgeUnsentEntries([item]),1);
  console.log('Unsent queue regression: persistence, acknowledgement, replacement PASS');
}
