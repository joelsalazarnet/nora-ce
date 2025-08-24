#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';


const S = {
  Search: z.object({ model: z.string().min(1), domain: z.array(z.array(z.any())).optional().default([]), fields: z.array(z.string()).optional() }),
  Count: z.object({ model: z.string().min(1), domain: z.array(z.array(z.any())).optional() }),
  Get: z.object({ model: z.string().min(1), ids: z.array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/)])), fields: z.array(z.string()).optional() }),
  List: z.object({}),
  Fields: z.object({ model: z.string().min(1) })
};

class C {
  uid: number | null = null; session = 0;
  constructor(private url: string, private db: string, private user: string, private pwd: string) { this.url = url.replace(/\/$/, ''); }
  private async rpc(s: string, m: string, a: any[]) {
    const r = await fetch(`${this.url}/jsonrpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: s, method: m, args: a }, id: ++this.session }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json(); if (j.error) throw new Error(j.error.message || 'Odoo error'); return j.result;
  }
  private async auth() { if (this.uid) return this.uid; this.uid = await this.rpc('common', 'authenticate', [this.db, this.user, this.pwd, {}]); if (!this.uid) throw new Error('Auth failed'); return this.uid; }
  async call(m: string, method: string, args: any[] = [], kwargs: any = {}) { const uid = await this.auth(); return this.rpc('object', 'execute_kw', [this.db, uid, this.pwd, m, method, args, kwargs]); }
}

let client: C | null = null;
const getClient = () => {
  if (client) return client;
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB, user = process.env.ODOO_USERNAME, pwd = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY;
  if (!url || !db || !user || !pwd) throw new Error('Missing env');
  client = new C(url, db, user, pwd); return client;
};

const TOOLS = { tools: [
  { name: 'search_records', description: 'Search Records', inputSchema: { type: 'object', properties: { model: { type: 'string' }, domain: { type: 'array' }, fields: { type: 'array', items: { type: 'string' } } }, required: ['model'] } },
  { name: 'count_records', description: 'Count Records', inputSchema: { type: 'object', properties: { model: { type: 'string' }, domain: { type: 'array' } }, required: ['model'] } },
  { name: 'get_record', description: 'Get Records by IDs', inputSchema: { type: 'object', properties: { model: { type: 'string' }, ids: { type: 'array' }, fields: { type: 'array' } }, required: ['model', 'ids'] } },
  { name: 'list_models', description: 'List Models', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_model_fields', description: 'List Model Fields', inputSchema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] } }
] } as const;

const fmt = (e: unknown) => e instanceof z.ZodError ? `Validation Error: ${e.errors.map(x => `${x.path.join('.')}: ${x.message}`).join(', ')}` : `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;

async function createMcpServer(): Promise<Server> {
  const server = new Server({ name: 'nora-ce', version: '0.1.0' }, { capabilities: { tools: TOOLS } });
  server.setRequestHandler(ListToolsRequestSchema, async () => TOOLS);

  async function h(name: string, args: any, odoo: C): Promise<CallToolResult> {
    switch (name) {
      case 'search_records': {
        const v = S.Search.parse(args); const kw: any = v.fields ? { fields: v.fields } : {}; kw.limit = 1000;
        try { const r = await odoo.call(v.model, 'search_read', [v.domain], kw); const t = r.length ? `Found ${r.length} records in model '${v.model}'\n${JSON.stringify(r, null, 2)}` : `Found 0 records in model '${v.model}' (no records match the criteria)`; return { content: [{ type: 'text' as const, text: t }], isError: false }; }
        catch (err) { if (err instanceof Error && /field/i.test(err.message) && v.fields && v.fields.length) { try { const av = Object.keys(await odoo.call(v.model, 'fields_get', [], {})); const invalid = v.fields.filter(f => !av.includes(f)); if (invalid.length) return { content: [{ type: 'text' as const, text: `Invalid field(s) for model '${v.model}': ${invalid.join(', ')}` }], isError: true }; } catch {} } throw err; }
      }
      case 'count_records': { const v = S.Count.parse(args); const c = await odoo.call(v.model, 'search_count', [v.domain || []]); return { content: [{ type: 'text' as const, text: `Found ${c} matching records in model '${v.model}'` }], isError: false }; }
      case 'get_record': {
        const v = S.Get.parse(args);
        const kw = v.fields ? { fields: v.fields } : {};
        const ids = (v.ids as any[]).map(i => Number(i));
        try { const r = await odoo.call(v.model, 'read', [ids], kw); return { content: [{ type: 'text' as const, text: `Retrieved ${r.length} records from model '${v.model}'\n${JSON.stringify(r, null, 2)}` }], isError: false }; }
        catch (err) { if (err instanceof Error && /field/i.test(err.message) && v.fields && v.fields.length) { try { const av = Object.keys(await odoo.call(v.model, 'fields_get', [], {})); const invalid = v.fields.filter(f => !av.includes(f)); if (invalid.length) return { content: [{ type: 'text' as const, text: `Invalid field(s) for model '${v.model}': ${invalid.join(', ')}` }], isError: true }; } catch {} } throw err; }
      }
      case 'list_models': { S.List.parse(args || {}); const models: any[] = await odoo.call('ir.model', 'search_read', [[]], { fields: ['model', 'name'] }); models.sort((a, b) => a.model.localeCompare(b.model)); const body = `Found ${models.length} available Odoo models\n` + models.map(m => `- **${m.model}**: ${m.name}`).join('\n'); return { content: [{ type: 'text' as const, text: body }], isError: false }; }
      case 'get_model_fields': { const v = S.Fields.parse(args); const res = await odoo.call(v.model, 'fields_get', [], {}); return { content: [{ type: 'text' as const, text: `Model '${v.model}' has ${Object.keys(res).length} fields\n${JSON.stringify(res, null, 2)}` }], isError: false }; }
      default: return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest): Promise<CallToolResult> => {
    const { name, arguments: args } = req.params;
    try { const o = getClient(); return await h(name, args, o); } catch (e) { return { content: [{ type: 'text' as const, text: fmt(e) }], isError: true }; }
  });
  return server;
}

async function main() { const server = await createMcpServer(); const t = new StdioServerTransport(); await server.connect(t); console.error('Odoo MCP server running on stdio'); }

process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });