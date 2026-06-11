import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerDomainTools } from './tools/domains.js';
import { registerSchemaTools } from './tools/schemas.js';
import { registerEventTools } from './tools/events.js';
import { registerApplicationTools } from './tools/applications.js';

const server = new McpServer({
  name: 'mcp-aem-event-portal',
  version: '0.1.0',
});

registerDomainTools(server);
registerSchemaTools(server);
registerEventTools(server);
registerApplicationTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[mcp-aem-event-portal] Server started\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-aem-event-portal] Fatal: ${err}\n`);
  process.exit(1);
});
