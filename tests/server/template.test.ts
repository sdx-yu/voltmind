// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { createTemplatePackage, TemplateService } from '../../server/template.js'

describe('V2-P local template packages', () => {
  let dir = ''
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-template-')) })
  afterEach(() => { for (const database of databases.splice(0)) database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }
  async function cookie(app: ReturnType<typeof createApp>['app']) { return (await request(app).post('/api/session').expect(200)).headers['set-cookie'][0].split(';')[0] }

  it('backs up v11 before migration v12 and creates content-addressed tables', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DELETE FROM schema_migrations WHERE version IN (12,13,14);')
    db.close(); databases.splice(databases.indexOf(db), 1)
    db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 14 })
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'template_%'").get()).toMatchObject({ count: 6 })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v11-to-v14-'))).toBe(true)
  })

  it('verifies hashes and rejects undeclared data, tampering and ID collisions', () => {
    const db = database('protocol'); const templates = new TemplateService(db)
    const original = templates.listInstallations(false)[0].package
    expect(templates.inspectPackage(original)).toMatchObject({ valid: true, duplicate: true, collision: false, sceneCount: 8 })
    expect(() => templates.inspectPackage({ ...original, execute: 'rm -rf /' })).toThrow()
    expect(() => templates.inspectPackage({ ...original, structure: { ...original.structure, nodes: original.structure.nodes.map((node, index) => index ? node : { ...node, title: '篡改标题' }) } })).toThrow(/hash mismatch/i)
    const { structureHash: _structureHash, ...manifest } = original.manifest
    const collision = createTemplatePackage({ manifest, structure: { nodes: original.structure.nodes.map((node, index) => index ? node : { ...node, title: '另一模板' }), rules: original.structure.rules } })
    expect(() => templates.installPackage(collision)).toThrow(/ID collision/)
  })

  it('defaults to no capability, detects stale previews, applies in one transaction and reverts recoverably', () => {
    const db = database('apply'); const templates = new TemplateService(db); const project = db.createProject('模板权限验收')
    const installation = templates.listInstallations(false)[0]
    const denied = templates.preview(project.id, installation.id)
    expect(denied.projectSummary).toBeNull()
    expect(denied.ruleResults).toEqual([])
    expect(denied.missingCapabilities).toEqual(installation.manifest.capabilities)
    expect(() => templates.apply(project.id, installation.id, denied.previewHash)).toThrow(/capability grant required/)
    for (const capability of installation.manifest.capabilities) templates.setGrant(project.id, installation.id, capability, true)
    const stale = templates.preview(project.id, installation.id)
    db.createNode({ projectId: project.id, parentId: db.listNodes(project.id).find((node) => node.type === 'book')!.id, type: 'chapter', title: '插入章节' })
    expect(() => templates.apply(project.id, installation.id, stale.previewHash)).toThrow(/preview is stale/)
    expect(templates.listApplications(project.id)).toEqual([])

    const preview = templates.preview(project.id, installation.id)
    const originalCreateNode = db.createNode.bind(db); let calls = 0
    db.createNode = ((input: Parameters<AppDatabase['createNode']>[0]) => { calls += 1; if (calls === 2) throw new Error('injected apply failure'); return originalCreateNode(input) }) as AppDatabase['createNode']
    expect(() => templates.apply(project.id, installation.id, preview.previewHash)).toThrow(/injected/)
    db.createNode = originalCreateNode as AppDatabase['createNode']
    expect(templates.listApplications(project.id)).toEqual([])
    expect(db.listNodes(project.id).filter((node) => node.title === '第一幕：建立')).toEqual([])

    const applied = templates.apply(project.id, installation.id, templates.preview(project.id, installation.id).previewHash)
    expect(applied.createdNodeIds).toHaveLength(11)
    expect(db.listProvenanceEvents(project.id).at(-1)?.eventType).toBe('template_applied')
    const reverted = templates.revert(applied.id)
    expect(reverted.status).toBe('reverted')
    expect(applied.createdNodeIds.every((id) => db.getNode(id)?.deletedAt)).toBe(true)
    expect(db.listProvenanceEvents(project.id).at(-1)?.eventType).toBe('template_reverted')
  })

  it('requires explicit conflict resolution and renames without overwriting existing nodes', () => {
    const db = database('conflict'); const templates = new TemplateService(db); const project = db.createProject('冲突验收'); const installation = templates.listInstallations(false)[0]
    const book = db.listNodes(project.id).find((node) => node.type === 'book')!
    db.createNode({ projectId: project.id, parentId: book.id, type: 'chapter', title: '第一幕：建立' })
    for (const capability of installation.manifest.capabilities) templates.setGrant(project.id, installation.id, capability, true)
    const preview = templates.preview(project.id, installation.id)
    expect(preview.conflicts).toHaveLength(1)
    expect(() => templates.apply(project.id, installation.id, preview.previewHash, 'cancel')).toThrow(/explicit rename/)
    templates.apply(project.id, installation.id, preview.previewHash, 'rename')
    expect(db.listNodes(project.id).map((node) => node.title)).toContain('第一幕：建立（模板）')
    expect(db.listNodes(project.id).filter((node) => node.title === '第一幕：建立')).toHaveLength(1)
  })

  it('keeps imports idempotent, blocks collision payloads, and retains history after uninstall', () => {
    const db = database('lifecycle'); const templates = new TemplateService(db); const original = templates.listInstallations(false)[0]
    expect(templates.installPackage(original.package).id).toBe(original.id)
    expect(templates.setInstallationStatus(original.id, 'disabled').status).toBe('disabled')
    expect(templates.setInstallationStatus(original.id, 'uninstalled').status).toBe('uninstalled')
    expect(templates.installPackage(original.package).status).toBe('enabled')
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM template_packages').get()).toMatchObject({ count: 1 })
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM template_events WHERE package_id=?').get(original.id)).toMatchObject({ count: 4 })
  })

  it('serves the least-privilege preview, apply and revert journey through authenticated HTTP routes', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'routes.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('模板接口验收')
    const installation = (await request(result.app).get('/api/template-packages').set('Cookie', auth).expect(200)).body[0]

    const denied = (await request(result.app).post(`/api/projects/${project.id}/template-packages/${installation.id}/preview`).set('Cookie', auth).send({}).expect(200)).body
    expect(denied).toMatchObject({ projectSummary: null, ruleResults: [], missingCapabilities: installation.manifest.capabilities })
    await request(result.app).post(`/api/projects/${project.id}/template-packages/${installation.id}/applications`).set('Cookie', auth).send({ previewHash: denied.previewHash }).expect(403)

    for (const capability of installation.manifest.capabilities) {
      await request(result.app).put(`/api/projects/${project.id}/template-packages/${installation.id}/grants/${capability}`).set('Cookie', auth).send({ granted: true }).expect(200)
    }
    const preview = (await request(result.app).post(`/api/projects/${project.id}/template-packages/${installation.id}/preview`).set('Cookie', auth).send({}).expect(200)).body
    expect(preview).toMatchObject({ missingCapabilities: [], projectSummary: { title: '模板接口验收' } })
    expect(preview.nodes).toHaveLength(11)
    expect(preview.ruleResults).toHaveLength(2)

    const applied = (await request(result.app).post(`/api/projects/${project.id}/template-packages/${installation.id}/applications`).set('Cookie', auth).send({ previewHash: preview.previewHash, conflictStrategy: 'cancel' }).expect(201)).body
    expect((await request(result.app).get(`/api/projects/${project.id}/template-applications`).set('Cookie', auth).expect(200)).body[0]).toMatchObject({ id: applied.id, status: 'applied' })
    const reverted = (await request(result.app).post(`/api/template-applications/${applied.id}/revert`).set('Cookie', auth).send({}).expect(200)).body
    expect(reverted.status).toBe('reverted')
    expect(applied.createdNodeIds.every((id: string) => result.database.getNode(id)?.deletedAt)).toBe(true)
  })

  it('round-trips packages, grants and applications through normal backup', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'backup.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('模板备份验收'); const installation = result.templates.listInstallations(false)[0]
    for (const capability of installation.manifest.capabilities) result.templates.setGrant(project.id, installation.id, capability, true)
    result.templates.apply(project.id, installation.id, result.templates.preview(project.id, installation.id).previewHash)
    const archive = (await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', auth).expect(200)).body
    expect(archive.payload.templates.packages[0]).toMatchObject({ format: 'bbd-template-v1' })
    expect(JSON.stringify(archive.payload.templates)).not.toMatch(/正文|apiKey|recoveryPhrase/)
    const restored = (await request(result.app).post('/api/backups/restore').set('Cookie', auth).send(archive).expect(201)).body
    expect(result.templates.listApplications(restored.id)[0]).toMatchObject({ packageName: '三幕结构起步包', status: 'applied' })
    expect(result.templates.listGrants(restored.id, installation.id).every((grant) => grant.granted)).toBe(true)
    expect(result.database.listNodes(restored.id).some((node) => node.title === '高潮抉择')).toBe(true)
  })
})
