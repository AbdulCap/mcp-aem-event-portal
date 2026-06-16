import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { epGet, epPost, epPatch, epDelete } from '../api/client.js';

const STATE_LABELS: Record<string, string> = {
  '1': 'Draft', '2': 'Released', '3': 'Deprecated', '4': 'Retired',
};

export function registerEventApiTools(server: McpServer): void {

  // ── Event APIs ────────────────────────────────────────────────────────────

  server.registerTool('list-event-apis', {
    description: 'List all Event APIs in the Event Portal. An Event API groups one or more event versions into a versioned API contract that can be shared with consumers.',
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by application domain ID'),
      name: z.string().optional().describe('Filter by Event API name (partial match)'),
      shared: z.boolean().optional().describe('Filter by shared flag — true returns Event APIs shared across domains'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/eventApis?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    if (args.shared !== undefined) path += `&shared=${args.shared}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-event-api', {
    description: 'Get a single Event API by ID, including all its versions.',
    inputSchema: {
      eventApiId: z.string().describe('The Event API object ID'),
    },
  }, async (args) => {
    const [eventApi, versions] = await Promise.all([
      epGet(`/api/v2/architecture/eventApis/${args.eventApiId}`),
      epGet(`/api/v2/architecture/eventApis/${args.eventApiId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ eventApi, versions }, null, 2) }] };
  });

  server.registerTool('find-event-api-by-name', {
    description: 'Find an Event API by name. Returns the Event API object plus all its versions enriched with state labels.',
    inputSchema: {
      name: z.string().describe('Event API name to search for'),
      applicationDomainId: z.string().optional().describe('Narrow to a specific domain'),
    },
  }, async (args) => {
    let path = `/api/v2/architecture/eventApis?pageSize=100&name=${encodeURIComponent(args.name)}`;
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    const resp = await epGet(path) as any;
    const apis: any[] = resp?.data ?? [];
    if (apis.length === 0) {
      return { content: [{ type: 'text' as const, text: `No Event APIs found matching "${args.name}".` }] };
    }
    const enriched = await Promise.all(
      apis.map(async (api: any) => {
        const v = await epGet(`/api/v2/architecture/eventApis/${api.id}/versions?pageSize=100`) as any;
        const versions = (v?.data ?? []).map((ver: any) => ({
          ...ver,
          _stateLabel: STATE_LABELS[ver.stateId] ?? ver.stateId,
        }));
        return { ...api, versions };
      }),
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }] };
  });

  server.registerTool('create-event-api', {
    description: `Create a new Event API in the Event Portal, then create its first version.
An Event API defines a versioned contract grouping produced and consumed event versions.
After creation use add-event-api-version-produced-event and add-event-api-version-consumed-event
to attach event versions to it.`,
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the Event API in'),
      name: z.string().describe('Event API name, e.g. "BusinessPartnerEventsAPI"'),
      description: z.string().optional().describe('Description of the Event API and its purpose'),
      version: z.string().default('1.0.0').describe('Version label for the first version'),
      shared: z.boolean().default(false).describe('Make this Event API visible across all domains'),
    },
  }, async (args) => {
    const apiObj = await epPost('/api/v2/architecture/eventApis', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      description: args.description ?? '',
      shared: args.shared,
    }) as any;

    const apiVersion = await epPost('/api/v2/architecture/eventApiVersions', {
      eventApiId: apiObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      producedEventVersionIds: [],
      consumedEventVersionIds: [],
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ eventApi: apiObj, version: apiVersion }, null, 2) }] };
  });

  server.registerTool('update-event-api', {
    description: 'Update the name, description, or shared flag of an existing Event API object.',
    inputSchema: {
      eventApiId: z.string().describe('Event API object ID'),
      name: z.string().optional(),
      description: z.string().optional(),
      shared: z.boolean().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name) body.name = args.name;
    if (args.description) body.description = args.description;
    if (args.shared !== undefined) body.shared = args.shared;
    const data = await epPatch(`/api/v2/architecture/eventApis/${args.eventApiId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('delete-event-api', {
    description: 'Delete an Event API and all its versions. Only possible when all versions are in Draft state.',
    inputSchema: {
      eventApiId: z.string().describe('Event API object ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/eventApis/${args.eventApiId}`);
    return { content: [{ type: 'text' as const, text: `Event API ${args.eventApiId} deleted.` }] };
  });

  // ── Event API Versions ────────────────────────────────────────────────────

  server.registerTool('get-event-api-version', {
    description: 'Get a specific Event API version by its version ID, including its produced and consumed event version IDs and lifecycle state.',
    inputSchema: {
      versionId: z.string().describe('Event API version ID'),
    },
  }, async (args) => {
    const data = await epGet(`/api/v2/architecture/eventApiVersions/${args.versionId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('add-event-api-version-produced-event', {
    description: `Add a produced event version to an Event API version.
This declares that the Event API exposes this event as something it produces (publishes).
Example: "The BusinessPartnerEventsAPI produces BusinessPartnerUpdated v1.0.0"`,
    inputSchema: {
      apiVersionId: z.string().describe('Event API version ID'),
      eventVersionId: z.string().describe('Event version ID to add as a produced event'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`) as any;
    const existing: string[] = current?.data?.producedEventVersionIds ?? [];
    if (existing.includes(args.eventVersionId)) {
      return { content: [{ type: 'text' as const, text: `Event API version already produces event version ${args.eventVersionId}.` }] };
    }
    const data = await epPatch(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`, {
      producedEventVersionIds: [...existing, args.eventVersionId],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('add-event-api-version-consumed-event', {
    description: `Add a consumed event version to an Event API version.
This declares that the Event API consumes (subscribes to) this event.
Example: "The BusinessPartnerEventsAPI consumes AddressValidated v1.0.0"`,
    inputSchema: {
      apiVersionId: z.string().describe('Event API version ID'),
      eventVersionId: z.string().describe('Event version ID to add as a consumed event'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`) as any;
    const existing: string[] = current?.data?.consumedEventVersionIds ?? [];
    if (existing.includes(args.eventVersionId)) {
      return { content: [{ type: 'text' as const, text: `Event API version already consumes event version ${args.eventVersionId}.` }] };
    }
    const data = await epPatch(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`, {
      consumedEventVersionIds: [...existing, args.eventVersionId],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-event-api-version-produced-event', {
    description: 'Remove a produced event version from an Event API version.',
    inputSchema: {
      apiVersionId: z.string().describe('Event API version ID'),
      eventVersionId: z.string().describe('Event version ID to remove'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`) as any;
    const updated = (current?.data?.producedEventVersionIds ?? []).filter((id: string) => id !== args.eventVersionId);
    const data = await epPatch(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`, {
      producedEventVersionIds: updated,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-event-api-version-consumed-event', {
    description: 'Remove a consumed event version from an Event API version.',
    inputSchema: {
      apiVersionId: z.string().describe('Event API version ID'),
      eventVersionId: z.string().describe('Event version ID to remove'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`) as any;
    const updated = (current?.data?.consumedEventVersionIds ?? []).filter((id: string) => id !== args.eventVersionId);
    const data = await epPatch(`/api/v2/architecture/eventApiVersions/${args.apiVersionId}`, {
      consumedEventVersionIds: updated,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('set-event-api-version-state', {
    description: 'Change the lifecycle state of an Event API version: Draft → Released → Deprecated → Retired.',
    inputSchema: {
      versionId: z.string().describe('Event API version ID'),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    const data = await epPatch(`/api/v2/architecture/eventApiVersions/${args.versionId}`, { stateId: args.stateId }) as any;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...data, _newState: STATE_LABELS[args.stateId] }, null, 2) }] };
  });

  // ── Event API Products ────────────────────────────────────────────────────

  server.registerTool('list-event-api-products', {
    description: 'List all Event API Products in the Event Portal. An Event API Product bundles one or more Event API versions into a publishable product for external developer consumption.',
    inputSchema: {
      applicationDomainId: z.string().optional().describe('Filter by application domain'),
      name: z.string().optional().describe('Filter by product name'),
    },
  }, async (args) => {
    let path = '/api/v2/architecture/eventApiProducts?pageSize=100';
    if (args.applicationDomainId) path += `&applicationDomainId=${args.applicationDomainId}`;
    if (args.name) path += `&name=${encodeURIComponent(args.name)}`;
    const data = await epGet(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get-event-api-product', {
    description: 'Get a single Event API Product by ID, including all its versions and the Event API versions bundled within it.',
    inputSchema: {
      productId: z.string().describe('Event API Product object ID'),
    },
  }, async (args) => {
    const [product, versions] = await Promise.all([
      epGet(`/api/v2/architecture/eventApiProducts/${args.productId}`),
      epGet(`/api/v2/architecture/eventApiProducts/${args.productId}/versions?pageSize=100`),
    ]);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ product, versions }, null, 2) }] };
  });

  server.registerTool('create-event-api-product', {
    description: `Create a new Event API Product in the Event Portal, then create its first version.
An Event API Product is the publishable bundle of Event APIs — it is what gets exposed
to consumers in the Developer Hub or Service Registry.
After creation use add-event-api-product-version-api to attach Event API versions to it.`,
    inputSchema: {
      applicationDomainId: z.string().describe('Domain to create the product in'),
      name: z.string().describe('Product name, e.g. "SAP MDG Business Events v1"'),
      description: z.string().optional(),
      version: z.string().default('1.0.0'),
      shared: z.boolean().default(false),
    },
  }, async (args) => {
    const productObj = await epPost('/api/v2/architecture/eventApiProducts', {
      applicationDomainId: args.applicationDomainId,
      name: args.name,
      description: args.description ?? '',
      shared: args.shared,
    }) as any;

    const productVersion = await epPost('/api/v2/architecture/eventApiProductVersions', {
      eventApiProductId: productObj?.data?.id,
      description: args.description ?? '',
      version: args.version,
      stateId: '1',
      eventApiVersionIds: [],
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ product: productObj, version: productVersion }, null, 2) }] };
  });

  server.registerTool('update-event-api-product', {
    description: 'Update the name, description, or shared flag of an existing Event API Product.',
    inputSchema: {
      productId: z.string().describe('Event API Product object ID'),
      name: z.string().optional(),
      description: z.string().optional(),
      shared: z.boolean().optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name) body.name = args.name;
    if (args.description) body.description = args.description;
    if (args.shared !== undefined) body.shared = args.shared;
    const data = await epPatch(`/api/v2/architecture/eventApiProducts/${args.productId}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('add-event-api-product-version-api', {
    description: `Add an Event API version to an Event API Product version.
This bundles the Event API into the product so consumers can discover and subscribe to it.`,
    inputSchema: {
      productVersionId: z.string().describe('Event API Product version ID'),
      eventApiVersionId: z.string().describe('Event API version ID to add to the product'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiProductVersions/${args.productVersionId}`) as any;
    const existing: string[] = current?.data?.eventApiVersionIds ?? [];
    if (existing.includes(args.eventApiVersionId)) {
      return { content: [{ type: 'text' as const, text: `Product version already includes Event API version ${args.eventApiVersionId}.` }] };
    }
    const data = await epPatch(`/api/v2/architecture/eventApiProductVersions/${args.productVersionId}`, {
      eventApiVersionIds: [...existing, args.eventApiVersionId],
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('remove-event-api-product-version-api', {
    description: 'Remove an Event API version from an Event API Product version.',
    inputSchema: {
      productVersionId: z.string().describe('Event API Product version ID'),
      eventApiVersionId: z.string().describe('Event API version ID to remove'),
    },
  }, async (args) => {
    const current = await epGet(`/api/v2/architecture/eventApiProductVersions/${args.productVersionId}`) as any;
    const updated = (current?.data?.eventApiVersionIds ?? []).filter((id: string) => id !== args.eventApiVersionId);
    const data = await epPatch(`/api/v2/architecture/eventApiProductVersions/${args.productVersionId}`, {
      eventApiVersionIds: updated,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('set-event-api-product-version-state', {
    description: 'Change the lifecycle state of an Event API Product version: Draft → Released → Deprecated → Retired.',
    inputSchema: {
      versionId: z.string().describe('Event API Product version ID'),
      stateId: z.enum(['1', '2', '3', '4']).describe('1=Draft 2=Released 3=Deprecated 4=Retired'),
    },
  }, async (args) => {
    const data = await epPatch(`/api/v2/architecture/eventApiProductVersions/${args.versionId}`, { stateId: args.stateId }) as any;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...data, _newState: STATE_LABELS[args.stateId] }, null, 2) }] };
  });

  server.registerTool('delete-event-api-product', {
    description: 'Delete an Event API Product and all its versions.',
    inputSchema: {
      productId: z.string().describe('Event API Product object ID to delete'),
    },
  }, async (args) => {
    await epDelete(`/api/v2/architecture/eventApiProducts/${args.productId}`);
    return { content: [{ type: 'text' as const, text: `Event API Product ${args.productId} deleted.` }] };
  });
}
