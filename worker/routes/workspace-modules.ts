import { Hono, type Context } from 'hono';
import { decisionSchema, feedbackSchema, issueSchema, wikiSchema, wikiVersionSchema, worklogSchema } from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { workspaceEventStatements } from '../services/events';
import { canCreateWiki, canEditWiki, canViewWiki, isSupervisor, wikiVisibilityFilter } from '../services/wiki-access';
import { experimentRoutes } from './experiments';
import { hardwareRoutes } from './hardware';
import type { Env, Variables } from '../types';

export const workspaceModuleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
workspaceModuleRoutes.use('*', requireAuth, requirePasswordChanged);
workspaceModuleRoutes.route('/hardware', hardwareRoutes);
workspaceModuleRoutes.route('/experiments', experimentRoutes);

workspaceModuleRoutes.get('/worklogs', async (c) => {
  const user = c.get('user');
  const userId = c.req.query('userId') ?? user.id;
  if (userId !== user.id && !user.permissions.includes('workspace.admin') && !user.roles.includes('project_supervisor')) return forbidden(c);
  const rows = await c.env.DB.prepare(`SELECT w.*,u.display_name AS userName FROM worklogs w JOIN users u ON u.id=w.user_id
    WHERE w.user_id=? AND w.archived_at IS NULL ORDER BY w.created_at DESC LIMIT 100`).bind(userId).all();
  return c.json({ ok:true,data:rows.results });
});
workspaceModuleRoutes.post('/worklogs', async (c) => {
  if (isSupervisor(c.get('user'))) return forbidden(c);
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
  const visibilityFilter=wikiVisibilityFilter(c.get('user'));
  if(visibilityFilter.sql){conditions.push(visibilityFilter.sql);bind.push(...visibilityFilter.binds);}
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
  if(!canViewWiki(c.get('user'),(page as {visibility:string}).visibility))return notFound(c,'Wiki page');
  const versions=await c.env.DB.prepare(`SELECT v.version,v.change_summary AS changeSummary,v.created_at AS createdAt,u.display_name AS authorName
    FROM wiki_versions v JOIN users u ON u.id=v.author_id WHERE v.page_id=? ORDER BY v.version DESC`).bind((page as {id:string}).id).all();
  return c.json({ok:true,data:{page,versions:versions.results}});
});
workspaceModuleRoutes.post('/wiki', async (c) => {
  const parsed=wikiSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return validation(c,'Wiki page is invalid',parsed.error.flatten().fieldErrors);
  const d=parsed.data,id=crypto.randomUUID(),versionId=crypto.randomUUID();
  if(!canCreateWiki(c.get('user'),d.visibility))return forbidden(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO wiki_pages (id,parent_id,title,slug,category,visibility,created_by) VALUES (?,?,?,?,?,?,?)`).bind(id,d.parentId??null,d.title,d.slug,d.category,d.visibility,c.get('user').id),
    c.env.DB.prepare(`INSERT INTO wiki_versions (id,page_id,version,content_markdown,change_summary,author_id) VALUES (?,?,1,?,?,?)`).bind(versionId,id,d.contentMarkdown,d.changeSummary,c.get('user').id),
    audit(c.env,c.get('user').id,'wiki.created','wiki_page',id),
  ]); return c.json({ok:true,data:{id,slug:d.slug}},201);
});
workspaceModuleRoutes.post('/wiki/:id/versions', async (c) => {
  const parsed=wikiVersionSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return validation(c,'Wiki version is invalid',parsed.error.flatten().fieldErrors);
  const user=c.get('user');
  const page=await c.env.DB.prepare(`SELECT current_version,visibility FROM wiki_pages WHERE id=? AND archived_at IS NULL`).bind(c.req.param('id')).first<{current_version:number;visibility:string}>();
  if(!page||!canViewWiki(user,page.visibility))return notFound(c,'Wiki page');
  if(!canEditWiki(user,page.visibility))return forbidden(c);
  const version=page.current_version+1,d=parsed.data;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO wiki_versions (id,page_id,version,content_markdown,change_summary,author_id) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(),c.req.param('id'),version,d.contentMarkdown,d.changeSummary,user.id),
      c.env.DB.prepare(`UPDATE wiki_pages SET current_version=?,updated_at=unixepoch() WHERE id=?`).bind(version,c.req.param('id')),
      audit(c.env,user.id,'wiki.version_created','wiki_page',c.req.param('id'),{version}),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) return c.json({ok:false,error:{code:'VERSION_CONFLICT',message:'Another version was saved concurrently; reload and retry'}},409);
    throw error;
  }
  return c.json({ok:true,data:{version}},201);
});

workspaceModuleRoutes.get('/decisions', async(c)=>{const r=await c.env.DB.prepare(`SELECT d.*,u.display_name AS ownerName FROM decisions d JOIN users u ON u.id=d.owner_id WHERE d.archived_at IS NULL ORDER BY d.created_at DESC`).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/decisions', requirePermission('task.manage'), async(c)=>{const p=decisionSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Decision is invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO decisions (id,project_id,owner_id,title,status,reasoning,alternatives,expected_impact,supersedes_id) VALUES (?,'project_cerberus',?,?,?,?,?,?,?)`).bind(id,c.get('user').id,d.title,d.status,d.reasoning,d.alternatives,d.expectedImpact,d.supersedesId??null).run();return c.json({ok:true,data:{id}},201);});

