# MCP Server for Odoo

A minimal read-only Model Context Protocol (MCP) server for Odoo ERP integration written in TypeScript. Enables AI assistants to safely query and explore Odoo data.

## Available Tools

- **search_records** - Search Odoo records with domain filters
- **get_record** - Get records by ID  
- **list_models** - List available models
- **get_model_fields** - Get model field definitions

## Common Models

- `res.partner` - Customers/contacts
- `sale.order` - Sales orders  
- `product.product` - Products
- `account.move` - Invoices
- `stock.quant` - Inventory

## Installation

### Prerequisites
- **Node.js**: Version 20.0.0 or higher
- **npm**: For package management

### Development

```bash
# Clone the repository
git clone https://github.com/joelsalazarnet/nora-ce
cd nora-ce

# Install dependencies
npm install

# Build the project
npm run build
```

## Claude Desktop Setup

Add to your claude_desktop_config.json file:

```json
{
  "mcpServers": {
    "odoo": {
      "command": "npx",
      "args": ["odoo-mcp-ro"],
      "env": {
        "ODOO_URL": "https://your-instance.odoo.com",
        "ODOO_DB": "your-database",
        "ODOO_USERNAME": "your-email@example.com",
        "ODOO_API_KEY": "your-api-key"
      }
    }
  }
}
```

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

### GNU General Public License v3.0

Copyright (c) 2025 ODOO-MCP-RO

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
