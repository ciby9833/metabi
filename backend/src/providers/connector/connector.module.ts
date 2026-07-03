import { Module, Global } from '@nestjs/common';
import { ConnectorFactory } from './connector.factory';

@Global()
@Module({
  providers: [ConnectorFactory],
  exports: [ConnectorFactory],
})
export class ConnectorModule {}
