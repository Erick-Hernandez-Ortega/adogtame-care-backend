import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { resolve } from 'node:path';

interface ProcessResult {
    code: number | null;
    signal: NodeJS.Signals | null;
    output: string;
}

async function availablePort(): Promise<number> {
    const server: Server = createServer();

    return new Promise<number>((resolvePort, reject): void => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', (): void => {
            const address = server.address();

            if (address === null || typeof address === 'string') {
                server.close();
                reject(new Error('Expected an assigned TCP port'));

                return;
            }

            server.close((error?: Error): void => {
                if (error !== undefined) {
                    reject(error);

                    return;
                }

                resolvePort(address.port);
            });
        });
    });
}

async function runEntrypoint(
    entrypoint: string,
    environment: NodeJS.ProcessEnv,
    shutdownSignal?: NodeJS.Signals,
): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolveResult, reject): void => {
        const child: ChildProcess = spawn(
            process.execPath,
            ['--require', 'ts-node/register', resolve(entrypoint)],
            { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output: string = '';
        let hasSentSignal: boolean = false;
        const timeout: NodeJS.Timeout = setTimeout((): void => {
            child.kill('SIGKILL');
            reject(new Error('Entrypoint did not finish within 15 seconds'));
        }, 15_000);
        const collectOutput = (chunk: Buffer): void => {
            output += chunk.toString();

            if (
                shutdownSignal !== undefined &&
                !hasSentSignal &&
                output.includes('application_started')
            ) {
                hasSentSignal = true;
                child.kill(shutdownSignal);
            }
        };

        child.stdout?.on('data', collectOutput);
        child.stderr?.on('data', collectOutput);
        child.once('error', (error: Error): void => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('close', (code: number | null, signal: NodeJS.Signals | null): void => {
            clearTimeout(timeout);
            resolveResult({ code, signal, output });
        });
    });
}

describe('Production entrypoints (e2e)', () => {
    it.each(['src/main.ts', 'src/infrastructure/database/check-database-connection.ts'])(
        'rejects invalid startup configuration in %s without exposing values',
        async (entrypoint: string) => {
            const result: ProcessResult = await runEntrypoint(entrypoint, {
                NODE_ENV: 'private-invalid-environment',
                DATABASE_URL: 'https://user:private-password@example.com/database',
                JWT_ACCESS_TOKEN_SECRET: 'private-secret',
            });

            expect(result.code).toBe(1);
            expect(result.output).toContain('Invalid environment configuration:');
            expect(result.output).toContain('NODE_ENV, DATABASE_URL, JWT_ACCESS_TOKEN_SECRET');
            expect(result.output).not.toContain('private-invalid-environment');
            expect(result.output).not.toContain('private-password');
            expect(result.output).not.toContain('private-secret');
            expect(result.output).not.toContain('application_started');
        },
        20_000,
    );

    it.each(['SIGINT', 'SIGTERM'] as const)(
        'writes JSON logs and closes the pool on %s',
        async (signal: NodeJS.Signals) => {
            const port: number = await availablePort();
            const result: ProcessResult = await runEntrypoint(
                'src/main.ts',
                { NODE_ENV: 'production', PORT: String(port) },
                signal,
            );
            const entries: unknown[] = result.output
                .trim()
                .split('\n')
                .map((line: string): unknown => JSON.parse(line));

            expect(entries).toContainEqual(
                expect.objectContaining({
                    level: 'log',
                    context: 'Bootstrap',
                    message: { event: 'application_started', port },
                }),
            );
            expect(entries).toContainEqual(
                expect.objectContaining({
                    level: 'log',
                    context: 'DatabaseService',
                    message: { event: 'database_pool_closed' },
                }),
            );
            expect(result.signal).toBe(signal);
        },
        20_000,
    );
});
