import http from 'node:http';

const SOCKET = process.env.ATMOBB_UPDATER_SOCKET ?? '/run/atmobb-updater/updater.sock';

export interface UpdateStatus {
  status: 'idle' | 'waiting' | 'running' | 'succeeded' | 'failed';
  target?: 'stable' | 'main';
  startedAt?: string;
  finishedAt?: string;
  installedVersion?: string;
  installedCommit?: string | null;
  candidateVersion?: string;
  candidateCommit?: string | null;
  backup?: string;
  message?: string;
  log?: string[];
}

export const updatesEnabled = () => Boolean(process.env.ATMOBB_UPDATER_TOKEN);

function updater<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const token = process.env.ATMOBB_UPDATER_TOKEN;
  if (!token) return Promise.reject(new Error('Automatic updates are not configured.'));

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: SOCKET,
        path,
        method,
        headers: { authorization: `Bearer ${token}` },
        timeout: 5000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: { error?: string } & T;
          try {
            body = JSON.parse(text) as { error?: string } & T;
          } catch {
            reject(new Error('The host updater returned an invalid response.'));
            return;
          }
          if ((response.statusCode ?? 500) >= 400) reject(new Error(body.error ?? 'The host updater rejected the request.'));
          else resolve(body);
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('The host updater did not respond.')));
    request.on('error', (error) => reject(new Error(`The host updater is unavailable: ${error.message}`)));
    request.end();
  });
}

export const updateStatus = () => updater<UpdateStatus>('GET', '/status');
export const triggerUpdate = (target: 'stable' | 'main') => updater<UpdateStatus>('POST', `/update/${target}`);
