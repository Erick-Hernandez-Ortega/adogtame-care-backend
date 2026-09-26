import type { SchemaObject } from '@nestjs/swagger';

export function errorSchema(
  codes: string[],
  exampleMessage: string,
): SchemaObject {
  return {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: { type: 'string', enum: codes, example: codes[0] },
      message: { type: 'string', example: exampleMessage },
    },
  };
}
