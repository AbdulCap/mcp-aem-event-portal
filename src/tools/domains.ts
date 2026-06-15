import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerDomainTools(server: McpServer): void {

  server.registerTool('list-application-domains', {
    description: 'List all application domains in the Event Portal. Domains are the top-level containers that group events, schemas, and applications together.',
    inputSchema: {
      name: z.string().optional().describe('Filter by domain name (partial match)'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/applicationDomains?pageSize=100';
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-application-domain', {
    description: 'Get a single application domain by its ID, including its description and unique topic domain prefix.',
    inputSchema: {
      domainId: z.string().describe('The application domain ID'),
    },
  }, async (args) => {
    const data = await epGet(`/api/v2/architecture/applicationDomains/${args.domainId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('create-application-domain', {
    description: 'Create a new application domain in the Event Portal.',
    inputSchema: {
      name: z.string().describe('Domain name, e.g. "MDG Events"'),
      description: z.string().optional(),
      uniqueTopicAddressEnforcementEnabled: z.boolean().default(true),
      topicDomainEnforcementEnabled: z.boolean().default(false),
    },
  }, async (args) => {
    const data = await epPost('/api/v2/architecture/applicationDomains', {
      name: args.name,
      description: args.description ?? '',
      uniqueTopicAddressEnforcementEnabled: args.uniqueTopicAddressEnforcementEnabled,
      topicDomainEnforcementEnabled: args.topicDomainEnforcementEnabled,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('update-application-domain', {
    description: 'Update the name or description of an existing application domain.',
    inputSchema: {
      domainId: z.string().describe('The application domain ID to update'),
      name: z.string().optional(),
      description: z.string().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name) body.name = args.name;
    if (args.description) body.description = args.description;
    const data = await epPatch(`/api/v2/architecture/applicationDomains/${args.domainId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('delete-application-domain', {
    description: 'Delete an application domain. The domain must be empty before it can be deleted.',
    inputSchema: {
      domainId: z.string().describe('The application domain ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/applicationDomains/${args.domainId}`);
    return { content: [{ type: 'text' as const, text: `Domain ${args.domainId} deleted successfully.` }] };
  });
}