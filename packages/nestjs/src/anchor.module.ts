import {
  type AnchorValue,
  type ClientOptions,
  createAnchorClient,
  type ListQuery,
} from "@anchor-secrets/sdk";
import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type ModuleMetadata,
  type Provider,
} from "@nestjs/common";
import { AnchorService } from "./anchor.service.js";
import { ANCHOR_OPTIONS, ANCHOR_SECRETS } from "./tokens.js";

export type AnchorModuleOptions = ClientOptions &
  ListQuery & {
    /** Register the module globally; default `true`. */
    isGlobal?: boolean;
  };

export type AnchorModuleAsyncOptions = {
  imports?: ModuleMetadata["imports"];
  inject?: FactoryProvider["inject"];
  // biome-ignore lint/suspicious/noExplicitAny: Nest factories take whatever `inject` lists.
  useFactory: (...args: any[]) => AnchorModuleOptions | Promise<AnchorModuleOptions>;
  /** Register the module globally; default `true`. */
  isGlobal?: boolean;
};

/**
 * Loads one folder of secrets while the application initializes. Nest awaits the async provider,
 * so the app does not finish starting without its secrets: a failure rejects with `AnchorError`.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: a Nest dynamic module is a class with static factories.
export class AnchorModule {
  static forRoot(options: AnchorModuleOptions): DynamicModule {
    return AnchorModule.build(options.isGlobal, [{ provide: ANCHOR_OPTIONS, useValue: options }]);
  }

  static forRootAsync(options: AnchorModuleAsyncOptions): DynamicModule {
    return AnchorModule.build(
      options.isGlobal,
      [{ provide: ANCHOR_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] }],
      options.imports,
    );
  }

  private static build(
    isGlobal: boolean | undefined,
    optionProviders: Provider[],
    imports: ModuleMetadata["imports"] = [],
  ): DynamicModule {
    return {
      module: AnchorModule,
      global: isGlobal ?? true,
      imports,
      providers: [
        ...optionProviders,
        {
          provide: ANCHOR_SECRETS,
          useFactory: async (
            o: AnchorModuleOptions,
          ): Promise<Readonly<Record<string, AnchorValue>>> =>
            Object.freeze(await createAnchorClient(o).loadSecrets(o)),
          inject: [ANCHOR_OPTIONS],
        },
        {
          provide: AnchorService,
          useFactory: (secrets: Readonly<Record<string, AnchorValue>>) =>
            new AnchorService(secrets),
          inject: [ANCHOR_SECRETS],
        },
      ],
      exports: [ANCHOR_OPTIONS, ANCHOR_SECRETS, AnchorService],
    };
  }
}
// Applied as a call so the package needs no decorator transform.
Module({})(AnchorModule);
