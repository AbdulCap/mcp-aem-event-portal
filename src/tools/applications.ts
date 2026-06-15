import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerApplicationTools(server: McpServer): void {

  server.registerTool('list-applications', {
    description: 'List all applications (producers/consumers) in the Event Portal. Applications represent the systems that publish or subscribe to events.',
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by domain'),
      name: z.string().optional().describe('Filter by application name'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/applications?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-application', {
    description: 'Get an application by ID including all its versions and the events it publishes or subscribes to.',
    inputSchema: {
      applicationId: z.string().describe('Application object ID'),
    },
  }, async (args) => {
    const [app, versions] = await Promise.all([
      epGet(`/api/v2/architecture/applications/${args.applicationId}`),
      epGet(`/api/v2/architecture/applications/${args.applicationId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ application: app, versions }, null, 2) }] };
  });

  server.registerTool('find-application-by-name', {
    description: 'Find an application by name. Useful for resolving names like "MDG" or "Cloud Integration iFlow" into application IDs.',
    inputSchema: {
      name: z.string().describe('Application name to search for'),
      applicationDomainId: z.string().optional(),
    },
  }, async (args) => {
    let path = `/api/v2/architecture/applications?pageSize=100&name=${encodeURIComponent(args.name)}`;
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('create-application', {
    description: 'Create a new application in the Event Portal, then create its first version. Use add-application-version-publisher / add-application-version-subscriber afterwards to link it to events.',
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the application in'),
      name: z.string().describe('Application name, e.g. "MDG" or "Cloud Integration - BP Subscriber"'),
      description: z.string().optional(),
      applicationType: z.enum(['standard', 'connector']).default('standard'),
      version: z.string().default('1.0.0'),
    },
  }, async (args) => {
    const appObj = await epPost('/api/v2/architecture/applications', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      description: args.description ?? '',
      applicationType: args.applicationType,
    }) as any;
    const appVersion = await epPost('/api/v2/architecture/applicationVersions', {
      applicationId: appObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      declaredProducedEventVersionIds: [],
      declaredConsumedEventVersionIds: [],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ application: appObj, version: appVersion }, null, 2) }] };
  });

  server.registerTool('add-application-version-publisher', {
    description: 'Declare that an application version publishes a specific event version. Example: "MDG publishes BusinessPartnerUpdated v1.0.0"',
    inputSchema: {
      appVersionId: z.string().describe('Application version ID'),
      eventVersionId: z.string().describe('Event version ID that this application publishes'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/applicationVersions/${args.appVersionId}`) as any;
    const existing: string[] = current?.data?.declaredProducedEventVersionIds ?? [];
    if (existing.includes(args.eventVersionId)) {
      return { content: [{ type: 'text' as const, text: `Already publishes event version ${args.eventVersionId}.` }] };
    }
    const data = await epPatch(`/api/v2/architecture/applicationVersions/${args.appVersionId}`, {
      declaredProducedEventVersionIds: [...existing, args.eventVersionId],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('add-application-version-subscriber', {
    description: 'Declare that an application version subscribes to a specific event version. Example: "Cloud Integration iFlow subscribes to BusinessPartnerUpdated v1.0.0"',
    inputSchema: {
      appVersionId: z.string().describe('Application version ID'),
      eventVersionId: z.string().describe('Event version ID that this application subscribes to'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/applicationVersions/${args.appVersionId}`) as any;
    const existing: string[] = current?.data?.declaredConsumedEventVersionIds ?? [];
    if (existing.includes(args.eventVersionId)) {
      return { content: [{ type: 'text' as const, text: `Already subscribes to event version ${args.eventVersionId}.` }] };
    }
    const data = await epPatch(`/api/v2/architecture/applicationVersions/${args.appVersionId}`, {
      declaredConsumedEventVersionIds: [...existing, args.eventVersionId],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-application-version-publisher', {
    description: 'Remove a published event from an application version.',
    inputSchema: {
      appVersionId: z.string(),
      eventVersionId: z.string(),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/applicationVersions/${args.appVersionId}`) as any;
    const updated = (current?.data?.declaredProducedEventVersionIds ?? []).filter((id: string) => id !== args.eventVersionId);
    const data = await epPatch(`/api/v2/architecture/applicationVersions/${args.appVersionId}`, {
      declaredProducedEventVersionIds: updated,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-application-version-subscriber', {
    description: 'Remove a subscribed event from an application version.',
    inputSchema: {
      appVersionId: z.string(),
      eventVersionId: z.string(),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/applicationVersions/${args.appVersionId}`) as any;
    const updated = (current?.data?.declaredConsumedEventVersionIds ?? []).filter((id: string) => id !== args.eventVersionId);
    const data = await epPatch(`/api/v2/architecture/applicationVersions/${args.appVersionId}`, {
      declaredConsumedEventVersionIds: updated,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('set-application-version-state', {
    description: 'Change the lifecycle state of an application version.',
    inputSchema: {
      appVersionId: z.string(),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    const data = await epPatch(`/api/v2/architecture/applicationVersions/${args.appVersionId}`, { stateId: args.stateId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('delete-application', {
    description: 'Delete an application and all its versions.',
    inputSchema: {
      applicationId: z.string(),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/applications/${args.applicationId}`);
    return { content: [{ type: 'text' as const, text: `Application ${args.applicationId} deleted.` }] };
  });
}