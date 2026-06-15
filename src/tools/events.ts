import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

const STATE_LABELS: Record<string, string> = {
  '1': 'Draft', '2': 'Released', '3': 'Deprecated', '4': 'Retired',
};

export function registerEventTools(server: McpServer): void {

  server.registerTool('list-events', {
    description: 'List all events in the Event Portal, optionally filtered by domain, name, or lifecycle state.',
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by application domain ID'),
      name: z.string().optional().describe('Filter by event name (partial match)'),
      stateId: z.enum(['1', '2', '3', '4']).optional().describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/events?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    const data = await epGet(path) as any;
    if (data?.data) {
      data.data = (data.data as any[]).map((e: any) => ({ ...e, _stateLabel: STATE_LABELS[e.stateId] ?? e.stateId }));
      if (args.stateId) data.data = data.data.filter((e: any) => e.stateId === args.stateId);
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-event', {
    description: 'Get full details of an event including all versions, topic addresses, and schema references.',
    inputSchema: {
      eventId: z.string().describe('Event object ID'),
    },
  }, async (args) => {
    const [event, versions] = await Promise.all([
      epGet(`/api/v2/architecture/events/${args.eventId}`),
      epGet(`/api/v2/architecture/events/${args.eventId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ event, versions }, null, 2) }] };
  });

  server.registerTool('find-event-by-name', {
    description: 'Find events by name — useful for natural language prompts like "get the event PurchaseOrderCreated". Returns matching events with all versions enriched with topic addresses.',
    inputSchema: {
      name: z.string().describe('Event name to search for, e.g. "PurchaseOrderCreated"'),
      applicationDomainId: z.string().optional().describe('Narrow to a specific domain'),
    },
  }, async (args) => {
    let path = `/api/v2/architecture/events?pageSize=100&name=${encodeURIComponent(args.name)}`;
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    const resp = await epGet(path) as any;
    const events: any[] = resp?.data ?? [];
    if (events.length === 0) {
      return { content: [{ type: 'text' as const, text: `No events found matching "${args.name}".` }] };
    }
    const enriched = await Promise.all(
      events.map(async (evt: any) => {
        const v = await epGet(`/api/v2/architecture/events/${evt.id}/versions?pageSize=100`) as any;
        return { ...evt, _stateLabel: STATE_LABELS[evt.stateId] ?? evt.stateId, versions: v?.data ?? [] };
      }),
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }] };
  });

  server.registerTool('get-event-version', {
    description: 'Get a specific event version by its version ID, including topic address, schema version ID, and lifecycle state.',
    inputSchema: {
      versionId: z.string().describe('Event version ID'),
    },
  }, async (args) => {
    const data = await epGet(`/api/v2/architecture/eventVersions/${args.versionId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('create-event', {
    description: 'Create a new event in the Event Portal with its first Draft version and topic address. Use set-event-version-state to promote to Released when ready.',
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the event in'),
      name: z.string().describe('Event name, e.g. "BusinessPartnerUpdated"'),
      description: z.string().optional(),
      topicAddress: z.string().describe('Topic address, e.g. "sap/mdg/BusinessPartner/Updated/v1/{partnerNumber}"'),
      version: z.string().default('1.0.0'),
      schemaVersionId: z.string().optional().describe('Attach an existing schema version ID'),
    },
  }, async (args) => {
    const eventObj = await epPost('/api/v2/architecture/events', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      description: args.description ?? '',
      shared: false,
    }) as any;

    const versionBody: Record<string, unknown> = {
      eventId: eventObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      deliveryDescriptor: {
        brokerType: 'solace',
        address: {
          addressLevels: args.topicAddress.split('/').map((level: string) => ({
            name: level,
            addressLevelType: level.startsWith('{') ? 'variable' : 'literal',
          })),
          addressType: 'topic',
        },
      },
    };
    if (args.schemaVersionId) versionBody.schemaVersionId = args.schemaVersionId;

    const eventVersion = await epPost('/api/v2/architecture/eventVersions', versionBody);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ event: eventObj, version: eventVersion }, null, 2) }] };
  });

  server.registerTool('update-event', {
    description: 'Update the name or description of an existing event object.',
    inputSchema: {
      eventId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name) body.name = args.name;
    if (args.description) body.description = args.description;
    const data = await epPatch(`/api/v2/architecture/events/${args.eventId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('update-event-version', {
    description: 'Update the topic address or schema reference of an existing event version (Draft state only).',
    inputSchema: {
      versionId: z.string().describe('Event version ID'),
      topicAddress: z.string().optional(),
      schemaVersionId: z.string().optional(),
      description: z.string().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.description) body.description = args.description;
    if (args.schemaVersionId) body.schemaVersionId = args.schemaVersionId;
    if (args.topicAddress) {
      body.deliveryDescriptor = {
        brokerType: 'solace',
        address: {
          addressLevels: args.topicAddress.split('/').map((level: string) => ({
            name: level,
            addressLevelType: level.startsWith('{') ? 'variable' : 'literal',
          })),
          addressType: 'topic',
        },
      };
    }
    const data = await epPatch(`/api/v2/architecture/eventVersions/${args.versionId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('set-event-version-state', {
    description: 'Change the lifecycle state of an event version: Draft → Released → Deprecated → Retired.',
    inputSchema: {
      versionId: z.string().describe('Event version ID'),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    const data = await epPatch(`/api/v2/architecture/eventVersions/${args.versionId}`, { stateId: args.stateId }) as any;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...data, _newState: STATE_LABELS[args.stateId] }, null, 2) }] };
  });

  server.registerTool('delete-event', {
    description: 'Delete an event and all its versions. Only possible when in Draft state.',
    inputSchema: {
      eventId: z.string().describe('Event object ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/events/${args.eventId}`);
    return { content: [{ type: 'text' as const, text: `Event ${args.eventId} deleted.` }] };
  });
}