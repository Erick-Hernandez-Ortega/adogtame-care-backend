import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const validConfiguration: Record<string, unknown> = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL:
      'postgresql://adogtame:adogtame_local@localhost:5432/adogtame_care',
  };

  it('accepts a valid environment configuration', () => {
    expect(validateEnvironment(validConfiguration)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL:
        'postgresql://adogtame:adogtame_local@localhost:5432/adogtame_care',
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
});
