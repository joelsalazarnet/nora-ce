# Nora Community Edition (Nora-CE)

An Open Source Model Context Protocol (MCP) Server that lets AI assistants query and explore Odoo ERP data safely. 

## Available tools

- `search_records` — Search records inside a Model that satisfy the given Domain.
- `count_records` — Count records inside a Model that satisfy the given Domain.
- `get_record` — Get records inside a Model that satisfy the given IDs.
- `list_models` — List available Odoo Models.
- `list_fields` — Get the fields definition for an Odoo Model.

## MCP Client Config

### Prerequisites

- Node.js >= 20.0.0
- NPM >= 9.0.0

### Install & Run

If you want to install and run this MCP server with an MCP Client, add an entry like:

```json
  {
    "mcpServers": {
      "Nora": {
        "command": "npx",
        "args": ["-y", "@joelsalazarnet/nora-ce"],
        "env": {
          "ODOO_URL": "https://your-odoo-url.com",
          "ODOO_DB": "your-database-name",
          "ODOO_USERNAME": "your-email@example.com",
          "ODOO_API_KEY": "your-api-key"
        }
      }
    }
  }
```

## MCP Server Config for Development

### Prerequisites

- Node.js >= 20.0.0
- NPM >= 9.0.0

### Install & Build

Clone, install and build:

```bash
git clone https://github.com/joelsalazarnet/nora-ce
cd nora-ce
npm install
npm run build
```
If you want to connect to the development MCP server with an MCP Client, add an entry like:

```json
{
  "mcpServers": {
    "Nora": {
      "command": "node",
      "args": ["path\\to\\nora-ce\\dist\\index.js"],
      "env": {
        "ODOO_URL": "https://your-odoo-url.com",
        "ODOO_DB": "your-database-name",
        "ODOO_USERNAME": "your-email@example.com",
        "ODOO_API_KEY": "your-api-key"
      }
    }
  }
}
```

## License

This repository is licensed under GPL-3.0 as declared in `package.json`.
