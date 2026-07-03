import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 全局异常过滤器
 * - 把真实异常信息回写到 response（开发模式）
 * - 完整堆栈打到日志
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const isHttp = exception instanceof HttpException;
    const message =
      isHttp
        ? (exception.getResponse() as any)?.message ||
          (exception.getResponse() as any) ||
          exception.message
        : (exception as Error)?.message || 'Internal server error';

    const stack = (exception as Error)?.stack;

    this.logger.error(
      `${request.method} ${request.url} → ${status}: ${
        typeof message === 'string' ? message : JSON.stringify(message)
      }`,
    );
    if (stack && !isHttp) {
      this.logger.error(stack);
    }

    const isDev = process.env.NODE_ENV !== 'production';

    response.status(status).json({
      statusCode: status,
      path: request.url,
      message,
      ...(isDev && !isHttp ? { error: (exception as Error)?.name, stack } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
