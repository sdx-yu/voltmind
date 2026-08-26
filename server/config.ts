import path from 'node:path'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  databasePath: string
  staticDir: string
  production: boolean
}

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ?? path.resolve(process.env.BBD_DATA_DIR ?? './data')
  return {
    host: overrides.host ?? process.env.BBD_HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(process.env.BBD_PORT ?? 4317),
    dataDir,
    databasePath: overrides.databasePath ?? path.join(dataDir, 'bibudai.sqlite'),
    staticDir: overrides.staticDir ?? path.resolve(process.env.BBD_DIST_DIR ?? './dist'),
    production: overrides.production ?? process.env.NODE_ENV === 'production',
  }
}
