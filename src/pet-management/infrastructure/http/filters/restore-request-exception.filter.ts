import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { Request } from 'express';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';

@Catch(BadRequestException)
export class RestoreRequestExceptionFilter extends BaseExceptionFilter<unknown> {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly authenticationGuard: AuthenticationGuard,
  ) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: BadRequestException, host: ArgumentsHost): void {
    const request: Request = host.switchToHttp().getRequest<Request>();
    const response: string | object = exception.getResponse();
    if (
      request.method !== 'POST' ||
      !/^\/pets\/[^/]+\/restore\/?$/i.test(request.path) ||
      (typeof response === 'object' && 'code' in response)
    ) {
      super.catch(exception, host);
      return;
    }

    void this.rejectParserFailure(host);
  }

  private async rejectParserFailure(host: ArgumentsHost): Promise<void> {
    // JSON parser failures precede route guards; retain Restore's authentication precedence.
    try {
      await this.authenticationGuard.canActivate(
        new ExecutionContextHost(host.getArgs<unknown[]>()),
      );
    } catch (error: unknown) {
      super.catch(error, host);
      return;
    }
    super.catch(
      new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      }),
      host,
    );
  }
}
