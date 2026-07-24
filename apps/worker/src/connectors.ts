import type { SaaSConnector } from '@open-smp/connectors-core';
import { GoogleWorkspaceConnector } from '@open-smp/connector-google-workspace';

export type ConnectorFactory = (credentials: Record<string, string>) => SaaSConnector;

/** Maps saas_apps.key to a connector factory. Injectable so tests can register a fake connector. */
export type ConnectorRegistry = ReadonlyMap<string, ConnectorFactory>;

function buildGoogleWorkspaceConnector(credentials: Record<string, string>): SaaSConnector {
  const serviceAccountJson = credentials.serviceAccountJson;
  const impersonateAdminEmail = credentials.impersonateAdminEmail;
  if (!serviceAccountJson || !impersonateAdminEmail) {
    throw new Error(
      'google-workspace credentials require serviceAccountJson and impersonateAdminEmail',
    );
  }

  return new GoogleWorkspaceConnector({
    serviceAccountJson,
    impersonateAdminEmail,
    ...(credentials.customerId ? { customerId: credentials.customerId } : {}),
  });
}

export function createConnectorRegistry(): ConnectorRegistry {
  return new Map<string, ConnectorFactory>([
    ['google-workspace', buildGoogleWorkspaceConnector],
  ]);
}
