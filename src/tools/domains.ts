import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerDomainTools(server: McpServer): void {

  server.tool(
    'list-application-domains',
    'List all application domains in the Event Portal. Domains are the top-level containers that group events, schemas, and applications together.',
    {
      name: z.string().optional().describe('Filter by domain name (partial match)'),
    },
    async ({ name }) => {
      let path = '/api/v2/architecture/applicationDomains?pageSize=100';
      if (name) path += `&name=${encodeURIComponent(name)}`;
      const data = await epGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'get-application-domain',
    'Get a single application domain by its ID, including its description and unique topic domain prefix.',
    {
      domainId: z.string().describe('The application domain ID'),
    },
    async ({ domainId }) => {
      const data = await epGet(`/api/v2/architecture/applicationDomains/${domainId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'create-application-domain',
    'Create a new application domain in the Event Portal.',
    {
      name: z.string().describe('Domain name, e.g. "MDG Events"'),
      description: z.string().optional().describe('Human-readable description of the domain'),
      uniqueTopicAddressEnforcementEnabled: z.boolean().default(true)
        .describe('Prevent duplicate topic addresses within the domain'),
      topicDomainEnforcementEnabled: z.boolean().default(false),
    },
    async (args) => {
      const data = await epPost('/api/v2/architecture/applicationDomains', {
        name: args.name,
        description: args.description ?? '',
        uniqueTopicAddressEnforcementEnabled: args.uniqueTopicAddressEnforcementEnabled,
        topicDomainEnforcementEnabled: args.topicDomainEnforcementEnabled,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'update-application-domain',
    'Update the name or description of an existing application domain.',
    {
      domainId: z.string().describe('The application domain ID to update'),
      name: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ domainId, name, description }) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description) body.description = description;
      const data = await epPatch(`/api/v2/architecture/applicationDomains/${domainId}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'delete-application-domain',
    'Delete an application domain. The domain must be empty (no events, schemas, or applications) before it can be deleted.',
    {
      domainId: z.string().describe('The application domain ID to delete'),
    },
    async ({ domainId }) => {
      await epDelete(`/api/v2/architecture/applicationDomains/${domainId}`);
      return { content: [{ type: 'text', text: `Domain ${domainId} deleted successfully.` }] };
    },
  );
}
