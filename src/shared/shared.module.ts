import { Global, Module } from '@nestjs/common';

/**
 * Global module for cross-cutting providers that should be available
 * everywhere without re-importing. Guards/filters/interceptors are wired
 * globally in AppModule; this is the place for shared services if needed.
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class SharedModule {}
