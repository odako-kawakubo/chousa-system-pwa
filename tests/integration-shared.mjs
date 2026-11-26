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
