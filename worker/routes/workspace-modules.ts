import { Hono, type Context } from 'hono';
import { decisionSchema, experimentSchema, feedbackSchema, hardwareSchema, issueSchema, wikiSchema, worklogSchema } from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { workspaceEventStatements } from '../services/events';
import type { Env, Variables } from '../types';

export const workspaceModuleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
workspaceModuleRoutes.use('*', requireAuth, requirePasswordChanged);

workspaceModuleRoutes.get('/worklogs', async (c) => {
  const userId = c.req.query('userId') ?? c.get('user').id;
  const rows = await c.env.DB.prepare(`SELECT w.*,u.display_name AS userName FROM worklogs w JOIN users u ON u.id=w.user_id
    WHERE w.user_id=? AND w.archived_at IS NULL ORDER BY w.created_at DESC LIMIT 100`).bind(userId).all();
  return c.json({ ok:true,data:rows.results });
});
workspaceModuleRoutes.post('/worklogs', async (c) => {
  const parsed=worklogSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return validation(c,'Worklog details are invalid',parsed.error.flatten().fieldErrors);
  const d=parsed.data,id=crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO worklogs (id,user_id,completed_work,current_work,problems,tests_performed,evidence,next_steps) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id,c.get('user').id,d.completedWork,d.currentWork,d.problems,d.testsPerformed,d.evidence,d.nextSteps).run();
  return c.json({ok:true,data:{id}},201);
});

workspaceModuleRoutes.get('/wiki', async (c) => {
  const search=c.req.query('search')?.trim(), category=c.req.query('category');
  const conditions=['p.archived_at IS NULL'],bind:unknown[]=[];
  if(search){conditions.push('(p.title LIKE ? OR v.content_markdown LIKE ?)');bind.push(`%${search}%`,`%${search}%`);}
  if(category){conditions.push('p.category=?');bind.push(category);}
  const rows=await c.env.DB.prepare(`SELECT p.id,p.title,p.slug,p.category,p.visibility,p.current_version AS currentVersion,p.updated_at AS updatedAt,
    u.display_name AS authorName,substr(v.content_markdown,1,240) AS excerpt FROM wiki_pages p
    JOIN wiki_versions v ON v.page_id=p.id AND v.version=p.current_version JOIN users u ON u.id=v.author_id
    WHERE ${conditions.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 100`).bind(...bind).all();
  return c.json({ok:true,data:rows.results});
});
workspaceModuleRoutes.get('/wiki/:slug', async (c) => {
  const page=await c.env.DB.prepare(`SELECT p.*,v.content_markdown AS contentMarkdown,v.change_summary AS changeSummary,u.display_name AS authorName
    FROM wiki_pages p JOIN wiki_versions v ON v.page_id=p.id AND v.version=p.current_version JOIN users u ON u.id=v.author_id
    WHERE p.slug=? AND p.archived_at IS NULL`).bind(c.req.param('slug')).first();
  if(!page)return notFound(c,'Wiki page');
  const versions=await c.env.DB.prepare(`SELECT v.version,v.change_summary AS changeSummary,v.created_at AS createdAt,u.display_name AS authorName
    FROM wiki_versions v JOIN users u ON u.id=v.author_id WHERE v.page_id=? ORDER BY v.version DESC`).bind((page as {id:string}).id).all();
  return c.json({ok:true,data:{page,versions:versions.results}});
});
workspaceModuleRoutes.post('/wiki', async (c) => {
  if(c.get('user').roles.includes('project_supervisor'))return forbidden(c);
  const parsed=wikiSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return validation(c,'Wiki page is invalid',parsed.error.flatten().fieldErrors);
  const d=parsed.data,id=crypto.randomUUID(),versionId=crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO wiki_pages (id,parent_id,title,slug,category,visibility,created_by) VALUES (?,?,?,?,?,?,?)`).bind(id,d.parentId??null,d.title,d.slug,d.category,d.visibility,c.get('user').id),
    c.env.DB.prepare(`INSERT INTO wiki_versions (id,page_id,version,content_markdown,change_summary,author_id) VALUES (?,?,1,?,?,?)`).bind(versionId,id,d.contentMarkdown,d.changeSummary,c.get('user').id),
    audit(c.env,c.get('user').id,'wiki.created','wiki_page',id),
  ]); return c.json({ok:true,data:{id,slug:d.slug}},201);
});
workspaceModuleRoutes.post('/wiki/:id/versions', async (c) => {
  if(c.get('user').roles.includes('project_supervisor'))return forbidden(c);
  const body = await c.req.json<{ contentMarkdown?: string; changeSummary?: string }>().catch(() => ({} as { contentMarkdown?: string; changeSummary?: string }));
  if(!body.contentMarkdown)return validation(c,'Markdown content is required');
  const page=await c.env.DB.prepare(`SELECT current_version FROM wiki_pages WHERE id=? AND archived_at IS NULL`).bind(c.req.param('id')).first<{current_version:number}>();
  if(!page)return notFound(c,'Wiki page'); const version=page.current_version+1;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO wiki_versions (id,page_id,version,content_markdown,change_summary,author_id) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(),c.req.param('id'),version,body.contentMarkdown,body.changeSummary??'',c.get('user').id),
    c.env.DB.prepare(`UPDATE wiki_pages SET current_version=?,updated_at=unixepoch() WHERE id=?`).bind(version,c.req.param('id')),
  ]); return c.json({ok:true,data:{version}},201);
});

workspaceModuleRoutes.get('/decisions', async(c)=>{const r=await c.env.DB.prepare(`SELECT d.*,u.display_name AS ownerName FROM decisions d JOIN users u ON u.id=d.owner_id WHERE d.archived_at IS NULL ORDER BY d.created_at DESC`).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/decisions', requirePermission('task.manage'), async(c)=>{const p=decisionSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Decision is invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO decisions (id,project_id,owner_id,title,status,reasoning,alternatives,expected_impact,supersedes_id) VALUES (?,'project_cerberus',?,?,?,?,?,?,?)`).bind(id,c.get('user').id,d.title,d.status,d.reasoning,d.alternatives,d.expectedImpact,d.supersedesId??null).run();return c.json({ok:true,data:{id}},201);});

