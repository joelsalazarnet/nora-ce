#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

class OdooClient {
  uid: number | null = null;
  seq = 0;
  constructor(private url: string, private db: string, private user: string, private pwd: string) { this.url = url.replace(/\/$/, ''); }

  private async rpc(service: string, method: string, args: any[]) {
    const res = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: ++this.seq })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message || 'Odoo error');
    return body.result;
  }

  private async ensureAuth() {
    if (this.uid) return this.uid;
    this.uid = await this.rpc('common', 'authenticate', [this.db, this.user, this.pwd, {}]);
    if (!this.uid) throw new Error('Auth failed');
    return this.uid;
  }

  async call(model: string, method: string, args: any[] = [], kwargs: any = {}) {
    await this.ensureAuth();
    return this.rpc('object', 'execute_kw', [this.db, this.uid, this.pwd, model, method, args, kwargs]);
  }
}

let _client: OdooClient | null = null;
const getClient = () => {
  if (_client) return _client;
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const user = process.env.ODOO_USERNAME;
  const pwd = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY;
  if (!url || !db || !user || !pwd) throw new Error('Missing Odoo Env Variables');
  _client = new OdooClient(url, db, user, pwd);
  return _client;
};

const MCP_TOOLS = {
  tools: [
    { name: 'search_records', description: 'Search records inside a Model that satisfy the given Domain', inputSchema: { type: 'object', properties: { model: { type: 'string' }, domain: { type: 'array' }, fields: { type: 'array' } }, required: ['model', 'fields'] } },
    { name: 'count_records', description: 'Count records inside a Model that satisfy the given Domain', inputSchema: { type: 'object', properties: { model: { type: 'string' }, domain: { type: 'array' } }, required: ['model'] } },
    { name: 'get_record', description: 'Get records inside a Model that satisfy the given IDs', inputSchema: { type: 'object', properties: { model: { type: 'string' }, ids: { type: 'array' }, fields: { type: 'array' } }, required: ['model', 'ids'] } },
    { name: 'list_models', description: 'List all Models', inputSchema: { type: 'object' } },
    { name: 'list_fields', description: 'List all Fields in a Model', inputSchema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] } }
  ]
} as const;

const fmtErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function createMcpServer(): Promise<Server> {
  const server = new Server({ name: 'nora-ce', version: '0.1.2' }, { capabilities: { tools: MCP_TOOLS } });
  server.setRequestHandler(ListToolsRequestSchema, async () => MCP_TOOLS);

  async function handleTool(name: string, args: any, odoo: OdooClient): Promise<CallToolResult> {
    switch (name) {
      case 'search_records': {
        const modelName = args?.model;
        if (!modelName || typeof modelName !== 'string') {
          return { content: [{ type: 'text' as const, text: "Missing required parameter: model (string)" }], isError: true };
        }
        const domainArg = Array.isArray(args?.domain) ? args!.domain : [];
        if (!Array.isArray(args?.fields)) {
          return { content: [{ type: 'text' as const, text: "Missing or invalid required parameter: fields (array)" }], isError: true };
        }
        const fieldsArg = args!.fields;
        const rows = await odoo.call(modelName, 'search_read', [domainArg], { fields: fieldsArg, limit: 1000 });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ count: Array.isArray(rows) ? rows.length : 0, rows: rows || [] }) }], isError: false };
      }

      case 'count_records': {
        const modelName = args?.model;
        if (!modelName || typeof modelName !== 'string') {
          return { content: [{ type: 'text' as const, text: "Missing required parameter: model (string)" }], isError: true };
        }
        const domainArg = Array.isArray(args?.domain) ? args.domain : [];
        const count = await odoo.call(modelName, 'search_count', [domainArg]);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ model: modelName, count }) }], isError: false };
      }

      case 'get_record': {
        const modelName = args?.model;
        if (!modelName || typeof modelName !== 'string') {
          return { content: [{ type: 'text' as const, text: "Missing required parameter: model (string)" }], isError: true };
        }

        if (!Array.isArray(args?.ids)) {
          return { content: [{ type: 'text' as const, text: "Missing or invalid required parameter: ids (array)" }], isError: true };
        }

        const idsArg = args.ids.map((x: any) => Number(x));

        if (args?.fields !== undefined && !Array.isArray(args.fields)) {
          return { content: [{ type: 'text' as const, text: "Invalid parameter: fields must be an array if provided" }], isError: true };
        }

        const fieldsArg = Array.isArray(args?.fields) ? args.fields : undefined;
        const kwargs: any = fieldsArg ? { fields: fieldsArg } : {};
        const rows = await odoo.call(modelName, 'read', [idsArg], kwargs);
        const text = `Retrieved ${Array.isArray(rows) ? rows.length : 0} records from model '${modelName}'\n${JSON.stringify(rows, null, 2)}`;
        return { content: [{ type: 'text' as const, text }], isError: false };
      }

      case 'list_models': {
        const models: any[] = await odoo.call('ir.model', 'search_read', [[]], { fields: ['model', 'name'] });
        models.sort((a, b) => (a.model || '').localeCompare(b.model || ''));
        const body = `Found ${models.length} available Odoo models\n` + models.map(m => `- ${m.model}: ${m.name}`).join('\n');
        return { content: [{ type: 'text' as const, text: body }], isError: false };
      }

      case 'list_fields': {
        const modelName = args?.model;
        if (!modelName || typeof modelName !== 'string') {
          return { content: [{ type: 'text' as const, text: "Missing required parameter: model (string)" }], isError: true };
        }
        try {
          const fieldsObj = await odoo.call(modelName, 'fields_get', [], {});
          const text = `Model '${modelName}' has ${Object.keys(fieldsObj || {}).length} fields\n${JSON.stringify(fieldsObj, null, 2)}`;
          return { content: [{ type: 'text' as const, text }], isError: false };
        } catch (err) {
          const msg = fmtErr(err);
          const text = `Error fetching fields for model '${modelName}': ${msg}. Invalid Model Name`;
          return { content: [{ type: 'text' as const, text }], isError: true };
        }
      }

      default:
        return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest): Promise<CallToolResult> => {
    const { name, arguments: argObj } = req.params;
    try {
      const client = getClient();
      return await handleTool(name, argObj, client);
    } catch (err) {
      return { content: [{ type: 'text' as const, text: fmtErr(err) }], isError: true };
    }
  });

  return server;
}

async function main() {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Odoo MCP server running on stdio');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });