#!/usr/bin/env node

/**
 * Minimal MCP server for Odoo integration using JSON-RPC
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  CallToolRequest,
  CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Input validation schemas
const SearchRecordsSchema = z.object({
  model: z.string().min(1, "Model name cannot be empty"),
  domain: z.array(z.array(z.any())),
  fields: z.array(z.string()),
});

const GetRecordSchema = z.object({
  model: z.string().min(1, "Model name cannot be empty"),
  ids: z.array(z.number().int().positive()),
  fields: z.array(z.string()).optional()
});

const ListModelsSchema = z.object({});

const GetModelFieldsSchema = z.object({
  model: z.string().min(1, "Model name cannot be empty"),
  fields: z.array(z.string()).optional()
});

class OdooClient {
  private url: string;
  private database: string;
  private username: string;
  private password: string;
  private uid: number | null = null;
  private sessionId = 0; // Reuse session IDs for better performance

  constructor(url: string, database: string, username: string, password: string) {
    this.url = url.replace(/\/$/, '');
    this.database = database;
    this.username = username;
    this.password = password;
  }

  private async rpc(service: string, method: string, params: any[]): Promise<any> {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args: params },
        id: ++this.sessionId // Increment instead of Date.now()
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || 'Odoo error');
    return result.result;
  }

  private async auth(): Promise<number> {
    if (this.uid) return this.uid;
    this.uid = await this.rpc('common', 'authenticate', [this.database, this.username, this.password, {}]);
    if (!this.uid) throw new Error('Auth failed');
    return this.uid;
  }

  async call(model: string, method: string, args: any[] = [], kwargs: any = {}): Promise<any> {
    const uid = await this.auth();
    return this.rpc('object', 'execute_kw', [this.database, uid, this.password, model, method, args, kwargs]);
  }
}

// Pre-initialize client and validation to avoid repeated instantiation
let odooClient: OdooClient | null = null;
const getOdooClient = (): OdooClient => {
  if (!odooClient) {
    const url = process.env.ODOO_URL;
    const database = process.env.ODOO_DB;
    const username = process.env.ODOO_USERNAME;
    const password = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY;

    if (!url || !database || !username || !password) {
      throw new Error('Missing required environment variables');
    }

    odooClient = new OdooClient(url, database, username, password);
  }
  return odooClient;
};

// Pre-defined tools schema for faster response
const TOOLS_RESPONSE = {
  tools: [
    {
      name: 'search_records',
      description: 'Tool to find Odoo records. It searches a specific Odoo "model". It filters these records using a "domain" (search rules). It returns only the requested "fields" for each record.',
        inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: "Odoo model name" },
          domain: { type: 'array', description: "Domains enable searching or filtering data based on specific criteria. A domain consists of a field, operator, and value, allowing diverse filtering options using various operators.", items: { type: 'array' } },
          fields: { type: 'array', description: 'List of model fields to return', items: { type: 'string' } },
        },
        required: ['model'],
      },
    },
    {
      name: 'get_record',
      description: 'Get specific Odoo records by ID',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Odoo model name' },
          ids: { type: 'array', description: 'List of record IDs to retrieve', items: { type: 'integer' } },
          fields: { type: 'array', description: 'List of model fields to return', items: { type: 'string' }, default: null },
        },
        required: ['model', 'ids'],
      },
    },
    {
      name: 'list_models',
      description: 'List all available Odoo models',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_model_fields',
      description: 'Get field definitions for an Odoo model. Used to inspect a models fields and check which ones seem to be of interest.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Odoo model name' },
          fields: { type: 'array', description: 'Specific model fields to retrieve', items: { type: 'string' }, default: null },
        },
        required: ['model'],
      },
    },
  ],
} as const;

async function createMcpServer(): Promise<Server> {
  const server = new Server({ name: 'nora-ce', version: '0.1.0' }, { capabilities: { tools: {} } });

  // Return pre-built response for better performance
  server.setRequestHandler(ListToolsRequestSchema, async () => TOOLS_RESPONSE);

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      const client = getOdooClient();

      switch (name) {
        case 'search_records': {
          const validatedArgs = SearchRecordsSchema.parse(args);
          const kwargs: any = {};
          if (validatedArgs.fields) kwargs.fields = validatedArgs.fields;
          // Fixed default limit to prevent unbounded reads
          kwargs.limit = 1000;
          try {
            const result = await client.call(validatedArgs.model, 'search_read', [validatedArgs.domain], kwargs);
            const resultText = result.length > 0 
              ? `Found ${result.length} records in model '${validatedArgs.model}'\n${JSON.stringify(result, null, 2)}`
              : `Found 0 records in model '${validatedArgs.model}' (no records match the criteria)`;
            return { 
              content: [{ type: 'text', text: resultText }],
              isError: false
            };
          } catch (error) {
            // If error might be due to invalid fields, check them
            if (validatedArgs.fields && error instanceof Error && /field/i.test(error.message)) {
              try {
                const availableFieldsObj = await client.call(validatedArgs.model, 'fields_get', [], {});
                const availableFields = new Set(Object.keys(availableFieldsObj));
                const invalidFields = validatedArgs.fields.filter(f => !availableFields.has(f));
                if (invalidFields.length > 0) {
                  return {
                    content: [{
                      type: 'text',
                      text: `Invalid field(s) for model '${validatedArgs.model}': ${invalidFields.join(', ')}`
                    }],
                    isError: true
                  };
                }
              } catch (fieldsError) {
                // If fields_get fails, fall through to generic error
              }
            }
            // Fallback: generic error
            throw error;
          }
        }

        case 'get_record': {
          const validatedArgs = GetRecordSchema.parse(args);
          const kwargs = validatedArgs.fields ? { fields: validatedArgs.fields } : {};
          try {
            const result = await client.call(validatedArgs.model, 'read', [validatedArgs.ids], kwargs);
            return { 
              content: [{ type: 'text', text: `Retrieved ${result.length} records from model '${validatedArgs.model}'\n${JSON.stringify(result, null, 2)}` }],
              isError: false
            };
          } catch (error) {
            if (validatedArgs.fields && error instanceof Error && /field/i.test(error.message)) {
              try {
                const availableFieldsObj = await client.call(validatedArgs.model, 'fields_get', [], {});
                const availableFields = new Set(Object.keys(availableFieldsObj));
                const invalidFields = validatedArgs.fields.filter(f => !availableFields.has(f));
                if (invalidFields.length > 0) {
                  return {
                    content: [{
                      type: 'text',
                      text: `Invalid field(s) for model '${validatedArgs.model}': ${invalidFields.join(', ')}`
                    }],
                    isError: true
                  };
                }
              } catch (fieldsError) {
                // If fields_get fails, fall through to generic error
              }
            }
            throw error;
          }
        }

        case 'list_models': {
          ListModelsSchema.parse(args || {});
          const models = await client.call('ir.model', 'search_read', [[]], { 
            fields: ['model', 'name']
          });
          models.sort((a: any, b: any) => a.model.localeCompare(b.model));
          const summary = `Found ${models.length} available Odoo models`;
          const modelList = models.map((model: any) => `- **${model.model}**: ${model.name}`).join('\n');
          return { 
            content: [{ type: 'text', text: `${summary}\n${modelList}` }],
            isError: false
          };
        }

        case 'get_model_fields': {
          const validatedArgs = GetModelFieldsSchema.parse(args);
          const kwargs = validatedArgs.fields ? { allfields: validatedArgs.fields } : {};
          const result = await client.call(validatedArgs.model, 'fields_get', [], kwargs);
          const fieldCount = Object.keys(result).length;
          return { 
            content: [{ type: 'text', text: `Model '${validatedArgs.model}' has ${fieldCount} fields\n${JSON.stringify(result, null, 2)}` }],
            isError: false
          };
        }

        default:
          return { 
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true
          };
      }
    } catch (error) {
      const errorMessage = error instanceof z.ZodError 
        ? `Validation Error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        : `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return { 
        content: [{ type: 'text', text: errorMessage }],
        isError: true
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Odoo MCP server running on stdio');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

if (require.main === module) {
  main().catch(console.error);
}