workspaceModuleRoutes.get('/hardware', async(c)=>{const r=await c.env.DB.prepare(`SELECT h.*,(SELECT u.display_name FROM hardware_assignments a JOIN users u ON u.id=a.holder_id WHERE a.hardware_id=h.id AND a.checked_in_at IS NULL ORDER BY a.checked_out_at DESC LIMIT 1) AS currentHolder FROM hardware_items h WHERE h.archived_at IS NULL ORDER BY h.name`).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/hardware', requirePermission('workspace.admin'), async(c)=>{const p=hardwareSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Hardware details are invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO hardware_items (id,name,model,serial_number,quantity,unit_cost,condition,purchase_status,datasheet_url,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,d.name,d.model,d.serialNumber,d.quantity,d.unitCost??null,d.condition,d.purchaseStatus,d.datasheetUrl,d.notes).run();return c.json({ok:true,data:{id}},201);});
workspaceModuleRoutes.post('/hardware/:id/checkout', requirePermission('workspace.admin'), async(c)=>{const b: {holderId?:string;quantity?:number;notes?:string}=await c.req.json().catch(()=>({}));if(!b.holderId||!b.quantity||b.quantity<1)return validation(c,'Holder and quantity are required');const active=await c.env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) AS used FROM hardware_assignments WHERE hardware_id=? AND checked_in_at IS NULL`).bind(c.req.param('id')).first<{used:number}>();const item=await c.env.DB.prepare(`SELECT quantity FROM hardware_items WHERE id=?`).bind(c.req.param('id')).first<{quantity:number}>();if(!item)return notFound(c,'Hardware item');if(Number(active?.used??0)+b.quantity>item.quantity)return c.json({ok:false,error:{code:'QUANTITY_UNAVAILABLE',message:'Not enough units are available'}},409);const id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO hardware_assignments (id,hardware_id,holder_id,quantity,notes,created_by) VALUES (?,?,?,?,?,?)`).bind(id,c.req.param('id'),b.holderId,b.quantity,b.notes??'',c.get('user').id).run();return c.json({ok:true,data:{id}},201);});
workspaceModuleRoutes.post('/hardware/assignments/:id/return', requirePermission('workspace.admin'), async(c)=>{await c.env.DB.prepare(`UPDATE hardware_assignments SET checked_in_at=unixepoch() WHERE id=? AND checked_in_at IS NULL`).bind(c.req.param('id')).run();return c.json({ok:true,data:null});});

workspaceModuleRoutes.get('/experiments', async(c)=>{const r=await c.env.DB.prepare(`SELECT e.*,u.display_name AS ownerName,(SELECT COUNT(*) FROM experiment_runs x WHERE x.experiment_id=e.id) AS runCount FROM experiments e JOIN users u ON u.id=e.owner_id WHERE e.archived_at IS NULL ORDER BY e.updated_at DESC`).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/experiments', async(c)=>{if(c.get('user').roles.includes('project_supervisor'))return forbidden(c);const p=experimentSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Experiment details are invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO experiments (id,project_id,owner_id,experiment_code,title,objective,hypothesis,environment,procedure,expected_results,reproducibility) VALUES (?,'project_cerberus',?,?,?,?,?,?,?,?,?)`).bind(id,c.get('user').id,d.experimentCode,d.title,d.objective,d.hypothesis,d.environment,d.procedure,d.expectedResults,d.reproducibility).run();return c.json({ok:true,data:{id}},201);});
workspaceModuleRoutes.post('/experiments/:id/runs', async(c)=>{const b: {inputParameters?:unknown;actualResults?:string;validationNotes?:string;metrics?:Array<{name:string;value?:number;text?:string;unit?:string;observed?:boolean}>}=await c.req.json().catch(()=>({}));if(!b.actualResults)return validation(c,'Actual results are required');const exp=await c.env.DB.prepare(`SELECT owner_id FROM experiments WHERE id=?`).bind(c.req.param('id')).first<{owner_id:string}>();if(!exp)return notFound(c,'Experiment');if(exp.owner_id!==c.get('user').id&&!c.get('user').roles.includes('super_admin'))return forbidden(c);const n=await c.env.DB.prepare(`SELECT COALESCE(MAX(run_number),0)+1 AS n FROM experiment_runs WHERE experiment_id=?`).bind(c.req.param('id')).first<{n:number}>(),id=crypto.randomUUID();const stmts=[c.env.DB.prepare(`INSERT INTO experiment_runs (id,experiment_id,run_number,input_parameters,actual_results,validation_notes,performed_by) VALUES (?,?,?,?,?,?,?)`).bind(id,c.req.param('id'),n?.n??1,JSON.stringify(b.inputParameters??{}),b.actualResults,b.validationNotes??'',c.get('user').id)];for(const m of b.metrics??[])stmts.push(c.env.DB.prepare(`INSERT INTO experiment_results (id,run_id,metric_name,value,text_value,unit,observed) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,m.name,m.value??null,m.text??null,m.unit??null,m.observed===false?0:1));await c.env.DB.batch(stmts);return c.json({ok:true,data:{id,runNumber:n?.n??1}},201);});

for(const resource of ['bugs','blockers'] as const){
  workspaceModuleRoutes.get(`/${resource}`,async(c)=>{const rows=await c.env.DB.prepare(`SELECT x.*,reporter.display_name AS reporterName,assignee.display_name AS assigneeName FROM ${resource} x JOIN users reporter ON reporter.id=x.reporter_id LEFT JOIN users assignee ON assignee.id=x.assignee_id WHERE ${resource==='bugs'?'x.archived_at IS NULL':'1=1'} ORDER BY CASE x.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,x.created_at DESC`).all();return c.json({ok:true,data:rows.results});});
  workspaceModuleRoutes.post(`/${resource}`,async(c)=>{const p=issueSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Issue details are invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();if(resource==='bugs')await c.env.DB.prepare(`INSERT INTO bugs (id,project_id,reporter_id,assignee_id,title,description,reproduction_steps,severity) VALUES (?,'project_cerberus',?,?,?,?,?,?)`).bind(id,c.get('user').id,d.assigneeId??null,d.title,d.description,d.reproductionSteps,d.severity).run();else await c.env.DB.prepare(`INSERT INTO blockers (id,project_id,reporter_id,assignee_id,task_id,title,description,severity) VALUES (?,'project_cerberus',?,?,?,?,?,?)`).bind(id,c.get('user').id,d.assigneeId??null,d.taskId??null,d.title,d.description,d.severity).run();return c.json({ok:true,data:{id}},201);});
  workspaceModuleRoutes.patch(`/${resource}/:id/resolve`,async(c)=>{const b: {resolutionNotes?:string}=await c.req.json().catch(()=>({}));if(!b.resolutionNotes)return validation(c,'Resolution notes are required');const user=c.get('user');const row=await c.env.DB.prepare(`SELECT assignee_id FROM ${resource} WHERE id=?`).bind(c.req.param('id')).first<{assignee_id:string|null}>();if(!row)return notFound(c,resource==='bugs'?'Bug':'Blocker');if(row.assignee_id!==user.id&&!user.roles.includes('super_admin'))return forbidden(c);await c.env.DB.prepare(`UPDATE ${resource} SET status='resolved',resolution_notes=?,updated_at=unixepoch()${resource==='blockers'?',resolved_at=unixepoch()':''} WHERE id=?`).bind(b.resolutionNotes,c.req.param('id')).run();return c.json({ok:true,data:null});});
}

workspaceModuleRoutes.get('/supervisor/feedback/:memberId',requireRole('project_supervisor','super_admin'),async(c)=>{const r=await c.env.DB.prepare(`SELECT f.*,u.display_name AS supervisorName FROM supervisor_feedback f JOIN users u ON u.id=f.supervisor_id WHERE f.member_id=? ORDER BY f.created_at DESC`).bind(c.req.param('memberId')).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/supervisor/feedback/:memberId',requireRole('project_supervisor'),async(c)=>{const p=feedbackSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Feedback is invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO supervisor_feedback (id,supervisor_id,member_id,resource_type,resource_id,body) VALUES (?,?,?,?,?,?)`).bind(id,c.get('user').id,c.req.param('memberId'),d.resourceType??null,d.resourceId??null,d.body),c.env.DB.prepare(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id) VALUES (?,?,'supervisor.feedback','Supervisor feedback',?,'supervisor_feedback',?)`).bind(crypto.randomUUID(),c.req.param('memberId'),d.body,id),...workspaceEventStatements(c.env,{type:'supervisor.feedback',userIds:[c.req.param('memberId')],payload:{feedbackId:id,body:d.body}})]);return c.json({ok:true,data:{id}},201);});

function validation(c: Context, message: string, fields?: unknown) { return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message, fields } }, 422); }
function notFound(c: Context, name: string) { return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `${name} not found` } }, 404); }
function forbidden(c: Context) { return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'This role cannot perform that action' } }, 403); }
