import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

export function registerSchemaTools(server: McpServer): void {

  server.registerTool('list-schemas', {
    description: 'List all schemas in the Event Portal, optionally filtered by application domain or name.',
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by domain ID'),
      name: z.string().optional().describe('Filter by schema name (partial match)'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/schemas?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-schema', {
    description: 'Get a schema object by ID. Returns the schema name, type, and all its versions.',
    inputSchema: {
      schemaId: z.string().describe('Schema object ID'),
    },
  }, async (args) => {
    const [schema, versions] = await Promise.all([
      epGet(`/api/v2/architecture/schemas/${args.schemaId}`),
      epGet(`/api/v2/architecture/schemas/${args.schemaId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ schema, versions }, null, 2) }] };
  });

  server.registerTool('get-schema-version', {
    description: 'Get a specific schema version by ID. Returns the full schema content (JSON Schema, Avro, XSD, etc.).',
    inputSchema: {
      versionId: z.string().describe('Schema version ID'),
    },
  }, async (args) => {
    const data = await epGet(`/api/v2/architecture/schemaVersions/${args.versionId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('find-schema-by-event-name', {
    description: 'Find schemas linked to an event by name. Useful for prompts like "get the schema within the event PurchaseOrderCreated". Searches schemas first, then falls back to searching events and following their schema references.',
    inputSchema: {
      eventName: z.string().describe('Event or schema name to search for, e.g. "PurchaseOrderCreated"'),
      applicationDomainId: z.string().optional().describe('Narrow search to a specific domain'),
    },
  }, async (args) => {
    let schemaPath = `/api/v2/architecture/schemas?pageSize=100&name=${encodeURIComponent(args.eventName)}`;
    if (args.applicationDomainId) schemaPath += `&applicationDomainId=${args.applicationDomainId}`;
    const schemasResp = await epGet(schemaPath) as any;
    const schemas: any[] = schemasResp?.data ?? [];

    if (schemas.length === 0) {
      let evtPath = `/api/v2/architecture/events?pageSize=100&name=${encodeURIComponent(args.eventName)}`;
      if (args.applicationDomainId) evtPath += `&applicationDomainId=${args.applicationDomainId}`;
      const eventsResp = await epGet(evtPath) as any;
      const events: any[] = eventsResp?.data ?? [];
      if (events.length === 0) {
        return { content: [{ type: 'text' as const, text: `No schemas or events found matching "${args.eventName}".` }] };
      }
      const results = await Promise.all(
        events.map(async (evt: any) => {
          const versionsResp = await epGet(`/api/v2/architecture/events/${evt.id}/versions?pageSize=100`) as any;
          const versions: any[] = versionsResp?.data ?? [];
          const enriched = await Promise.all(
            versions.map(async (v: any) => {
              let schemaContent: unknown = null;
              if (v.schemaVersionId) {
                schemaContent = await epGet(`/api/v2/architecture/schemaVersions/${v.schemaVersionId}`);
              }
              return { ...v, schemaContent };
            }),
          );
          return { event: evt, versions: enriched };
        }),
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }

    const enriched = await Promise.all(
      schemas.map(async (s: any) => {
        const versionsResp = await epGet(`/api/v2/architecture/schemas/${s.id}/versions?pageSize=100`) as any;
        return { schema: s, versions: versionsResp?.data ?? [] };
      }),
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }] };
  });

  server.registerTool('create-schema', {
    description: 'Create a new schema object in the Event Portal, then create its first version with the provided content.',
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the schema in'),
      name: z.string().describe('Schema name, e.g. "BusinessPartnerUpdatedPayload"'),
      schemaType: z.enum(['jsonSchema', 'avro', 'xsd', 'protobuf']).default('jsonSchema'),
      content: z.string().describe('The schema content as a string'),
      description: z.string().optional(),
      version: z.string().default('1.0.0'),
    },
  }, async (args) => {
    const schemaObj = await epPost('/api/v2/architecture/schemas', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      schemaType: args.schemaType,
      shared: false,
    }) as any;
    const schemaVersion = await epPost('/api/v2/architecture/schemaVersions', {
      schemaId: schemaObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      content: args.content,
      stateId: '1',
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ schema: schemaObj, version: schemaVersion }, null, 2) }] };
  });

  server.registerTool('update-schema-version-content', {
    description: 'Update the content of a schema version (Draft state only).',
    inputSchema: {
      versionId: z.string().describe('Schema version ID to update'),
      content: z.string().describe('New schema content'),
      description: z.string().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = { content: args.content };
    if (args.description) body.description = args.description;
    const data = await epPatch(`/api/v2/architecture/schemaVersions/${args.versionId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('delete-schema', {
    description: 'Delete a schema object and all its versions from the Event Portal.',
    inputSchema: {
      schemaId: z.string().describe('Schema object ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/schemas/${args.schemaId}`);
    return { content: [{ type: 'text' as const, text: `Schema ${args.schemaId} deleted.` }] };
  });
}