workspaceModuleRoutes.get('/decisions', async(c)=>{const r=await c.env.DB.prepare(`SELECT d.*,u.display_name AS ownerName FROM decisions d JOIN users u ON u.id=d.owner_id WHERE d.archived_at IS NULL ORDER BY d.created_at DESC`).all();return c.json({ok:true,data:r.results});});
for(const resource of ['bugs','blockers'] as const){
  workspaceModuleRoutes.get(`/${resource}`,async(c)=>{const rows=await c.env.DB.prepare(`SELECT x.*,reporter.display_name AS reporterName,assignee.display_name AS assigneeName FROM ${resource} x JOIN users reporter ON reporter.id=x.reporter_id LEFT JOIN users assignee ON assignee.id=x.assignee_id WHERE ${resource==='bugs'?'x.archived_at IS NULL':'1=1'} ORDER BY CASE x.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,x.created_at DESC`).all();return c.json({ok:true,data:rows.results});});
  workspaceModuleRoutes.post(`/${resource}`,async(c)=>{if(isSupervisor(c.get('user')))return forbidden(c);const p=issueSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Issue details are invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();if(resource==='bugs')await c.env.DB.prepare(`INSERT INTO bugs (id,project_id,reporter_id,assignee_id,title,description,reproduction_steps,severity) VALUES (?,'project_cerberus',?,?,?,?,?,?)`).bind(id,c.get('user').id,d.assigneeId??null,d.title,d.description,d.reproductionSteps,d.severity).run();else await c.env.DB.prepare(`INSERT INTO blockers (id,project_id,reporter_id,assignee_id,task_id,title,description,severity) VALUES (?,'project_cerberus',?,?,?,?,?,?)`).bind(id,c.get('user').id,d.assigneeId??null,d.taskId??null,d.title,d.description,d.severity).run();return c.json({ok:true,data:{id}},201);});
  workspaceModuleRoutes.patch(`/${resource}/:id/resolve`,async(c)=>{if(isSupervisor(c.get('user')))return forbidden(c);const b: {resolutionNotes?:string}=await c.req.json().catch(()=>({}));if(!b.resolutionNotes)return validation(c,'Resolution notes are required');const user=c.get('user');const row=await c.env.DB.prepare(`SELECT assignee_id FROM ${resource} WHERE id=?`).bind(c.req.param('id')).first<{assignee_id:string|null}>();if(!row)return notFound(c,resource==='bugs'?'Bug':'Blocker');if(row.assignee_id!==user.id&&!user.roles.includes('super_admin'))return forbidden(c);await c.env.DB.prepare(`UPDATE ${resource} SET status='resolved',resolution_notes=?,updated_at=unixepoch()${resource==='blockers'?',resolved_at=unixepoch()':''} WHERE id=?`).bind(b.resolutionNotes,c.req.param('id')).run();return c.json({ok:true,data:null});});
}

workspaceModuleRoutes.get('/supervisor/feedback/:memberId',requireRole('project_supervisor','super_admin'),async(c)=>{const r=await c.env.DB.prepare(`SELECT f.*,u.display_name AS supervisorName FROM supervisor_feedback f JOIN users u ON u.id=f.supervisor_id WHERE f.member_id=? ORDER BY f.created_at DESC`).bind(c.req.param('memberId')).all();return c.json({ok:true,data:r.results});});
workspaceModuleRoutes.post('/supervisor/feedback/:memberId',requireRole('project_supervisor'),async(c)=>{const p=feedbackSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return validation(c,'Feedback is invalid',p.error.flatten().fieldErrors);const d=p.data,id=crypto.randomUUID();await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO supervisor_feedback (id,supervisor_id,member_id,resource_type,resource_id,body) VALUES (?,?,?,?,?,?)`).bind(id,c.get('user').id,c.req.param('memberId'),d.resourceType??null,d.resourceId??null,d.body),c.env.DB.prepare(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id) VALUES (?,?,'supervisor.feedback','Supervisor feedback',?,'supervisor_feedback',?)`).bind(crypto.randomUUID(),c.req.param('memberId'),d.body,id),...workspaceEventStatements(c.env,{type:'supervisor.feedback',userIds:[c.req.param('memberId')],payload:{feedbackId:id,body:d.body}})]);return c.json({ok:true,data:{id}},201);});

function validation(c: Context, message: string, fields?: unknown) { return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message, fields } }, 422); }
function notFound(c: Context, name: string) { return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `${name} not found` } }, 404); }
function forbidden(c: Context) { return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'This role cannot perform that action' } }, 403); }
