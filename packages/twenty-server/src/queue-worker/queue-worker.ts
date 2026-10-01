import { NestFactory } from '@nestjs/core';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { setupGlobalI18n } from 'src/engine/core-modules/i18n/utils/setup-global-i18n.util';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { shouldCaptureException } from 'src/engine/utils/global-exception-handler.util';
import 'src/instrument';
import { QueueWorkerModule } from 'src/queue-worker/queue-worker.module';

async function bootstrap() {
  let exceptionHandlerService: ExceptionHandlerService | undefined;
  let loggerService: LoggerService | undefined;

  setupGlobalI18n();

  try {
    const app = await NestFactory.createApplicationContext(QueueWorkerModule, {
      bufferLogs: process.env.LOGGER_IS_BUFFER_ENABLED === 'true',
    });

    loggerService = app.get(LoggerService);
    exceptionHandlerService = app.get(ExceptionHandlerService);

    // Inject our logger
    app.useLogger(loggerService ?? false);
  } catch (err) {
    loggerService?.error(err?.message, err?.name);

    if (shouldCaptureException(err)) {
      exceptionHandlerService?.captureExceptions([err]);
    }

    throw err;
  }
}
void bootstrap();
