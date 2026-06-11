import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

// State IDs used by Event Portal
// 1 = Draft, 2 = Released, 3 = Deprecated, 4 = Retired
const STATE_LABELS: Record<string, string> = {
  '1': 'Draft',
  '2': 'Released',
  '3': 'Deprecated',
  '4': 'Retired',
};

export function registerEventTools(server: McpServer): void {

  server.tool(
    'list-events',
    'List all events in the Event Portal, optionally filtered by domain name or event name.',
    {
      applicationDomainId: z.string().optional().describe('Filter by application domain ID'),
      name: z.string().optional().describe('Filter by event name (partial match)'),
      stateId: z.enum(['1', '2', '3', '4']).optional()
        .describe('Filter by state: 1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
    async ({ applicationDomainId, name, stateId }) => {
      let path = '/api/v2/architecture/events?pageSize=100';
      if (applicationDomainId) path += `&applicationDomainId=${applicationDomainId}`;
      if (name) path += `&name=${encodeURIComponent(name)}`;
      const data = await epGet(path) as any;

      // Annotate state labels for readability
      if (data?.data) {
        data.data = (data.data as any[]).map((e: any) => ({
          ...e,
          _stateLabel: STATE_LABELS[e.stateId] ?? e.stateId,
        }));
        if (stateId) {
          data.data = data.data.filter((e: any) => e.stateId === stateId);
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'get-event',
    'Get full details of an event including all versions, topic addresses, schema references, and publisher/subscriber applications.',
    {
      eventId: z.string().describe('Event object ID'),
    },
    async ({ eventId }) => {
      const [event, versions] = await Promise.all([
        epGet(`/api/v2/architecture/events/${eventId}`),
        epGet(`/api/v2/architecture/events/${eventId}/versions?pageSize=100`),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ event, versions }, null, 2) }],
      };
    },
  );

  server.tool(
    'find-event-by-name',
    `Find events by name — useful for natural language prompts like "get the event PurchaseOrderCreated".
    Returns the event object plus all its versions enriched with topic addresses and schema references.`,
    {
      name: z.string().describe('Event name to search for, e.g. "PurchaseOrderCreated"'),
      applicationDomainId: z.string().optional().describe('Narrow to a specific domain'),
    },
    async ({ name, applicationDomainId }) => {
      let path = `/api/v2/architecture/events?pageSize=100&name=${encodeURIComponent(name)}`;
      if (applicationDomainId) path += `&applicationDomainId=${applicationDomainId}`;
      const resp = await epGet(path) as any;
      const events: any[] = resp?.data ?? [];

      if (events.length === 0) {
        return { content: [{ type: 'text', text: `No events found matching "${name}".` }] };
      }

      // Enrich each event with its versions
      const enriched = await Promise.all(
        events.map(async (evt: any) => {
          const versionsResp = await epGet(
            `/api/v2/architecture/events/${evt.id}/versions?pageSize=100`,
          ) as any;
          return {
            ...evt,
            _stateLabel: STATE_LABELS[evt.stateId] ?? evt.stateId,
            versions: versionsResp?.data ?? [],
          };
        }),
      );

      return { content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }] };
    },
  );

  server.tool(
    'get-event-version',
    'Get a specific event version by its version ID, including topic address, schema version ID, and state.',
    {
      versionId: z.string().describe('Event version ID'),
    },
    async ({ versionId }) => {
      const data = await epGet(`/api/v2/architecture/eventVersions/${versionId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'create-event',
    `Create a new event in the Event Portal with its first version.

    Example use: "Create an event BusinessPartnerUpdated which will be published by MDG
    and subscribed to by a Cloud Integration iFlow."

    This tool creates the event object and its first Draft version with a topic address.
    Use set-event-version-state to promote to Released when ready.
    Use add-application-version-publisher / add-application-version-subscriber to link
    producer and consumer applications.`,
    {
      applicationDomainId: z.string().describe('Domain to create the event in'),
      name: z.string().describe('Event name, e.g. "BusinessPartnerUpdated"'),
      description: z.string().optional().describe('Description of the event and its business purpose'),
      topicAddress: z.string().describe(
        'Topic address pattern following SAP convention, e.g. "sap/mdg/BusinessPartner/Updated/v1/{partnerNumber}"',
      ),
      version: z.string().default('1.0.0'),
      schemaVersionId: z.string().optional().describe(
        'Attach an existing schema version ID to this event version',
      ),
    },
    async ({ applicationDomainId, name, description, topicAddress, version, schemaVersionId }) => {
      // 1. Create the event object
      const eventObj = await epPost('/api/v2/architecture/events', {
        applicationDomainId,
        name,
        description: description ?? '',
        shared: false,
      }) as any;

      const eventId = eventObj?.data?.id;

      // 2. Create version 1
      const versionBody: Record<string, unknown> = {
        eventId,
        description: description ?? '',
        version,
        stateId: '1', // Draft
        deliveryDescriptor: {
          brokerType: 'solace',
          address: {
            addressLevels: topicAddress.split('/').map((level: string) => ({
              name: level,
              addressLevelType: level.startsWith('{') ? 'variable' : 'literal',
            })),
            addressType: 'topic',
          },
        },
      };

      if (schemaVersionId) {
        versionBody.schemaVersionId = schemaVersionId;
      }

      const eventVersion = await epPost('/api/v2/architecture/eventVersions', versionBody);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ event: eventObj, version: eventVersion }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update-event',
    'Update the name or description of an existing event object.',
    {
      eventId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ eventId, name, description }) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description) body.description = description;
      const data = await epPatch(`/api/v2/architecture/events/${eventId}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'update-event-version',
    'Update the topic address or schema reference of an existing event version (must be in Draft state).',
    {
      versionId: z.string().describe('Event version ID'),
      topicAddress: z.string().optional().describe('New topic address, e.g. sap/mdg/BP/Updated/v1/{id}'),
      schemaVersionId: z.string().optional().describe('Attach a schema version'),
      description: z.string().optional(),
    },
    async ({ versionId, topicAddress, schemaVersionId, description }) => {
      const body: Record<string, unknown> = {};
      if (description) body.description = description;
      if (schemaVersionId) body.schemaVersionId = schemaVersionId;
      if (topicAddress) {
        body.deliveryDescriptor = {
          brokerType: 'solace',
          address: {
            addressLevels: topicAddress.split('/').map((level: string) => ({
              name: level,
              addressLevelType: level.startsWith('{') ? 'variable' : 'literal',
            })),
            addressType: 'topic',
          },
        };
      }
      const data = await epPatch(`/api/v2/architecture/eventVersions/${versionId}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'set-event-version-state',
    'Change the lifecycle state of an event version: Draft → Released → Deprecated → Retired.',
    {
      versionId: z.string().describe('Event version ID'),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
    async ({ versionId, stateId }) => {
      const data = await epPatch(`/api/v2/architecture/eventVersions/${versionId}`, { stateId });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...data,
            _newState: STATE_LABELS[stateId],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete-event',
    'Delete an event and all its versions. Only possible when the event is in Draft state.',
    {
      eventId: z.string().describe('Event object ID to delete'),
    },
    async ({ eventId }) => {
      await epDelete(`/api/v2/architecture/events/${eventId}`);
      return { content: [{ type: 'text', text: `Event ${eventId} deleted.` }] };
    },
  );
}
