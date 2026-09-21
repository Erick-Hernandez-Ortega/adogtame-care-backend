import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const validConfiguration: Record<string, unknown> = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL:
      'postgresql://adogtame:adogtame_local@localhost:5432/adogtame_care',
    JWT_ACCESS_TOKEN_SECRET: 'a-secure-test-secret-with-32-characters',
  };

  it('accepts a valid environment configuration', () => {
    expect(validateEnvironment(validConfiguration)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL:
        'postgresql://adogtame:adogtame_local@localhost:5432/adogtame_care',
      JWT_ACCESS_TOKEN_SECRET: 'a-secure-test-secret-with-32-characters',
      JWT_ACCESS_TOKEN_TTL_SECONDS: 3600,
    });
  });

  it('rejects a missing DATABASE_URL', () => {
    const configuration: Record<string, unknown> = {
      NODE_ENV: validConfiguration.NODE_ENV,
      PORT: validConfiguration.PORT,
    };

    expect(() => validateEnvironment(configuration)).toThrow();
  });

  it.each(['not-a-url', 'https://localhost:5432/adogtame_care'])(
    'rejects an invalid database URL: %s',
    (databaseUrl: string) => {
      const configuration: Record<string, unknown> = {
        ...validConfiguration,
        DATABASE_URL: databaseUrl,
      };

      expect(() => validateEnvironment(configuration)).toThrow();
    },
  );

  it('converts PORT to a number', () => {
    const configuration: Record<string, unknown> = {
      ...validConfiguration,
      PORT: '4000',
    };

    expect(validateEnvironment(configuration).PORT).toBe(4000);
  });

  it('rejects an access token secret shorter than 32 characters', () => {
    const configuration: Record<string, unknown> = {
      ...validConfiguration,
      JWT_ACCESS_TOKEN_SECRET: 'too-short',
    };

    expect(() => validateEnvironment(configuration)).toThrow();
  });

  it('rejects a missing access token secret', () => {
    const configuration: Record<string, unknown> = {
      NODE_ENV: validConfiguration.NODE_ENV,
      PORT: validConfiguration.PORT,
      DATABASE_URL: validConfiguration.DATABASE_URL,
    };

    expect(() => validateEnvironment(configuration)).toThrow();
  });

  it('converts a positive access token TTL to a number', () => {
    const configuration: Record<string, unknown> = {
      ...validConfiguration,
      JWT_ACCESS_TOKEN_TTL_SECONDS: '7200',
    };

    expect(
      validateEnvironment(configuration).JWT_ACCESS_TOKEN_TTL_SECONDS,
    ).toBe(7200);
  });

  it.each(['0', '-1', '1.5'])(
    'rejects an invalid access token TTL: %s',
    (timeToLiveSeconds: string) => {
      const configuration: Record<string, unknown> = {
        ...validConfiguration,
        JWT_ACCESS_TOKEN_TTL_SECONDS: timeToLiveSeconds,
      };

      expect(() => validateEnvironment(configuration)).toThrow();
    },
  );
});
