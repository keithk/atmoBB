import http from 'node:http';
import { env } from '$env/dynamic/private';
import type { UpdateStatus } from './updates';

export interface HostedInstance {
  id: string;
  subdomain: string;
  forumDid: string;
  status: 'provisioning' | 'live' | 'failed';
  error?: string;
  update?: UpdateStatus;
  updateError?: string;
}

export interface FleetStatus {
  limit: number;
  used: number;
  instances: HostedInstance[];
}

export const fleetEnabled = () => env.ATMOBB_HOSTING === '1' && Boolean(env.ATMOBB_HOSTING_TOKEN);

function host<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!fleetEnabled()) return Promise.reject(new Error('Isolated hosting is not configured.'));
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = http.request({
      socketPath: env.ATMOBB_HOSTING_SOCKET ?? '/run/atmobb-hosting/hosting.sock',
      method, path, timeout: 15000,
      headers: { authorization: `Bearer ${env.ATMOBB_HOSTING_TOKEN}`, 'x-hosting-domain': env.ATMOBB_HOSTING_DOMAIN_SUFFIX ?? 'atmobb.app', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if ((response.statusCode ?? 500) >= 400) reject(new Error(value.error ?? 'Hosting action failed.'));
          else resolve(value);
        } catch { reject(new Error('Invalid hosting service response.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Hosting service timed out. Reload before retrying; the operation may have been accepted.')));
    request.on('error', reject);
    request.end(payload);
  });
}

export const fleetStatus = () => host<FleetStatus>('GET', '/status');
export const setHostingLimit = (limit: number) => host<FleetStatus>('POST', '/capacity', { limit });
export const provisionHostedInstance = (input: { id: string; subdomain: string; forumDid: string; adminHandle: string }) =>
  host<HostedInstance>('POST', '/instances', input);
export const updateHostedInstance = (id: string, target: 'stable' | 'main') =>
  host<UpdateStatus>('POST', `/instances/${encodeURIComponent(id)}/update/${target}`);
